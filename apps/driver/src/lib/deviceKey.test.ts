import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The phone's device key (INSTALLED-APP-PLAN IA-S6): made once per install, kept, in the app's alphabet — and a
 * storage failure costs a remembered device, never a request.
 */
const store = vi.hoisted(() => new Map<string, string>());
const failing = vi.hoisted(() => ({ on: false }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (k: string) => (failing.on ? Promise.reject(new Error('disk')) : Promise.resolve(store.get(k) ?? null)),
    setItem: (k: string, v: string) => (failing.on ? Promise.reject(new Error('disk')) : Promise.resolve(void store.set(k, v))),
  },
}));
let n = 0;
vi.mock('expo-crypto', () => ({ randomUUID: () => `0000000${n++}-1111-4222-8333-444455556666` }));

beforeEach(() => {
  store.clear();
  failing.on = false;
  vi.resetModules();
});

describe('deviceKey', () => {
  it('is made once in the alphabet the API accepts, and kept across launches', async () => {
    const first = await (await import('./deviceKey')).deviceKey();
    expect(first).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    vi.resetModules();
    expect(await (await import('./deviceKey')).deviceKey()).toBe(first);
  });

  it('replaces a kept value the API would not accept', async () => {
    store.set('silvicom.device-key', 'nope');
    expect(await (await import('./deviceKey')).deviceKey()).toMatch(/^[a-f0-9]{32}$/);
  });

  it('still answers when storage fails, with one key for the launch', async () => {
    failing.on = true;
    const mod = await import('./deviceKey');
    const a = await mod.deviceKey();
    expect(a).toMatch(/^[a-f0-9]{32}$/);
    expect(await mod.deviceKey()).toBe(a);
  });

  it('is sent under the header the API reads', async () => {
    const h = await (await import('./deviceKey')).deviceHeader();
    expect(Object.keys(h)).toEqual(['x-silvicom-device']);
  });
});
