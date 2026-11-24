import { describe, expect, it } from 'vitest';
import { ERROR_WORDS, driverError } from '@/lib/errorWords';

describe('driverError', () => {
  it('never shows a status number to a driver, whatever the status', () => {
    for (const status of [400, 401, 403, 404, 408, 409, 410, 422, 429, 500, 502, 503, 504, 418]) {
      expect(driverError(status).message).not.toMatch(/\d{3}/);
      expect(driverError(status).message).not.toMatch(/HTTP/);
    }
  });

  it('chooses the sentence by status when the server sent no envelope', () => {
    expect(driverError(401).message).toBe(ERROR_WORDS.signedOut);
    expect(driverError(403).message).toBe(ERROR_WORDS.forbidden);
    expect(driverError(404).message).toBe(ERROR_WORDS.notFound);
    expect(driverError(409).message).toBe(ERROR_WORDS.conflict);
    expect(driverError(400).message).toBe(ERROR_WORDS.invalid);
    expect(driverError(429).message).toBe(ERROR_WORDS.busy);
    expect(driverError(503).message).toBe(ERROR_WORDS.busy);
  });

  it('keeps a domain refusal in the words its route wrote for the driver', () => {
    const refusal = driverError(409, { code: 'stop_completed', message: 'This stop is already complete.' });
    expect(refusal).toEqual({ code: 'stop_completed', message: 'This stop is already complete.', detail: 'HTTP 409 · stop_completed · This stop is already complete.' });
    expect(driverError(403, { code: 'device_limit', message: 'This account is signed in on three devices.' }).message)
      .toBe('This account is signed in on three devices.');
  });

  it("replaces an operator's message — a 500's log reference, a 400's schema issue — with a sentence", () => {
    const dbFailure = driverError(500, { code: 'db_error', message: 'Could not load loads (ref: 3f9a1c2b)' });
    expect(dbFailure.message).toBe(ERROR_WORDS.busy);
    expect(dbFailure.detail).toBe('HTTP 500 · db_error · Could not load loads (ref: 3f9a1c2b)');
    expect(driverError(400, { code: 'invalid_request', message: 'Expected string, received null' }).message).toBe(ERROR_WORDS.invalid);
    expect(driverError(404, { code: 'not_found', message: 'Load not found' }).message).toBe(ERROR_WORDS.notFound);
    expect(driverError(409, { code: 'error', message: 'duplicate key value violates unique constraint' }).message).toBe(ERROR_WORDS.conflict);
  });

  it('keeps the code and the technical detail for Sentry and the build card', () => {
    expect(driverError(502)).toEqual({ code: 'error', message: ERROR_WORDS.busy, detail: 'HTTP 502' });
  });
});
