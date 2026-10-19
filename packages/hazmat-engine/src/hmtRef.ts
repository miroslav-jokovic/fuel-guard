/**
 * An `hmtRef` is `${entryId}#${pg ?? "none"}` (`resolveHmtLine`, @hazmat/data; `hazmatProducts.ts`, the API).
 * The PG token never holds a "#", but an entry id may: the dataset numbers repeated rows of one name
 * `UN1950-aerosols#2`, `UN1005-ammonia-anhydrous#2` — 81 of 2,479 entries in 2026.07.x. So the ref splits at
 * its LAST "#". Every reader split at the first until 2026-10-19, and the engine placarded "UN1950-aerosols#2"
 * (Division 2.1, flammable) as the 2.2 row it shares a name with — NON-FLAMMABLE GAS — for 12 such rows a
 * different class or PG (READER-CORRECTNESS-PLAN RC1).
 *
 * @hazmat/data parses the same format for its own callers (`parseHmtRef` there); D3 keeps the two packages
 * apart, so @hazmat/golden's ref census runs every entry of the shipped dataset through both and fails when
 * either lands on another row.
 */
export function parseHmtRef(hmtRef: string): { entryId: string; pg: string | null } {
  const at = hmtRef.lastIndexOf("#");
  if (at < 0) return { entryId: hmtRef, pg: null };
  const token = hmtRef.slice(at + 1);
  return { entryId: hmtRef.slice(0, at), pg: token === "none" ? null : token };
}
