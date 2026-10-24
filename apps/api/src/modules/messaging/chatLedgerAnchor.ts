/**
 * The chat ledger's external anchor (OFFICE-CHAT-PLAN CHA4, D-CHAT12; audit of release 1, 2026-10-23).
 *
 * ── WHY A CHAIN NEEDS AN ANCHOR ─────────────────────────────────────────────────────────────────
 * `chat_ledger` is hash-chained and WORM (0511), and `chat_ledger_verify` (0512) recomputes the chain
 * every night (CHA1). That proves the chain is consistent WITH ITSELF. It does not prove it is the
 * chain that existed yesterday: whoever holds the `postgres` role — the dashboard's SQL editor, the
 * database password — can declare the retention transaction 0511 allows, delete the tail, or disable
 * the triggers, rewrite a row and recompute every hash after it, and the verifier passes. The audit of
 * release 1 named that as the one hole in the tamper evidence.
 *
 * The standard answer is to write the chain's HEAD somewhere the database cannot reach. Every night,
 * once the chain has verified intact, the verifier puts one small object per org in the storage
 * backup's S3 bucket (#1704: the owner's own AWS account, another region, versioning on, Object Lock
 * for 90 days, an IAM user that can list, get and put and never delete). The next night, before it
 * trusts the chain, it reads yesterday's anchor back and checks two things:
 *   · the ledger still has a row at the anchored seq with the anchored hash — so nothing before the
 *     anchor was rewritten (a hash covers everything before it), and
 *   · the head has not moved backwards — so the tail was not cut off.
 * A rewrite is therefore confined to the hours since the last anchor, and a truncation is caught the
 * next morning instead of never.
 *
 * ── THE ANCHOR IS ITS KEY ────────────────────────────────────────────────────────────────────────
 * `chat-ledger-anchors/<org>/<day>-<seq, 12 digits>-<hash>.json`. The seq and the hash are IN THE
 * NAME, so reading the latest anchor is one `ListObjectsV2` — the same call the backup already makes
 * every night — and never a GetObject. The body repeats them as JSON for a person reading the bucket,
 * with how many links checked out that night and which anchor preceded it. One object per org per
 * night; with Object Lock a day's anchor cannot be removed for 90 days, and the IAM user could not
 * remove it anyway.
 *
 * ── WHERE THERE IS NO BUCKET ─────────────────────────────────────────────────────────────────────
 * Staging has no `STORAGE_BACKUP_*` variables (a deployment decision, `off` on `/api/version`). There
 * the verifier says so in its log line and self-checks the chain as before. Nothing here invents a
 * second store: the anchor rides on the bucket that already exists for the same reason — a copy the
 * database cannot touch.
 */

/** The slice of the storage backup's target this file uses (`BackupTarget` satisfies it structurally). */
export interface AnchorStore {
  inventory(prefix: string): Promise<Map<string, unknown>>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export interface LedgerAnchor {
  /** The Central calendar day the anchor was written (the verifier's `day`). */
  day: string;
  seq: number;
  hash: string;
}

export interface LedgerHead {
  seq: number;
  hash: string;
}

export const ANCHOR_PREFIX = "chat-ledger-anchors";

export function anchorPrefix(orgId: string): string {
  return `${ANCHOR_PREFIX}/${orgId}/`;
}

const KEY_RE = /^(\d{4}-\d{2}-\d{2})-(\d{12})-([0-9a-f]{64})\.json$/;

export function anchorKey(orgId: string, a: LedgerAnchor): string {
  return `${anchorPrefix(orgId)}${a.day}-${String(a.seq).padStart(12, "0")}-${a.hash}.json`;
}

/** The anchor a key names, or null for any object that is not one (a stray file, an older shape). */
export function parseAnchorKey(key: string, orgId: string): LedgerAnchor | null {
  const prefix = anchorPrefix(orgId);
  if (!key.startsWith(prefix)) return null;
  const m = KEY_RE.exec(key.slice(prefix.length));
  if (!m) return null;
  const seq = Number(m[2]);
  if (!Number.isSafeInteger(seq) || seq < 1) return null;
  return { day: m[1]!, seq, hash: m[3]! };
}

/**
 * The most recent anchor among the keys listed: the highest seq, and among equal seqs the latest day.
 * Seq first, not day, so that an anchor written for a later day but a LOWER seq — which cannot happen
 * unless the ledger was cut and re-anchored — never hides the higher one.
 */
export function latestAnchor(keys: Iterable<string>, orgId: string): LedgerAnchor | null {
  let best: LedgerAnchor | null = null;
  for (const key of keys) {
    const a = parseAnchorKey(key, orgId);
    if (!a) continue;
    if (!best || a.seq > best.seq || (a.seq === best.seq && a.day > best.day)) best = a;
  }
  return best;
}

/**
 * What yesterday's anchor says about today's ledger. Null when they agree, or when there is no anchor
 * yet (the first night, or a bucket that was never configured). Pure.
 *
 * `anchoredRow` is the ledger's row at the anchored seq as it stands now (null when none).
 */
export function judgeAnchor(
  anchor: LedgerAnchor | null,
  head: LedgerHead | null,
  anchoredRow: { hash: string } | null,
): string | null {
  if (!anchor) return null;
  if (!head || head.seq < anchor.seq) return "ledger truncated below its anchor";
  if (!anchoredRow) return "anchored ledger entry missing";
  if (anchoredRow.hash !== anchor.hash) return "anchored ledger entry altered";
  return null;
}

export async function readLatestAnchor(store: AnchorStore, orgId: string): Promise<LedgerAnchor | null> {
  const listed = await store.inventory(anchorPrefix(orgId));
  return latestAnchor(listed.keys(), orgId);
}

export async function writeAnchor(
  store: AnchorStore,
  orgId: string,
  anchor: LedgerAnchor,
  about: { checked: number; previous: LedgerAnchor | null; writtenAt: string },
): Promise<string> {
  const key = anchorKey(orgId, anchor);
  const body = {
    org: orgId,
    day: anchor.day,
    seq: anchor.seq,
    hash: anchor.hash,
    checked: about.checked,
    previous: about.previous,
    written_at: about.writtenAt,
    // For the person reading the bucket: what this object is and how to use it.
    note:
      "Head of this organisation's office chat ledger (chat_ledger) on the night named, after the chain verified " +
      "intact. To check the database against it: the row at this seq must carry this hash, and the ledger's " +
      "highest seq must not be below it.",
  };
  await store.put(key, new TextEncoder().encode(JSON.stringify(body, null, 2)), "application/json");
  return key;
}
