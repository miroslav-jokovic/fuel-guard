import { maskPan, type EfsCardSummary } from "@silvicom/shared";

/**
 * One `efs_cards` row as it comes off `EFS_CARD_LIST_COLS`, and the summary every reader gets.
 *
 * ── WHY IT IS A SERVICE AND NOT A PRIVATE HELPER IN THE ROUTE ───────────────────────────────────
 * It was a private helper in `routes/read.ts`, which was right while the list route was the only
 * reader. FUEL-P2 adds a second — the CSV export — and the mapping is where a card's masking lives:
 * `maskedRef`, the flattened link evidence, the two clocks, the error split into code and source. A
 * second hand-written version of that in an export is how a file ends up carrying a field the screen
 * masks.
 *
 * The RESULT type is `@silvicom/shared`'s `EfsCardSummary`, which is also what the browser's
 * `EfsCardRow` is: one shape, three readers, no transcription.
 */

export interface EfsCardListRow {
  id: string;
  card_last4: string;
  status: string;
  policy_number: number | null;
  driver_id_prompt: string | null;
  unit_prompt: string | null;
  driver_name: string | null;
  override_uses: number | null;
  override_all_locations: boolean | null;
  location_override_id: string | null;
  last_used_date: string | null;
  fuel_card_id: string | null;
  fuel_card_link: { status?: string; method?: string | null; candidates?: string[] } | null;
  synced_at: string;
  /** The DETAIL pass's own clock. Null means this card has never been read past its roster row. */
  detail_synced_at: string | null;
  absent_since: string | null;
  /** Step 7.5 / migration 0198: `{code, source, at}`, never a bare string. */
  sync_error: { code?: string; source?: string; at?: string } | null;
}

export const cardRowToSummary = (row: EfsCardListRow): EfsCardSummary => ({
  id: row.id,
  last4: row.card_last4,
  maskedRef: maskPan(row.card_last4),
  status: row.status,
  policyNumber: row.policy_number,
  driverIdPrompt: row.driver_id_prompt,
  unitPrompt: row.unit_prompt,
  driverName: row.driver_name,
  overrideUses: row.override_uses,
  // Both halves of an active exception, not just the count: "2 uses left" and "2 uses left at ONE
  // truck stop" are different facts, and the action drawer has to say which one it is replacing.
  overrideAllLocations: row.override_all_locations,
  locationOverrideId: row.location_override_id,
  lastUsedDate: row.last_used_date,
  fuelCardId: row.fuel_card_id,
  /**
   * WHY a card is not linked (Step 7.7). `candidates` is a count, not a list of ids: the operator
   * question is "can this be resolved and how", and shipping fuel-card ids to a browser that cannot
   * do anything with them is payload without a reader.
   */
  linkStatus: (row.fuel_card_link?.status as EfsCardSummary["linkStatus"]) ?? null,
  linkMethod: row.fuel_card_link?.method ?? null,
  linkCandidates: row.fuel_card_link?.candidates?.length ?? 0,
  syncedAt: row.synced_at,
  /**
   * Step 7.8. The override state hangs off THIS clock, not `syncedAt`.
   *
   * `synced_at` moves on every sweep because the roster pass touches every row; `detail_synced_at`
   * moves only when the card's document was actually re-read. `override_all_locations` and
   * `location_override_id` have no writer but the detail pass, so the override statement as a whole
   * is only ever as fresh as this — and it is never NEWER than `synced_at`, so reading it is the
   * conservative direction. Null = the roster has seen this card and nothing has read it.
   */
  detailSyncedAt: row.detail_synced_at,
  /** Set when EFS stopped listing the card (audit P2). The row is kept; the history is the point. */
  absentSince: row.absent_since,
  /**
   * Flattened like `fuel_card_link` above, and for the same reason: three scalars a template can
   * render beat one object every caller has to destructure. `syncError` stays the bare code so the
   * list page's health facet and any older client keep working unchanged (Step 7.5).
   */
  syncError: row.sync_error?.code ?? null,
  syncErrorSource: (row.sync_error?.source as EfsCardSummary["syncErrorSource"]) ?? null,
  syncErrorAt: row.sync_error?.at ?? null,
});
