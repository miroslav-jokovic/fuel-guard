/**
 * Which of a card's own prompt values the mirror is entitled to write down.
 *
 * Split from `efsCardMirror.ts` at the 500-line budget, along a line the design already draws: that
 * file syncs a fleet, this one answers one narrow question about a single card — given the record EFS
 * returned, what may the detail pass say about who and what this card is attributed to.
 */

/**
 * The value a prompt carries, from whichever of its two fields is holding it.
 *
 * A prompt stores its value in `matchValue` when the pump VALIDATES the driver's entry against it,
 * and in `reportValue` when the entry is merely recorded (`REPORT_ONLY`). EFS returns the unused one
 * as nil — see `getCardV2.reportOnly.xml`, where `matchValue` is nil and `reportValue` is `T001`.
 *
 * This read looked at `matchValue` alone, so after ANY change to a REPORT_ONLY prompt the attribution
 * columns were simply not written and the Cards page and drawer header kept the previous value.
 * Reported from live QA on 2026-08-14: the Unit Number changed in the prompts panel and did not
 * change in the header above it. Same shape as the Phase 1 `reportValue` bug — a reader that knew
 * about one of the two places a prompt keeps its value.
 *
 * Empty counts as absent, so a blank record falls through to null and `preserveAttribution` omits the
 * column rather than writing `""`. That matches what this pass is entitled to answer: it REFINES an
 * attribution when the card carries its own record, and clearing one stays the roster pass's job.
 */
export const infoValue = (
  document: { infos?: { infoId: string; matchValue: string | null; reportValue?: string | null }[] },
  id: string,
): string | null => {
  const info = document.infos?.find((i) => i.infoId === id);
  for (const value of [info?.matchValue, info?.reportValue]) {
    if (value != null && value.trim() !== "") return value;
  }
  return null;
};

/**
 * The three denormalised attribution columns, written ONLY when this document actually says something.
 *
 * ── The erasure this prevents ───────────────────────────────────────────────────────────────────
 * `getCardSummaries` reports the driver id, driver name and unit number EFS attributes to a card. But
 * `getCardv2` returns CARD-LEVEL records only, even when the source is BOTH (p36) — so a card whose
 * prompts live on its POLICY has an empty `infos` array and `infoValue` returns null for all three.
 *
 * Writing those nulls back is what made the Cards page lose its Unit and Driver ID columns: the roster
 * pass learned the values, the detail pass blanked them minutes later, and a card that had shown a
 * driver went to "—" and stayed there. Same shape as the `document: {}` erasure fixed earlier — that
 * fix protected the document and the version, and left these three exposed.
 *
 * ── Why omitting is not the same as going stale ─────────────────────────────────────────────────
 * The roster pass writes all three on EVERY sweep, including when EFS reports null. So it remains the
 * authority that CLEARS a value when a driver really is unassigned; this pass only refines it when the
 * card carries its own record. A value can therefore never outlive what EFS reports — it just stops
 * being destroyed by the pass that was never entitled to answer the question.
 */
export function preserveAttribution(card: { infos: { infoId: string; matchValue: string | null }[] }): Record<string, string> {
  const out: Record<string, string> = {};
  const drid = infoValue(card, "DRID");
  const unit = infoValue(card, "UNIT");
  const name = infoValue(card, "NAME");
  if (drid !== null) out.driver_id_prompt = drid;
  if (unit !== null) out.unit_prompt = unit;
  if (name !== null) out.driver_name = name;
  return out;
}
