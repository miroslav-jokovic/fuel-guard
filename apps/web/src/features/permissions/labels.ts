import type { AppSection } from "@silvicom/shared";

/**
 * Reader-facing names for the twelve sections.
 *
 * Moved to `@silvicom/shared` (`accessLayers.ts`) by SP10 (Q-SET10) and re-exported here unchanged.
 * Until then this feature was their only reader and one home inside it was right; the access-review
 * CSV the API renders is a second reader in a second app, and a copy of these words there would be a
 * file that names a section differently from the page an auditor checks it against.
 */
export { SECTION_LABELS } from "@silvicom/shared";

/**
 * The regulatory reader tests, which an org's matrix does not reach and must never appear to
 * (D-PERM9, `EDITABLE-PERMISSIONS-PLAN.md` §2c).
 *
 * Five RLS policies carry role lists that equal NO section's derived set, because they mirror a
 * federal confidentiality rule rather than the permission matrix: §382.401(a) puts drug and alcohol
 * testing records in "a secure location with controlled access", and §391.53(a)(1) / §391.23(k)(2)
 * put the safety-history investigation with the people deciding whether to hire. Granting a section
 * here does NOT hand those records over, and the page has to say so where the section is named — an
 * admin who believes `safety: manage` includes test results has been misled by this page about a
 * rule an audit enforces.
 */
export const SECTION_CAVEATS: Partial<Record<AppSection, string>> = {
  safety:
    "Drug and alcohol testing records stay with the roles §382.401(a) names, whatever this section says.",
  recruitment:
    "A former employer's safety-history answer stays with the roles §391.23(k)(2) names, whatever this section says.",
};
