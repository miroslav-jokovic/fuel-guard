/** Decode (NOT verify) a Supabase access token's payload for UX gating. Real enforcement is server-side
 *  in admin-api against the JWKS; the client only reads claims to decide what to show. */
interface Claims {
  sub?: string;
  email?: string;
  aal?: string; // 'aal1' | 'aal2'
}

export function decodeClaims(token: string | undefined | null): Claims | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as Claims;
  } catch {
    return null;
  }
}
