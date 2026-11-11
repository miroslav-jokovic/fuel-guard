import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSISTANT_TOOL_PAGE, compareAttention, driversToQuery, type DqAttentionItem, type DqItemState } from "@silvicom/shared";
import { getComplianceOverview } from "./complianceOverview.js";

/**
 * The assistant's `driver_file_expirations` tool (F21 R6b, 2026-11-10): whose driver qualification
 * file has something expired, expiring or missing, from the Drivers page (`/drivers`, its File and
 * expiry columns since the DQ page folded into it, DQ-INTO-DRIVERS-PLAN).
 *
 * ── WHY IT CALLS `getComplianceOverview` AND NOTHING ELSE ────────────────────────────────────────
 * `GET /api/compliance/overview` is `getComplianceOverview(admin, orgId, today, opts)`, the one
 * derivation the driver's file, the roster's columns and the binder share (its "founding invariant":
 * one horizon, the default, everywhere but the alert scheduler). This file asks it with the route's
 * own `today` and the default horizon, and only regroups `attention` (the items not current, worst
 * first) and counts them. It never judges a date itself.
 *
 * ── WHAT IT DOES NOT PASS, ON PURPOSE (D-AI7) ────────────────────────────────────────────────────
 * The route adds two things per reader: Med-Stop violations (a §382.401(a) testing-record fact, only
 * for readers `canReadTestingRecords` admits) and the papers' signed thumbnails. Neither is passed.
 * D-AI7 keeps drug-test result detail out of every tool result for every role, and a "return to duty"
 * item exists only because of a positive result, so it would disclose one. This is exactly what the
 * page shows a reader who may not see testing records. Thumbnails are images, not report content.
 *
 * `today` is the route's: `new Date().toISOString().slice(0, 10)`, the UTC day. That is a day early
 * in a Central-time evening (D-PREC6); it is the page's rule, so the tool keeps it and the plan
 * records it as found (F21 PLAN §6, R6b expirations) rather than giving the assistant a different day.
 *
 * Gated as its page is: `roster: view` (`assistantContract.ts`).
 *
 * ORG-SCOPED: `getComplianceOverview` filters `org_id` on every read.
 */

export const DRIVER_FILES_SOURCE = "Drivers page (/drivers), the File column and the expiry columns: the same qualification file each driver's page shows";
export const DRIVER_FILE_STATES = ["expired", "expiring", "missing"] as const satisfies readonly DqItemState[];
export const MAX_DRIVER_FILE_ROWS = 50;

export interface AssistantDriverFilesInput {
  state?: unknown;
  drivers?: unknown;
}

const item = (a: DqAttentionItem) => ({
  item: a.label,
  state: a.state,
  good_until: a.goodUntil,
  days_remaining: a.daysRemaining,
});

export async function assistantDriverFiles(
  admin: SupabaseClient,
  orgId: string,
  input: AssistantDriverFilesInput,
  now: Date = new Date(),
): Promise<unknown> {
  const today = now.toISOString().slice(0, 10);
  const overview = await getComplianceOverview(admin, orgId, today);
  const only = (DRIVER_FILE_STATES as readonly string[]).includes(String(input.state)) ? (input.state as DqItemState) : null;
  const named = (Array.isArray(input.drivers) ? input.drivers : []).map((d) => String(d).trim().toLowerCase()).filter(Boolean);

  const items: Record<string, Record<string, number>> = {};
  for (const d of overview.drivers) {
    for (const a of d.attention) {
      const row = (items[a.label] ??= { expired: 0, expiring: 0, missing: 0 });
      row[a.state] = (row[a.state] ?? 0) + 1;
    }
  }

  const drivers = overview.drivers
    .filter((d) => named.length === 0 || named.some((n) => d.driver_name.toLowerCase().includes(n)))
    .map((d) => ({ d, attention: d.attention.filter((a) => a.state !== "current" && (!only || a.state === only)) }))
    .filter((x) => x.attention.length > 0 || named.length > 0)
    // Worst first across drivers, by the page's own order of items (`compareAttention`).
    .sort((x, y) => (x.attention[0] && y.attention[0] ? compareAttention(x.attention[0], y.attention[0]) : x.attention[0] ? -1 : y.attention[0] ? 1 : 0));

  const result: Record<string, unknown> = {
    source: DRIVER_FILES_SOURCE,
    as_of_day: today,
    drivers_on_file: overview.drivers.length,
    drivers_by_file_state: {
      complete: overview.drivers.filter((d) => d.state === "complete").length,
      incomplete: overview.drivers.filter((d) => d.state === "incomplete").length,
      not_started: overview.drivers.filter((d) => d.state === "not_started").length,
    },
    items_needing_attention: items,
    drivers: drivers.slice(0, MAX_DRIVER_FILE_ROWS).map(({ d, attention }) => ({
      driver: d.driver_name,
      file_state: d.state,
      items: attention.map(item),
    })),
    ...(drivers.length > MAX_DRIVER_FILE_ROWS ? { drivers_note: `${MAX_DRIVER_FILE_ROWS} of ${drivers.length} drivers listed, the worst items first.` } : {}),
    ...(overview.truncated ? { truncated_note: "The file read hit its record cap, so this picture is partial." } : {}),
  };
  if (named.length > 0) {
    const missing = named.filter((n) => !overview.drivers.some((d) => d.driver_name.toLowerCase().includes(n)));
    if (missing.length > 0) result.not_found = missing;
  }
  // F21 R4b: a link with filters ONLY where the roster can show exactly these drivers — `expired`, the one
  // item state its worst-chip File filter agrees with (`driversLinkContract.ts`, Q-AI13). Any other answer
  // links to the roster itself. Lifted off before the model sees the result (D-AI8).
  if (only === "expired" && named.length === 0) {
    result.link = { surfaceKey: ASSISTANT_TOOL_PAGE.driver_file_expirations, query: driversToQuery({ file: "expired", status: null }) };
  }
  return result;
}
