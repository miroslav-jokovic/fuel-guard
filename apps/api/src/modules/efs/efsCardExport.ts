import type { SupabaseClient } from "@supabase/supabase-js";
import { matchesCardFilters, type EfsCardFilters, type EfsCardSummary } from "@silvicom/shared";
import { pageAll, renderCsv, type CsvExport, type ExportScope } from "../../lib/csvExport.js";
import { EFS_CARD_LIST_COLS } from "./services/efsCardMirror.js";
import { cardRowToSummary, type EfsCardListRow } from "./services/efsCardSummary.js";

/**
 * The card inventory, as a file (FUEL-P2, D-FUI15).
 *
 * ── WHY THIS ONE IS SHAPED DIFFERENTLY FROM THE OTHER THREE ─────────────────────────────────────
 * The three Fuel Log lists page in the browser, so their exports re-run the query with the filters the
 * screen applied. The Cards page does not: it loads the whole inventory and narrows it in memory,
 * because 199 cards is a list a person scrolls rather than pages. Seven of its facets therefore exist
 * only as PREDICATES — driver, unit, policy, exception, vehicle link, sync health — and restating them
 * as SQL here would be the copy that goes stale, because nobody looks at an export when they change a
 * filter.
 *
 * So this export reads the cards the way the list route reads them (status and free text in the
 * database, where they already are) and then applies `matchesCardFilters` — **the same function the
 * page applies to the same summary rows**. One definition of what a facet means, two callers.
 *
 * ── ONE PLACE IT IS DELIBERATELY MORE COMPLETE THAN THE SCREEN ──────────────────────────────────
 * The list endpoint asks for at most 2,000 cards and the hosted PostgREST answers at most 1,000, so a
 * fleet past a thousand cards sees a truncated page — honestly, since the page compares the count it
 * was given with the rows it received and says so. The export PAGES instead, so it answers the filter
 * rather than the first thousand rows of it. A file that is a superset of a screen which admits it is
 * truncated is the right direction to differ in.
 *
 * ⚠ The service role bypasses RLS: the query carries its own `.eq("org_id", …)`, and that filter is
 * the only tenant boundary this code has.
 */

/**
 * The columns a card exports as — the page's seven, plus the facts it FILTERS on.
 *
 * The exception is two facts and the file says both, for the reason the summary type states: "2 uses
 * left" and "2 uses left at one truck stop" are different, and an auditor reading this file is doing
 * so because the second one exists. No PAN, ever — `last4` and the masked ref, exactly as the screen.
 */
const CARD_HEADERS = [
  "Card", "Status", "Driver", "Unit", "Driver ID", "Policy", "Override uses", "Override scope",
  "Vehicle link", "Last used", "Synced at", "Detail synced at", "Sync error", "Sync error source",
] as const;

export interface CardExportInput {
  orgId: string;
  /** Status and free text, as the list route applies them in the database. */
  status: string | null;
  search: string | null;
  /** The seven in-memory facets, applied by the shared predicate. */
  filters: EfsCardFilters;
  scope: ExportScope;
}

export async function exportCards(admin: SupabaseClient, input: CardExportInput): Promise<CsvExport> {
  const rows = await pageAll<EfsCardListRow>((from, to) => {
    let q = admin
      .from("efs_cards")
      .select(EFS_CARD_LIST_COLS, { count: "exact" })
      .eq("org_id", input.orgId);
    // ilike, not eq, and for the list route's reason: the filter's values come from the documented
    // enum (Active/Hold/…) while a production account stores ACTIVE/HOLD.
    if (input.status) q = q.ilike("status", input.status);
    if (input.search) {
      const term = input.search.replace(/[%,()]/g, "");
      q = q.or(
        `card_last4.ilike.%${term}%,unit_prompt.ilike.%${term}%,driver_id_prompt.ilike.%${term}%,driver_name.ilike.%${term}%`,
      );
    }
    // `card_last4` is not unique — two cards can end in the same four digits — so `id` is the
    // tiebreaker that makes the paging a total order.
    return q.order("card_last4").order("id", { ascending: true }).range(from, to);
  });

  const summaries: EfsCardSummary[] = rows.map(cardRowToSummary).filter((c) => matchesCardFilters(c, input.filters));

  return renderCsv(
    input.scope,
    CARD_HEADERS,
    summaries.map((c) => [
      c.maskedRef,
      c.status,
      c.driverName,
      c.unitPrompt,
      c.driverIdPrompt,
      c.policyNumber,
      c.overrideUses,
      // The scope of an exception, in the words the drawer uses rather than a boolean nobody can read.
      c.overrideUses == null || c.overrideUses <= 0
        ? ""
        : c.overrideAllLocations
          ? "Any location"
          : c.locationOverrideId
            ? `One location (${c.locationOverrideId})`
            : "Unknown",
      c.fuelCardId ? "Linked" : (c.linkStatus ?? "Not linked"),
      c.lastUsedDate,
      c.syncedAt,
      c.detailSyncedAt ?? "",
      c.syncError,
      c.syncErrorSource ?? "",
    ]),
  );
}
