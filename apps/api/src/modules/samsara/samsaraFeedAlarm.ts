/**
 * A stalled feed pages somebody — once (SAM-S5, D-SAM6).
 *
 * The second half of S5's Done-when. `readSamsaraFeedHealth` says which feeds are breached and
 * `decideSamsaraFeedAlerts` decides what is worth SAYING about that; this file does the two things
 * neither of them can: it reads what we already said, and it puts a message in front of a person.
 *
 * ── ORDER MATTERS: SEND, THEN REMEMBER ───────────────────────────────────────────────────────────
 * The memory row is written only after the mail is accepted. Recording first and failing to send
 * would mark a carrier as notified about an outage they were never told about — and because the
 * memory is what suppresses the next evaluation, that silence would then be permanent. Failing the
 * other way costs a duplicate on the next tick, which is recoverable.
 *
 * ── THE EXISTING NOTIFICATION PATH, NOT A NEW ONE ────────────────────────────────────────────────
 * `organizations.notifications_enabled` / `notification_emails` and `makeSender`, exactly as
 * `notifyFuelDrop` uses them. A carrier who has turned notifications off has turned these off too;
 * inventing a second channel that ignores that switch would be a setting the product does not honour.
 *
 * ── ONE MESSAGE PER EVALUATION, NOT ONE PER FEED ─────────────────────────────────────────────────
 * Decisions are rare by construction — the cooldown sees to that — but the FIRST evaluation for a
 * carrier with a broken token can raise several at once. Eight separate emails about one root cause
 * is the noise this whole design is arranged against.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decideSamsaraFeedAlerts,
  type SamsaraFeedAlertDecision,
  type SamsaraFeedAlertMemory,
  type SamsaraFeedId,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import { makeSender } from "../../lib/mailer.js";
import { readSamsaraFeedHealth } from "./samsaraFeedHealth.js";

export interface FeedAlarmResult {
  /** Decisions actually mailed. */
  sent: SamsaraFeedAlertDecision[];
  /** Why each candidate was not, so a quiet run can say WHY it was quiet. */
  held: { feed: SamsaraFeedId; why: string }[];
  /** The carrier has notifications switched off, or has no address. Not a failure. */
  muted: boolean;
  error: string | null;
}

const EMPTY: Omit<FeedAlarmResult, "held" | "error"> = { sent: [], muted: false };

type AlertRow = { feed: string; state: string; notified_at: string; cleared_at: string | null };

export async function runSamsaraFeedAlarm(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  now: Date = new Date(),
): Promise<FeedAlarmResult> {
  const health = await readSamsaraFeedHealth(admin, env, orgId, now);
  // A freshness read that failed says nothing about the feeds — mailing "everything is fine" or
  // "everything is broken" off a failed read would both be inventions.
  if (health.error) return { ...EMPTY, held: [], error: health.error };

  const { data: rows, error: memErr } = await admin
    .from("samsara_feed_alerts")
    .select("feed, state, notified_at, cleared_at")
    .eq("org_id", orgId);
  if (memErr) return { ...EMPTY, held: [], error: memErr.message };

  const memory: SamsaraFeedAlertMemory[] = ((rows ?? []) as AlertRow[]).map((r) => ({
    feed: r.feed as SamsaraFeedId,
    state: r.state as SamsaraFeedAlertMemory["state"],
    notifiedAt: r.notified_at,
    clearedAt: r.cleared_at,
  }));

  const plan = decideSamsaraFeedAlerts(health.feeds, memory, now);
  if (plan.send.length === 0) return { ...EMPTY, held: plan.held, error: null };

  const { data: org } = await admin
    .from("organizations")
    .select("name, notification_emails, notifications_enabled")
    .eq("id", orgId)
    .maybeSingle();
  const to = (org as { notification_emails?: string[] } | null)?.notification_emails ?? [];
  if (!org || !(org as { notifications_enabled?: boolean }).notifications_enabled || to.length === 0) {
    // Muted, and NOT remembered: if the carrier turns notifications back on tomorrow, the outage they
    // still have should reach them then. Recording it here would mean it never did.
    return { ...EMPTY, held: plan.held, muted: true, error: null };
  }

  const raises = plan.send.filter((d) => d.action === "raise");
  const subject =
    plan.send.length === 1
      ? plan.send[0]!.subject
      : raises.length > 0
        ? `⚠ ${raises.length} Samsara feed${raises.length === 1 ? "" : "s"} need attention`
        : "Samsara feeds are back on time";
  const text = plan.send.map((d) => d.body).join("\n\n");

  /*
   * ⚠ `makeSender` RETURNS false, IT DOES NOT THROW. `sendEmail` catches its own transport errors and
   * reports `{ ok: false }`, so a `try`/`catch` here would sail past a refused send and go straight to
   * writing the memory row — recording the carrier as notified about an outage they were never told
   * about, and then suppressing every later evaluation of it. The boolean is the whole guard.
   */
  let accepted: boolean;
  try {
    accepted = await makeSender(env)({
      to,
      subject,
      text: `${text}\n\n${env.WEB_APP_URL}/settings/data-sync`,
      html: `${plan.send.map((d) => `<p>${d.body}</p>`).join("")}<p><a href="${env.WEB_APP_URL}/settings/data-sync">Data &amp; sync</a></p>`,
    });
  } catch (e) {
    return { ...EMPTY, held: plan.held, error: e instanceof Error ? e.message : String(e) };
  }
  if (!accepted) return { ...EMPTY, held: plan.held, error: "The alert email was not accepted for delivery." };

  const stamp = now.toISOString();
  for (const d of plan.send) {
    if (d.action === "raise") {
      /*
       * Full payload, every NOT NULL column present: Postgres checks NOT NULL BEFORE conflict
       * arbitration, so a partial upsert fails on a row that already exists (`lint:upserts`, and
       * migrations 0174/0175 are the pattern for the alternative). `cleared_at` is reset to null
       * here on purpose — a feed that broke again is standing again.
       */
      await admin.from("samsara_feed_alerts").upsert(
        { org_id: orgId, feed: d.feed, state: d.state, notified_at: stamp, cleared_at: null, lead: d.health.lead },
        { onConflict: "org_id,feed" },
      );
    } else {
      // The row exists by construction — a clear is only decided for a standing alert — so this is an
      // UPDATE and not an upsert. It keeps `state`: what we last chased is part of the record.
      await admin
        .from("samsara_feed_alerts")
        .update({ notified_at: stamp, cleared_at: stamp, lead: d.health.lead })
        .eq("org_id", orgId)
        .eq("feed", d.feed);
    }
  }

  return { sent: plan.send, held: plan.held, muted: false, error: null };
}
