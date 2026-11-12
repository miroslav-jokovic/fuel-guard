import { publicFetch } from "./useApplication";

/**
 * The SSN, from the form (Q-AM3, 0589): its own request, never the draft's (D-APP3). Answers with the
 * last four. Its own module, like `unlockCode.ts`, so `useApplication.ts` stays inside its budget.
 */
export const saveApplicantSsn = (token: string, ssn: string): Promise<{ ok: true; last4: string }> =>
  publicFetch<{ ok: true; last4: string }>(`/${token}/ssn`, { method: "POST", body: JSON.stringify({ ssn }) });
