import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { DEVICE_KEY_HEADER, DEVICE_KEY_PATTERN } from '@silvicom/shared';

/**
 * This phone's own device key (INSTALLED-APP-PLAN IA-S6; migration 0620) — the driver app's half of what
 * `apps/web/src/lib/deviceKey.ts` does in a browser: a random value made once per install and kept, sent with
 * every API call, so the API remembers the phone across sign-ins as ONE device in one of the three places.
 *
 * It names nothing and proves nothing, so it lives in AsyncStorage, not the secure store: the database binds a
 * session to one device the first time it sees it and ignores a later key, so a copied key gains nothing.
 * Every call carries it because the first request of a new session decides its device — `apiFetch` is the only
 * place this app calls the API with a token.
 *
 * A storage failure is not a reason to fail a request: the key then lives for this launch, which costs at most
 * one extra device in the history.
 */
const STORAGE_KEY = 'silvicom.device-key';
let memo: Promise<string> | null = null;

const make = (): string => Crypto.randomUUID().replace(/-/g, '');

async function load(): Promise<string> {
  try {
    const kept = await AsyncStorage.getItem(STORAGE_KEY);
    if (kept && DEVICE_KEY_PATTERN.test(kept)) return kept;
    const fresh = make();
    await AsyncStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return make();
  }
}

export function deviceKey(): Promise<string> {
  memo ??= load();
  return memo;
}

/** The header to spread into a request to the API. */
export async function deviceHeader(): Promise<Record<string, string>> {
  return { [DEVICE_KEY_HEADER]: await deviceKey() };
}

/** For tests: forget the remembered key. */
export function resetDeviceKeyForTests(): void {
  memo = null;
}
