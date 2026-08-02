import { describe, expect, it } from 'vitest';
import { decodeClaims } from './jwt';

// Build an unsigned JWT (header.payload.signature) with a base64url payload — decodeClaims never
// verifies the signature, so a placeholder sig is fine for these parity tests.
function makeToken(payload: Record<string, unknown>): string {
  const b64url = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;
}

describe('decodeClaims (RN base64url, no atob/Buffer/TextDecoder)', () => {
  it('reads org_id and user_role from a driver token', () => {
    const token = makeToken({
      sub: '11111111-1111-4111-8111-111111111111',
      email: 'driver@example.com',
      org_id: '22222222-2222-4222-8222-222222222222',
      user_role: 'driver',
    });
    expect(decodeClaims(token)).toEqual({
      sub: '11111111-1111-4111-8111-111111111111',
      email: 'driver@example.com',
      org_id: '22222222-2222-4222-8222-222222222222',
      user_role: 'driver',
    });
  });

  it('handles a payload with no membership yet (org pending)', () => {
    const token = makeToken({ sub: 'abc', email: 'x@y.z' });
    const claims = decodeClaims(token);
    expect(claims?.org_id).toBeUndefined();
    expect(claims?.user_role).toBeUndefined();
  });

  it('decodes multi-byte UTF-8 in claims correctly', () => {
    const token = makeToken({ sub: 'u', email: 'josé.münch@example.com', user_role: 'driver' });
    expect(decodeClaims(token)?.email).toBe('josé.münch@example.com');
  });

  it('returns null for malformed or empty tokens', () => {
    expect(decodeClaims(null)).toBeNull();
    expect(decodeClaims('')).toBeNull();
    expect(decodeClaims('not-a-jwt')).toBeNull();
    expect(decodeClaims('a.b')).toBeNull();
    expect(decodeClaims('a.%%%.c')).toBeNull();
  });
});
