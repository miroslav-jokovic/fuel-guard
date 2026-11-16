import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api';
import { clearDeviceLimited, isDeviceLimited, markDeviceLimited, onDeviceLimitChange } from './deviceLimit';

/**
 * The fourth-device signal (IA-S6): set by `apiFetch` on the API's 403 `device_limit`, cleared by the next
 * answer that is not a refusal — and NOT by a 401, which says nothing about places (the session is being
 * renewed). The guard, the screen and the outbox read it.
 */
vi.mock('./env', () => ({ env: { apiUrl: 'https://api.test' } }));
vi.mock('./supabase', () => ({ supabase: { auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 't' } } }) } } }));
vi.mock('./deviceKey', () => ({ deviceHeader: () => Promise.resolve({ 'x-silvicom-device': 'the-drivers-phone-0001' }) }));

let answer: { status: number; body: unknown };
beforeEach(() => {
  vi.stubGlobal('fetch', () =>
    Promise.resolve({
      ok: answer.status < 400,
      status: answer.status,
      json: () => Promise.resolve(answer.body),
      headers: { get: () => null },
    }),
  );
  clearDeviceLimited();
});

// Imported at the top, not inside a test: the first load of `./api` took over 5 s on a cold CI runner (#2476).
const call = () => apiFetch('/api/me');
const limited = () => isDeviceLimited();

describe('the device-limit signal', () => {
  it('is set by the API\'s refusal of this phone', async () => {
    answer = { status: 403, body: { error: { code: 'device_limit', message: 'You are signed in on 3 devices.' } } };
    await call();
    expect(limited()).toBe(true);
  });

  it('is not set by any other 403', async () => {
    answer = { status: 403, body: { error: { code: 'forbidden', message: 'Insufficient role' } } };
    await call();
    expect(limited()).toBe(false);
  });

  it('is cleared by the next answer — a success, or a refusal of something else', async () => {
    answer = { status: 403, body: { error: { code: 'device_limit', message: 'x' } } };
    await call();
    answer = { status: 200, body: {} };
    await call();
    expect(limited()).toBe(false);
    answer = { status: 403, body: { error: { code: 'device_limit', message: 'x' } } };
    await call();
    answer = { status: 404, body: { error: { code: 'not_found', message: 'x' } } };
    await call();
    expect(limited()).toBe(false);
  });

  it('is left alone by a 401, which is the session renewing, not a place freed', async () => {
    answer = { status: 403, body: { error: { code: 'device_limit', message: 'x' } } };
    await call();
    answer = { status: 401, body: { error: { code: 'unauthorized', message: 'x' } } };
    await call();
    expect(limited()).toBe(true);
  });

  it('tells its listeners once per change', () => {
    const fn = vi.fn();
    const off = onDeviceLimitChange(fn);
    markDeviceLimited();
    markDeviceLimited();
    clearDeviceLimited();
    off();
    markDeviceLimited();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
