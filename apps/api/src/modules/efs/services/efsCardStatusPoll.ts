import type { SupabaseClient } from "@supabase/supabase-js";
import { cardLast4, cardStatusChangeIsUrgent, efsStatusEquals, isFraudStatusChange } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { writeAudit } from "../../../lib/audit.js";
import { notify } from "../../messaging/index.js";
import { usersWhoManage } from "../../org/index.js";
import { isSecretBoxConfigured } from "../../../lib/secretBox.js";
import { signalCardStatusChangedExternally, signalStatusPollRefused } from "../../../lib/cardControlSignals.js";
import { getCardSummaries, type CardSummaryRow } from "../lib/efsCardOps.js";
import { orgTimeZone } from "./cardStatusSummary.js";
import { cardRefHmac, refreshCardDetail, upsertFromSummary } from "./efsCardMirror.js";
import type { EfsSoapCredentials } from "./efsSoapCredentials.js";

/**
 * The status poll: card STATUS within minutes, not within a day (EFS audit, 2026-09-30).
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
 * The mirror swept once every 24 hours — 290 `getCardv2` calls, ~9.5 minutes — on the premise that
 * card configuration only changes when a person changes it. Status is the exception that premise
 * missed: a dispatcher locks a card in the WEX portal, or EFS puts one on hold itself, and our page
 * drew the old status for up to a day while calling data up to 26 hours old fresh.
 *
 * ── WHY IT IS CHEAP ENOUGH ──────────────────────────────────────────────────────────────────────
 * `getCardSummariesV2` returns the whole fleet's status, override count, unit and driver in ONE call
 * (WSDL `WSCardSummary`). The daily sweep already makes it and already writes those fields
 * (`upsertFromSummary`). Every five minutes is 288 calls a day — against the ~1,440 a day the
 * posted-transaction poller already makes per org — so the p11 warning about excessive polling is
 * answered by the arithmetic, not waived. Only a card whose status CHANGED (or that is new) costs a
 * `getCardv2`, bounded by `maxDetail`.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────────────────────────
 * Tombstone. A card missing from one roster is not evidence enough to mark it absent every five
 * minutes; the daily sweep keeps that job and its ratio guard.
 */

/** Share of the fleet whose status may change in one poll before the batch is held back. */
const MAX_CHANGE_SHARE = 0.2;
/** ...but a small fleet may always see this many — two cards locked at once is ordinary. */
const MIN_CHANGES_ALLOWED = 5;
/** A change inside this window on a card we wrote to is our own write landing, not somebody else's. */
const OWN_WRITE_WINDOW_MS = 15 * 60_000;

export interface CardStatusPollResult {
  orgId: string;
  cardsSeen: number;
  statusChanges: number;
  /** Changes not explained by a write of ours — each has an audit row. */
  externalChanges: number;
  newCards: number;
  detailed: number;
  /** The ratio guard held the batch's status back. `statusChanges` still counts what it saw. */
  refused: boolean;
  failed: number;
  errors: string[];
}

interface MirrorRow {
  id: string;
  card_ref_hmac: string;
  status: string;
}

interface StatusChange {
  summary: CardSummaryRow;
  row: MirrorRow;
}

