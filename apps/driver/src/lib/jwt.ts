import type { AuthClaims } from '@fuelguard/shared';

// Base64 alphabet — decoded manually so we don't depend on `atob`/`Buffer`/`TextDecoder`, none of
// which are reliably present on Hermes. Pure, deterministic, UTF-8 correct.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const e1 = B64.indexOf(clean[i] ?? 'A');
    const e2 = B64.indexOf(clean[i + 1] ?? 'A');
    const e3 = i + 2 < clean.length ? B64.indexOf(clean[i + 2] ?? '') : -1;
    const e4 = i + 3 < clean.length ? B64.indexOf(clean[i + 3] ?? '') : -1;
    bytes.push(((e1 << 2) | (e2 >> 4)) & 0xff);
    if (e3 !== -1) bytes.push((((e2 & 15) << 4) | (e3 >> 2)) & 0xff);
    if (e4 !== -1) bytes.push((((e3 & 3) << 6) | e4) & 0xff);
  }
  return Uint8Array.from(bytes);
}

function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++] ?? 0;
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b >= 0xc0 && b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | ((bytes[i++] ?? 0) & 0x3f));
    } else if (b >= 0xe0 && b < 0xf0) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | (((bytes[i++] ?? 0) & 0x3f) << 6) | ((bytes[i++] ?? 0) & 0x3f),
      );
    } else {
      const cp =
        ((b & 0x07) << 18) |
        (((bytes[i++] ?? 0) & 0x3f) << 12) |
        (((bytes[i++] ?? 0) & 0x3f) << 6) |
        ((bytes[i++] ?? 0) & 0x3f);
      const c = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    }
  }
  return out;
}

/**
 * Decode (NOT verify) a JWT payload to read our custom claims (org_id, user_role) for UI gating —
 * the RN port of the web's `decodeClaims`. The client trusts its own Supabase-issued session; real
 * authorization is RLS + the API. NEVER use this for a security decision. Plan §3.2.
 */
export function decodeClaims(accessToken: string | null | undefined): AuthClaims | null {
  if (!accessToken) return null;
  const parts = accessToken.split('.');
  const payload = parts[1];
  if (parts.length !== 3 || !payload) return null;
  try {
    const json = utf8Decode(base64ToBytes(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return JSON.parse(json) as AuthClaims;
  } catch {
    return null;
  }
}
