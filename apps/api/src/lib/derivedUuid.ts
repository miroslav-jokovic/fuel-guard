import { createHash } from "node:crypto";

/**
 * A stable uuid derived from a key, for a row whose idempotency is keyed on a caller-supplied id.
 *
 * Derived rather than random so a retried act lands on the SAME row — `fileGeneratedDocument` and
 * `insertCertification` both return the existing row for an id they have seen, and a `randomUUID()` would
 * file a second copy every time somebody clicked twice. First written for the annual inspection's finalize
 * (`maintenance/inspections/finalize.ts`); the roadside repair certification (IC11 B2) is the second caller.
 *
 * A v5-shaped uuid derived by hashing, rather than a dependency for one function. The version and variant
 * nibbles are forced so the result is a VALID uuid — Postgres rejects one that is not, and a malformed id
 * would fail at the insert rather than at the hash.
 */
export function derivedUuid(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), `5${hex.slice(13, 16)}`, `8${hex.slice(17, 20)}`, hex.slice(20, 32)].join("-");
}
