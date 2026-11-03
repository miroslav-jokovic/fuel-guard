import type { HiringStepKey } from "./hiringStepGraph.js";

/**
 * The vendor portal an office opens to do a hiring step outside the product (HIRING-WORKFLOW-AUDIT §14,
 * D-OF8, owner 2026-11-03: *"Driving Record should open modal with our Samba account … Clearing House also
 * will open Modal with Clearing house login"*).
 *
 * ── A NEW TAB, NEVER A FRAME ──────────────────────────────────────────────────────────────────
 * Both portals refuse to be shown inside another site: a login page that can be framed can be clickjacked,
 * so each sends headers that stop it, and FMCSA's Clearinghouse signs in through login.gov, which refuses
 * outright. A modal around either would be an empty box. So the drawer opens the portal in a new tab, the
 * office does the act there, and comes back to drop the PDF the portal gave them — which files the record
 * the checklist reads, the D-HM6 rule that a step done outside the product still counts.
 *
 * ⚠ Samba is the carrier's own PORTAL account (Q-OF1's recommendation): the API was deprecated on cost on
 * 2026-08-26 and nothing here calls it. The address is SambaSafety's customer portal, which routes to the
 * account's platform (WebMVR or the SambaSafety Platform).
 *
 * One catalogue, read by the drawer — the address is never typed into a component.
 */
export interface HiringVendorPortal {
  /** What the button says: "Open SambaSafety". */
  name: string;
  url: string;
  /** The steps in the portal, in the office's words — what to do there and what to bring back. */
  steps: readonly string[];
}

export const HIRING_VENDOR_PORTALS: Partial<Record<HiringStepKey, HiringVendorPortal>> = {
  mvr: {
    name: "SambaSafety",
    url: "https://sambasafety.com/customer-portal",
    steps: [
      "Sign in to the company's SambaSafety account and order the record for every state that licensed them in the last three years.",
      "Download the report as a PDF.",
      "Drop it below under Scan, with the state and the date on the report, and record it.",
    ],
  },
  clearinghouse: {
    name: "the FMCSA Clearinghouse",
    url: "https://clearinghouse.fmcsa.dot.gov/",
    steps: [
      "Sign in with the company's login.gov account and run a pre-employment (full) query for this driver.",
      "The driver gets a request in their own Clearinghouse account and must give consent there before the result shows.",
      "Download the query result as a PDF and drop it below under Scan.",
    ],
  },
};

export const hiringVendorPortal = (key: HiringStepKey): HiringVendorPortal | null => HIRING_VENDOR_PORTALS[key] ?? null;