export async function pollEfsCardStatus(
  admin: SupabaseClient,
  env: Env,
  creds: EfsSoapCredentials,
  opts: { fetchImpl?: typeof fetch; maxDetail?: number; now?: Date } = {},
): Promise<CardStatusPollResult> {
  const orgId = creds.orgId;
  const result: CardStatusPollResult = {
    orgId, cardsSeen: 0, statusChanges: 0, externalChanges: 0, newCards: 0, detailed: 0,
    refused: false, failed: 0, errors: [],
  };
  if (!isSecretBoxConfigured(env)) {
    // A new card's PAN is sealed on first sighting; refuse rather than store it any other way.
    result.errors.push("SECRETS_ENCRYPTION_KEY is not configured — refusing to store card numbers");
    result.failed = 1;
    return result;
  }

  const summaries = await getCardSummaries(env, creds, { fetchImpl: opts.fetchImpl, priority: "backfill" });
  result.cardsSeen = summaries.length;
  // An empty roster is a vendor blip until proven otherwise; there is nothing to compare it with.
  if (summaries.length === 0) return result;

  const mirror = await readMirror(admin, orgId);
  const known = new Set(mirror.keys());
  const changes: StatusChange[] = [];
  const fresh: CardSummaryRow[] = [];
  for (const summary of summaries) {
    const row = mirror.get(cardRefHmac(env, orgId, summary.cardNumber));
    if (!row) fresh.push(summary);
    else if (summary.status && !efsStatusEquals(row.status, summary.status)) changes.push({ summary, row });
  }
  result.statusChanges = changes.length;
  result.newCards = fresh.length;

  const ceiling = Math.max(MIN_CHANGES_ALLOWED, Math.floor(mirror.size * MAX_CHANGE_SHARE));
  result.refused = changes.length > ceiling;
  if (result.refused) {
    const first = changes[0]!;
    signalStatusPollRefused({
      orgId,
      changes: changes.length,
      knownCards: mirror.size,
      ceiling,
      example: `${first.row.status} → ${first.summary.status}`,
    });
  }
  const held = new Set(result.refused ? changes.map((c) => c.row.card_ref_hmac) : []);

  for (const summary of summaries) {
    const hmac = cardRefHmac(env, orgId, summary.cardNumber);
    const row = mirror.get(hmac);
    // Keep the stored spelling when the state is the same (`Hold` vs `HOLD`), and the stored status
    // outright when the guard held this card back — so a poll never flips a badge it cannot vouch for.
    const keep = row && (held.has(hmac) || !summary.status || efsStatusEquals(row.status, summary.status));
    try {
      await upsertFromSummary(admin, env, orgId, keep ? { ...summary, status: row.status } : summary, known);
    } catch (error) {
      result.failed += 1;
      result.errors.push(`card ••••${cardLast4(summary.cardNumber) ?? "????"}: ${errorText(error)}`);
    }
  }

  if (!result.refused) {
    await refreshDetails(admin, env, creds, [...changes.map((c) => c.summary), ...fresh], opts, result);
    result.externalChanges = await recordExternalChanges(admin, orgId, changes, opts.now ?? new Date());
  }
  return result;
}

/** The org's mirror, keyed by card hmac. Paged: PostgREST caps a response at 1,000 rows. */
async function readMirror(admin: SupabaseClient, orgId: string): Promise<Map<string, MirrorRow>> {
  const out = new Map<string, MirrorRow>();
  const PAGE = 1_000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("efs_cards")
      .select("id, card_ref_hmac, status")
      .eq("org_id", orgId)
      .order("card_ref_hmac", { ascending: true })
      .range(from, from + PAGE - 1);
    // A poll that cannot tell known from new can only do damage — the full sweep's rule (P0-7).
    if (error) throw new Error(`could not read the card mirror: ${error.message}`);
    const page = (data ?? []) as MirrorRow[];
    for (const r of page) out.set(r.card_ref_hmac, r);
    if (page.length < PAGE) break;
  }
  return out;
}

/** Re-read the cards that changed or appeared, so prompts and limits match the status we now show. */
async function refreshDetails(
  admin: SupabaseClient,
  env: Env,
  creds: EfsSoapCredentials,
  cards: CardSummaryRow[],
  opts: { fetchImpl?: typeof fetch; maxDetail?: number },
  result: CardStatusPollResult,
): Promise<void> {
  for (const summary of cards.slice(0, opts.maxDetail ?? 20)) {
    try {
      await refreshCardDetail(admin, env, creds, summary.cardNumber, { fetchImpl: opts.fetchImpl });
      result.detailed += 1;
    } catch (error) {
      // Not fatal: the roster fields already landed, and the daily sweep re-reads every card.
      result.failed += 1;
      result.errors.push(`detail ••••${cardLast4(summary.cardNumber) ?? "????"}: ${errorText(error)}`);
    }
  }
}

/**
 * Write an audit row for every change nobody made through us, and send the urgent ones at once.
 *
 * "Through us" means a card-control write on that card inside `OWN_WRITE_WINDOW_MS`. Our own writes
 * update the mirror from their verifying read, so the poll should never see them as changes at all;
 * the window is for the one it can — a write whose mirror update failed or has not landed yet.
 *
 * Urgent is Q-F3's rule (`cardStatusChangeIsUrgent`): FRAUD, or outside office hours on the org's
 * clock. Every other change keeps its audit row and is left for the daily summary (`cardStatusSummary.ts`), which
 * reads those rows; it is not messaged one by one any more.
 */
