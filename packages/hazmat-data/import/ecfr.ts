/**
 * eCFR importer (Phase H1, deliverable 2) — NOT YET IMPLEMENTED.
 *
 * Pulls Title 49 point-in-time XML from the eCFR versioner API and parses Part 172 (the HMT table),
 * §172.504(e) tables, and §177.848(d) into the dataset schema. Runs in Node only (never bundled); has
 * its own unit tests with frozen XML fixtures. Output feeds diff.ts (second-source verification) before
 * any release. Until this lands, datasets ship `provisional: true` and nothing can be cleared (H1.6).
 */
export function importFromEcfr(): never {
  throw new Error("importFromEcfr is not implemented yet — HazmatGuard Phase H1 (deliverable 2).");
}
