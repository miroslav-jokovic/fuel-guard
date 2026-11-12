import type { UnlockCodeAnswer, UnlockCodeChannel, UnlockCodeLanguage } from "@silvicom/shared";
import { publicFetch, type ApplyDraft } from "./useApplication";

/**
 * The one-time code in place of the date of birth (F0b, APPLICATION-FIX-PLAN) — the page's two calls.
 * Their own file because `useApplication.ts` sits at the 500-line budget.
 */

/** "Send me a code": a channel and the page's language, never an address — the server sends it where the link went. */
export const requestUnlockCode = (token: string, channel: UnlockCodeChannel, language: UnlockCodeLanguage): Promise<UnlockCodeAnswer> =>
  publicFetch<UnlockCodeAnswer>(`/${token}/unlock-code`, { method: "POST", body: JSON.stringify({ channel, language }) });

/** The code in place of the date of birth — the same released draft `/unlock` answers with. */
export const unlockWithCode = (token: string, code: string): Promise<{ draft: ApplyDraft }> =>
  publicFetch<{ draft: ApplyDraft }>(`/${token}/unlock-code/verify`, { method: "POST", body: JSON.stringify({ code }) });
