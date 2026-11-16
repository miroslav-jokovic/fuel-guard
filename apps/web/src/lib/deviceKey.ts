import { DEVICE_KEY_HEADER, DEVICE_KEY_PATTERN } from "@silvicom/shared";

/**
 * This browser's own device key (INSTALLED-APP-PLAN IA-S6; migration 0620): a random value made once and kept in
 * local storage, sent with every API call so the API can remember the device across sign-ins — the office PC that
 * signs out on Friday and in on Monday is one device in one of the three places, not two.
 *
 * It names nothing and proves nothing: it is not a credential, and a caller sending somebody else's gains
 * nothing — the database binds a session to one device the first time it sees it and ignores a later key.
 *
 * EVERY call to the API carries it, not only `apiFetch`'s: the first request a new session makes decides its
 * device, and a download or a map tile that went first without the key would record the browser as a second
 * device keyed by its session. The call sites that build their own headers spread `deviceHeader()`.
 *
 * Local storage, not session storage: a tab is not a device. The installed app on a PC shares it with the
 * browser it was installed from, which is right — they also share one sign-in. Where storage is refused
 * (some private windows) the key lives for the page, which is what that window's sign-in does too.
 */
const STORAGE_KEY = "silvicom.device-key";
let memo: string | null = null;

function make(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "");
}

export function deviceKey(): string {
  if (memo) return memo;
  try {
    const kept = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (kept && DEVICE_KEY_PATTERN.test(kept)) return (memo = kept);
    const fresh = make();
    globalThis.localStorage?.setItem(STORAGE_KEY, fresh);
    return (memo = fresh);
  } catch {
    return (memo = make());
  }
}

/** The header to spread into any request to the API. */
export function deviceHeader(): Record<string, string> {
  return { [DEVICE_KEY_HEADER]: deviceKey() };
}

/** For tests: forget the remembered key. */
export function resetDeviceKeyForTests(): void {
  memo = null;
}