async function recordExternalChanges(
  admin: SupabaseClient,
  orgId: string,
  changes: StatusChange[],
  now: Date,
): Promise<number> {
  if (!changes.length) return 0;
  const since = new Date(now.getTime() - OWN_WRITE_WINDOW_MS).toISOString();
  const { data, error } = await admin
    .from("efs_card_mutations")
    .select("efs_card_id")
    .eq("org_id", orgId)
    .in("efs_card_id", changes.map((c) => c.row.id))
    .gte("created_at", since);
  // Unable to attribute: say nothing rather than accuse a person of a change we may have made.
  if (error) {
    console.error(`[efs-cards] org ${orgId}: status poll could not read the mutation ledger — ${error.message}`);
    return 0;
  }
  const ours = new Set(((data ?? []) as { efs_card_id: string }[]).map((r) => r.efs_card_id));
  const external = changes.filter((c) => !ours.has(c.row.id));
  const timeZone = external.length ? await orgTimeZone(admin, orgId) : null;
  const urgent = (c: StatusChange) =>
    timeZone !== null && cardStatusChangeIsUrgent({ from: c.row.status, to: c.summary.status!, at: now, timeZone });
  // Who hears it: everyone who may MANAGE fuel, from the section matrix — the people who can act on a
  // card. Read once per poll, and only when there is something to say now.
  const recipients = external.some(urgent) ? await fuelManagers(admin, orgId) : [];
  let recorded = 0;
  for (const change of external) {
    const { summary, row } = change;
    const to = summary.status!;
    await writeAudit(admin, {
      orgId,
      actorId: null,
      action: "card.status_changed_externally",
      entity: "efs_cards",
      entityId: row.id,
      meta: { from: row.status, to, last4: cardLast4(summary.cardNumber), via: "efs_status_poll" },
    });
    signalCardStatusChangedExternally({ orgId, efsCardId: row.id, from: row.status, to });
    if (urgent(change)) await notifyStatusChange(admin, orgId, recipients, row, to, cardLast4(summary.cardNumber), now);
    recorded += 1;
  }
  return recorded;
}

async function fuelManagers(admin: SupabaseClient, orgId: string): Promise<string[]> {
  try {
    return await usersWhoManage(admin, orgId, "fuel");
  } catch (e) {
    // The audit row is the record and it is already written; a missed tap on the shoulder is not
    // worth failing the poll over.
    console.error(`[efs-cards] org ${orgId}: could not read fuel managers — ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

/**
 * The office alert for one URGENT external change (category `card_status_changed`, migration 0397).
 *
 * Every direction is announced when it is urgent, not only locks: a card UNLOCKED in the WEX portal is the change with
 * money attached — on 2026-09-30 the first poll found ••••7464 reactivated and fuelled while this page
 * still called it Inactive. Critical when either side is Fraud, a warning otherwise.
 *
 * Deduped per card, per new state, per hour: a card flapping between two states cannot fill an inbox,
 * and a genuine second change an hour later still arrives. `notify()` itself never throws.
 */
async function notifyStatusChange(
  admin: SupabaseClient,
  orgId: string,
  recipients: readonly string[],
  row: MirrorRow,
  to: string,
  last4: string | null,
  now: Date,
): Promise<void> {
  const fraud = isFraudStatusChange(row.status, to);
  const hour = now.toISOString().slice(0, 13);
  for (const userId of recipients) {
    await notify(admin, {
      orgId,
      userId,
      category: "card_status_changed",
      title: `Fuel card ••••${last4 ?? "????"} is now ${to}`,
      body: `It was ${row.status}. The change was made at EFS — in the WEX portal or by EFS itself — not in Silvicom 360.`,
      severity: fraud ? "critical" : "warning",
      entityType: "efs_card",
      entityId: row.id,
      dedupeKey: `card_status_changed:${row.id}:${to.toLowerCase()}:${hour}`,
    });
  }
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // A vendor message can quote the card number back; last four only, ever (efsCardMirror's rule).
  return message.replace(/\b\d{10,25}\b/g, (d) => `••••${d.slice(-4)}`).slice(0, 300);
}
