import type { UnlockCodeAnswer, UnlockCodeChannel, UnlockCodeLanguage } from "@silvicom/shared";
import { publicFetch, type ApplyDraft } from "./useApplication";

/**
 * How a saved application opens: the date of birth (D-APP16), the one-time code in its place (F0b), and
 * the token a right answer left on this phone (U2). Their own file because `useApplication.ts` sits at
 * the 500-line budget.
 */

/**
 * Release a gated draft with the date of birth that is in it (D-APP16). `remember` is U2's "this is my
 * phone": a right answer then also returns a device token. Moved here from `useApplication.ts` on
 * 2026-11-14 — the three ways a saved application opens are now one file.
 */
export const unlockApplicationDraft = (token: string, dateOfBirth: string, remember = false): Promise<{ draft: ApplyDraft }> =>
  publicFetch<{ draft: ApplyDraft }>(`/${token}/unlock`, {
    method: "POST",
    body: JSON.stringify({ date_of_birth: dateOfBirth, ...(remember ? { remember_device: true } : {}) }),
  });

/** "Send me a code": a channel and the page's language, never an address — the server sends it where the link went. */
export const requestUnlockCode = (token: string, channel: UnlockCodeChannel, language: UnlockCodeLanguage): Promise<UnlockCodeAnswer> =>
  publicFetch<UnlockCodeAnswer>(`/${token}/unlock-code`, { method: "POST", body: JSON.stringify({ channel, language }) });

/** The code in place of the date of birth — the same released draft `/unlock` answers with. */
export const unlockWithCode = (token: string, code: string, remember = false): Promise<{ draft: ApplyDraft }> =>
  publicFetch<{ draft: ApplyDraft }>(`/${token}/unlock-code/verify`, {
    method: "POST",
    body: JSON.stringify({ code, ...(remember ? { remember_device: true } : {}) }),
  });

/** U2 (0604): the token a right answer left on this device, in place of asking again. */
export const unlockWithDevice = (token: string, deviceToken: string): Promise<{ draft: ApplyDraft }> =>
  publicFetch<{ draft: ApplyDraft }>(`/${token}/unlock-device`, { method: "POST", body: JSON.stringify({ device_token: deviceToken }) });
