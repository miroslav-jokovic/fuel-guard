import { Linking } from 'react-native';
import { env } from './env';

/**
 * The three published legal documents, as URLs this build can actually open (DIRECTION-B-PLAN §6 P3).
 *
 * ── WHY THEY ARE DERIVED RATHER THAN CONFIGURED ────────────────────────────────────────────────
 * The pages are routes in `apps/web`, and `apps/api` serves the built web SPA — so the host that
 * answers `/api/me/loads` is the same host that answers `/privacy`. A separate
 * `EXPO_PUBLIC_LEGAL_URL` would be a second value that has to agree with the first, set in three
 * places (a laptop `.env`, the GitHub secret, the EAS environment) and wrong in whichever of them
 * somebody forgot. Deriving it means a build pointed at staging shows staging's policy, which is the
 * behaviour you want when you are testing a change to the policy.
 *
 * ⚠ The consequence, stated so it is not discovered: if the API base is ever split off onto its own
 * host that does NOT serve the SPA, these three links break, and nothing here would notice. That
 * split is what would make a separate variable the right answer; until then it is a copy.
 */
const LEGAL_PATHS = {
  privacy: '/privacy',
  terms: '/terms',
  support: '/support',
} as const;

export type LegalDocument = keyof typeof LEGAL_PATHS;

/** The absolute URL of one document. `env.apiUrl` has already had its trailing slash stripped. */
export function legalUrl(doc: LegalDocument): string {
  return `${env.apiUrl}${LEGAL_PATHS[doc]}`;
}

/**
 * Open one of the documents in the phone's browser.
 *
 * Failure is swallowed on purpose. `openURL` rejects when no browser can handle the URL — a state
 * that effectively does not occur on a phone, and one where the useful response is nothing rather
 * than an error sheet over a settings screen. There is no work to lose and nothing for the driver
 * to do differently.
 */
export async function openLegalDocument(doc: LegalDocument): Promise<void> {
  try {
    await Linking.openURL(legalUrl(doc));
  } catch {
    /* no browser on the device — nothing useful to say, and nothing lost */
  }
}
