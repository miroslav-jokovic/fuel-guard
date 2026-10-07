import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dayRangeInstants,
  organizationTimezone,
  shiftDay,
  summarizeCardStatusChanges,
  todayInZone,
  wallClockInZone,
  type SummaryCardChange,
} from "@silvicom/shared";
import { keysAlreadySent, notify } from "../../messaging/index.js";
import { usersWhoManage } from "../../org/index.js";

/**
 * The daily card status summary (Q-F3; F02-F04 PLAN.md chunk 3b) — one message per fuel manager per
 * day, naming yesterday's changes made at EFS. The words are `summarizeCardStatusChanges`'s; this
 * file only reads and sends.
 *
 * ── WHY IT RIDES THE STATUS POLL AND NOT THE WEEKLY DIGEST ──────────────────────────────────────
 * The plan said "through the existing digest". The digest is a WEEKLY email, written by AI, to the
 * org's notification addresses — not a daily message per person — and it lives in `org`, which this
 * module already depends on, so calling here from there would close a cycle. What the plan meant by
 * it — no new scheduler — is kept: the status poll already runs every five minutes for every
 * production org, and this runs at the end of it.
 *
 * ── WHY IT SENDS ONCE ───────────────────────────────────────────────────────────────────────────
 * The key is `card_status_summary:<day>`, and `notification_dedupe_keys` (0432) keeps a key per
 * person forever, so a second poll cannot send a second summary for the same day. `keysAlreadySent`
 * is asked first so the polls after the first one read nothing else. It is sent between 07:00 and
 * 12:00 on the org's clock: the office reads it when it opens, and a quiet day costs at most sixty
 * small reads.
 */

export const SUMMARY_FROM_HOUR = 7;
export const SUMMARY_UNTIL_HOUR = 12;
const CATEGORY = "card_status_changed";

export interface CardStatusSummaryResult {
  day: string | null;
  sent: number;
  /** Why nothing was sent, when nothing was. */
  skipped: "outside_window" | "already_sent" | "no_changes" | "no_recipients" | null;
}

export async function sendCardStatusSummary(admin: SupabaseClient, orgId: string, now: Date): Promise<CardStatusSummaryResult> {
  const timeZone = await orgTimeZone(admin, orgId);
  const hour = wallClockInZone(now, timeZone).hour;
  if (hour < SUMMARY_FROM_HOUR || hour >= SUMMARY_UNTIL_HOUR) return { day: null, sent: 0, skipped: "outside_window" };

  const day = shiftDay(todayInZone(now, timeZone), -1);
  const dedupeKey = `card_status_summary:${day}`;
  if ((await keysAlreadySent(admin, orgId, [dedupeKey])).has(dedupeKey)) return { day, sent: 0, skipped: "already_sent" };

  const summary = summarizeCardStatusChanges(await readChanges(admin, orgId, day, timeZone));
  if (!summary) return { day, sent: 0, skipped: "no_changes" };
  const recipients = await usersWhoManage(admin, orgId, "fuel");
  if (recipients.length === 0) return { day, sent: 0, skipped: "no_recipients" };

  let sent = 0;
  for (const userId of recipients) {
    const id = await notify(admin, { orgId, userId, category: CATEGORY, title: summary.title, body: summary.body, severity: "info", dedupeKey });
    if (id) sent += 1;
  }
  return { day, sent, skipped: null };
}

/**
 * The org's clock, from `organizations.operating_hours` — the ZONE only; its hours are when the trucks
 * run (`cardStatusUrgency.ts`). Unreadable falls to the column's default zone.
 */
export async function orgTimeZone(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
  return organizationTimezone((data as { operating_hours?: object | null } | null)?.operating_hours);
}

interface AuditRow {
  entity_id: string;
  meta: { from?: string; to?: string; last4?: string | null } | null;
}

/** Yesterday's external changes, oldest first, with each card's truck and driver. Paged at 1,000. */
async function readChanges(admin: SupabaseClient, orgId: string, day: string, timeZone: string): Promise<SummaryCardChange[]> {
  const { start, endExclusive } = dayRangeInstants(day, day, timeZone);
  const rows: AuditRow[] = [];
  const PAGE = 1_000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("audit_logs")
      .select("entity_id, meta")
      .eq("org_id", orgId)
      .eq("action", "card.status_changed_externally")
      .gte("created_at", start)
      .lt("created_at", endExclusive)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    // A summary built from half a day would say something false; better to say nothing and retry.
    if (error) throw new Error(`could not read card status changes: ${error.message}`);
    const page = (data ?? []) as AuditRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  const changes = rows.filter((r) => r.entity_id && r.meta?.from && r.meta?.to);
  if (changes.length === 0) return [];

  const ids = [...new Set(changes.map((r) => r.entity_id))];
  const { data: cards, error } = await admin
    .from("efs_cards")
    .select("id, unit_prompt, driver_name, card_last4")
    .eq("org_id", orgId)
    .in("id", ids);
  if (error) throw new Error(`could not read the cards: ${error.message}`);
  const byId = new Map(
    ((cards ?? []) as { id: string; unit_prompt: string | null; driver_name: string | null; card_last4: string | null }[]).map((c) => [c.id, c]),
  );
  return changes.map((r) => {
    const card = byId.get(r.entity_id);
    return {
      cardId: r.entity_id,
      from: r.meta!.from!,
      to: r.meta!.to!,
      unit: card?.unit_prompt?.trim() || null,
      driver: card?.driver_name ?? null,
      last4: card?.card_last4 ?? r.meta?.last4 ?? null,
    };
  });
}
