import { randomBytes, createHash } from "node:crypto";

/**
 * Agent ingest tokens. The plaintext token is a high-entropy bearer secret handed to the on-prem sync agent;
 * only its SHA-256 hash is stored (org_integrations.ingest_token_hash), so a DB read never yields a usable
 * token. The token is shown to the admin exactly once, at issuance.
 */

/** Deterministic hash used both at issuance and on every ingest request for the by-hash lookup. */
export function hashIngestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Mint a new token: returns the one-time plaintext plus what we persist (hash + a non-secret prefix). */
export function generateIngestToken(): { token: string; hash: string; prefix: string } {
  // 32 bytes → 256 bits of entropy; base64url so it's header-safe. `fgtms_` makes it recognizable in logs.
  const token = `fgtms_${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashIngestToken(token), prefix: token.slice(0, 12) };
}
