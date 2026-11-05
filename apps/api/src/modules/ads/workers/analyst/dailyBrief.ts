import { briefFacts, plainBrief } from "@silvicom/shared";
import { keysAlreadySent } from "../../../messaging/index.js";
import { sendAdsAlert } from "../../alerts/adsAlerts.js";
import type { ClaudeGenerationDeps } from "../../generations/claudeGeneration.js";
import { writeBrief, type BriefAnswer, type BriefFinding } from "./analyst.js";
import { readBriefFold, reportedDay } from "./briefFold.js";

/**
 * One carrier's morning brief (F1b; plan §4.3 `ads_daily_brief`, the `ads_brief` bell): yesterday's fold,
 * the analyst's narration of it, and a bell to the people Settings › Ads control names for `ads_brief`
 * (the admins when it names nobody — `alertRecipients`).
 *
 * ── ONCE A DAY, HOWEVER OFTEN IT RUNS ──────────────────────────────────────────────────────────────
 * The scheduler asks every hour from the brief's hour on, so a deploy at 07:00 delays the brief rather
 * than losing it. Three things make the repeats free: the bell's dedupe key `ads_brief:<day>` is read
 * first from the notification ledger (`keysAlreadySent`), so a sent day stops before any read; the
 * analyst's ledger key is `brief:<day>:<attempt>`, so a run that crashed after the model answered replays
 * that answer instead of asking again; and the bell itself dedupes on the same key.
 *
 * ── WHAT IS SENT ──────────────────────────────────────────────────────────────────────────────────
 * The narration, when it passes the number check. Refused once, the analyst is asked again (attempt 2, a
 * new key); refused twice — or switched off, or out of budget, or failed — the PLAIN brief is sent: the
 * same figures in fixed sentences (`plainBrief`), so the office never goes without yesterday's numbers and
 * never reads a figure the fold did not produce. A call still in flight throws: the job fails, is listed,
 * and the next hour's run picks the answer up from the ledger.
 *
 * A day with nothing to report — no campaign spent and no spend this month — sends nothing.
 */

export const briefDedupeKey = (day: string): string => `ads_brief:${day}`;

export type DailyBriefResult =
  | { kind: "already_sent"; day: string }
  | { kind: "nothing_to_report"; day: string }
  | { kind: "sent"; day: string; by: "analyst" | "plain"; why?: string; refused?: BriefFinding[]; recipients: number };

export async function runDailyBrief(deps: ClaudeGenerationDeps, orgId: string): Promise<DailyBriefResult> {
  const now = deps.now();
  const { day } = reportedDay(now);
  const key = briefDedupeKey(day);
  if ((await keysAlreadySent(deps.admin, orgId, [key])).has(key)) return { kind: "already_sent", day };
  const fold = await readBriefFold(deps.admin, orgId, now);
  if (fold.campaigns.length === 0 && Object.keys(fold.month_to_date).length === 0) return { kind: "nothing_to_report", day: fold.day };

  let brief: BriefAnswer | null = null;
  let why: string | undefined;
  let refused: BriefFinding[] | undefined;
  for (const attempt of [1, 2]) {
    const out = await writeBrief(deps, { orgId, fold, attempt });
    if (out.kind === "ready") { brief = out.brief; break; }
    if (out.kind === "in_flight") throw new Error(`ads_daily_brief: the analyst's brief for ${fold.day} (attempt ${attempt}) is still in flight since ${out.startedAt}`);
    if (out.kind === "refused") { refused = out.findings; why = "refused"; continue; }
    why = out.kind === "failed" ? `failed:${out.errorCode}` : out.kind === "budget_exhausted" ? `budget:${out.refusal}` : "agent_off";
    break;
  }
  const by = brief ? "analyst" : "plain";
  const sent = brief ?? plainBrief(briefFacts(fold));
  const recipients = await sendAdsAlert(deps.admin, orgId, {
    category: "ads_brief",
    title: sent.headline,
    body: sent.points.join("\n"),
    severity: "info",
    // `entity_id` is a uuid (0089): the brief is the carrier's, the day is in the dedupe key.
    entityType: "organization",
    entityId: orgId,
    dedupeKey: key,
  });
  return { kind: "sent", day: fold.day, by, ...(by === "plain" ? { why, refused } : {}), recipients };
}
