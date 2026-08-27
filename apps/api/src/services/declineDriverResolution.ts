import type { SupabaseClient } from "@supabase/supabase-js";
import { cardDigits, driverMatchKey, isFullCardNumber } from "@silvicom/shared";
import type { Env } from "../env.js";
import { eachPage } from "../lib/paging.js";
import { cardRefHmac } from "../modules/efs/index.js";

/**
 * DERIVE the driver on a declined attempt (migration 0182).
 *
 * `getTranRejects` does not carry driver identity — verified against production on 2026-08-12: 110
 * records, ten fields, no driverName/driverId/infos. So the nulls in `efsSoap.ts` rejectedRows() are
 * faithful, and the Rejections page's Driver column can only ever be filled from what WE know about
 * the card. Two sources, in order of authority:
 *
 *   1. `efs_cards` — the card's assigned driver as EFS itself reports it (getCardSummaries →
 *      driverName). Matched on the FULL PAN through `card_ref_hmac`, so this is an exact card
 *      identity, not a last-4 guess.
 *   2. `efs_transactions` — the driver EFS reported on APPROVED fills for the same card. Weaker
 *      (historical rather than current) but it covers cards the mirror has not seen.
 *
 * ── The rule this file will not break ──────────────────────────────────────────────────────────
 * MATCH, DON'T GUESS — the same posture as reconcileFuelLines and attributeDeclinedRow. A masked or
 * truncated card ref names no single card (cardAssignment.ts: two drivers can share a last-4), so a
 * decline whose ref is not a full PAN is left BLANK rather than filled from a collision. Likewise a
 * card whose posted history shows two different drivers yields nothing. A blank Driver cell is a
 * fact; a wrong name in a fraud tool is a false accusation.
 *
 * Every write is fill-only: an existing driver_name is never overwritten, so an uploaded EFS report
 * (source 'efs_report') always outranks anything derived here. Idempotent and safe to re-run.
 */

/** How a decline's driver_name was arrived at. Mirrors the CHECK constraint in migration 0182. */
export type DriverNameSource = "efs_report" | "card_mirror" | "posted_history";

export interface DeclineDriverResolution {
  /** Declines examined (driver_name blank). */
  candidates: number;
  /** Rows given a name from the EFS card mirror. */
  fromCardMirror: number;
  /** Rows given a name from approved-transaction history. */
  fromPostedHistory: number;
  /** Rows additionally linked to a driver RECORD (driver_id) by the tolerant name matcher. */
  linkedToDriver: number;
  /** Blank rows left blank: masked ref, unknown card, or contradictory history. */
  stillUnresolved: number;
  /** Blank rows whose card ref cannot identify one physical card (subset of stillUnresolved). */
  unidentifiableCard: number;
}

interface BlankDecline {
  id: string;
  card_ref: string | null;
  driver_id: string | null;
}

const EMPTY: DeclineDriverResolution = {
  candidates: 0,
  fromCardMirror: 0,
  fromPostedHistory: 0,
  linkedToDriver: 0,
  stillUnresolved: 0,
  unidentifiableCard: 0,
};

/** Chunk size for `.in("id", …)` update batches — same bound driverAttribution.ts uses. */
const UPDATE_CHUNK = 500;

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

/**
 * Card → driver name from the EFS card mirror, keyed by the decline's own card ref.
 *
 * `card_ref_hmac` is HMAC(subkey, org_id || ':' || pan), computed by the mirror from the card number
 * getCardSummaries returned. Our decline refs arrive space-padded from EFS, and there is no
 * guarantee the two sides were spelled identically, so we probe BOTH the trimmed ref and its
 * digits-only form and accept whichever the mirror knows. Cheap (two hashes per distinct card) and
 * it removes an entire class of silent misses.
 */
async function mirrorNamesByRef(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  refs: string[],
): Promise<Map<string, string>> {
  const hashToRef = new Map<string, string>();
  for (const ref of refs) {
    for (const candidate of new Set([ref.trim(), cardDigits(ref)])) {
      if (candidate) hashToRef.set(cardRefHmac(env, orgId, candidate), ref);
    }
  }
  if (hashToRef.size === 0) return new Map();

  const byRef = new Map<string, string>();
  const hashes = [...hashToRef.keys()];
  for (let i = 0; i < hashes.length; i += UPDATE_CHUNK) {
    const { data, error } = await admin
      .from("efs_cards")
      .select("card_ref_hmac, driver_name")
      .eq("org_id", orgId)
      .in("card_ref_hmac", hashes.slice(i, i + UPDATE_CHUNK));
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { card_ref_hmac: string; driver_name: string | null }[]) {
      const name = clean(row.driver_name);
      const ref = hashToRef.get(row.card_ref_hmac);
      if (name && ref && !byRef.has(ref)) byRef.set(ref, name);
    }
  }
  return byRef;
}

/**
 * Card digits → driver name from APPROVED transaction history, for cards the mirror cannot name.
 *
 * A card that shows two different drivers across its history is dropped rather than resolved to the
 * most recent or most frequent one: this is a fraud tool, and "whoever used it last" is exactly the
 * assumption that turns a shared card into a wrong accusation. Same never-guess bar as
 * learnEfsDriverIds, which drops an ext id seen with two drivers.
 */
async function postedNamesByCard(
  admin: SupabaseClient,
  orgId: string,
  wantedDigits: Set<string>,
): Promise<Map<string, string>> {
  if (wantedDigits.size === 0) return new Map();

  // ONE pass. Per card we keep the distinct match KEYS seen (the ambiguity test) and the first
  // display spelling (what we actually write) — a second scan of efs_transactions to recover the
  // spelling would double the cost of the most expensive query in this file for nothing.
  const seen = new Map<string, { keys: Set<string>; display: string }>();
  await eachPage<{ card_num: string | null; driver_name: string | null }>(
    (from, to) =>
      admin
        .from("efs_transactions")
        .select("card_num, driver_name")
        .eq("org_id", orgId)
        .not("driver_name", "is", null)
        .range(from, to),
    (rows) => {
      for (const row of rows) {
        const digits = cardDigits(row.card_num);
        const name = clean(row.driver_name);
        if (!name || !digits || !wantedDigits.has(digits)) continue;
        const entry = seen.get(digits) ?? { keys: new Set<string>(), display: name };
        // Compare on the tolerant match key so "BOOTHE, DONOVAN" and "Donovan Boothe" are ONE
        // driver, not a contradiction that discards a perfectly good answer.
        entry.keys.add(driverMatchKey(name) || name.toLowerCase());
        seen.set(digits, entry);
      }
    },
  );

  const out = new Map<string, string>();
  for (const [digits, entry] of seen) if (entry.keys.size === 1) out.set(digits, entry.display);
  return out;
}

/** Tolerant name → driver record id, with collisions dropped (never guess between two people). */
async function driverIdsByName(admin: SupabaseClient, orgId: string): Promise<Map<string, string>> {
  const { data } = await admin.from("drivers").select("id, full_name").eq("org_id", orgId);
  const byKey = new Map<string, string | null>();
  for (const d of (data ?? []) as { id: string; full_name: string }[]) {
    const key = driverMatchKey(d.full_name);
    if (!key) continue;
    byKey.set(key, byKey.has(key) ? null : d.id); // second sighting poisons the key
  }
  const out = new Map<string, string>();
  for (const [key, id] of byKey) if (id) out.set(key, id);
  return out;
}

/**
 * Apply one resolved driver to a batch of decline ids. Two statements on purpose:
 *
 *   1. the name + its provenance, guarded by `driver_name is null` so a concurrent EFS-report import
 *      that just filled the row wins over this derived value rather than being clobbered;
 *   2. the driver_id link, separately guarded by `driver_id is null` — attribution set by ingest or
 *      by attributeDeclines() is evidence from a different route and must not be overwritten by a
 *      name match.
 *
 * Returns how many rows each statement actually touched, so the caller's counters describe what
 * happened rather than what was attempted.
 */
async function applyResolution(
  admin: SupabaseClient,
  orgId: string,
  ids: string[],
  resolved: { name: string; source: DriverNameSource; driverId?: string },
): Promise<{ named: number; linked: number }> {
  let named = 0;
  let linked = 0;
  for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
    const chunk = ids.slice(i, i + UPDATE_CHUNK);
    const { data, error } = await admin
      .from("declined_transactions")
      .update({ driver_name: resolved.name, driver_name_source: resolved.source })
      .eq("org_id", orgId)
      .is("driver_name", null)
      .in("id", chunk)
      .select("id");
    if (error) throw new Error(error.message);
    named += data?.length ?? 0;

    if (!resolved.driverId) continue;
    const { data: linkedRows, error: linkError } = await admin
      .from("declined_transactions")
      .update({ driver_id: resolved.driverId })
      .eq("org_id", orgId)
      .is("driver_id", null)
      .in("id", chunk)
      .select("id");
    if (linkError) throw new Error(linkError.message);
    linked += linkedRows?.length ?? 0;
  }
  return { named, linked };
}

/**
 * Fill the Driver column on every decline that has no name yet. Idempotent; safe to re-run; never
 * overwrites. Called at reject ingest (efsIngestReject.ts) and from scoreDeclinedOrg, so the
 * Rejections page's "Rescore" button backfills history without a bespoke route.
 */
export async function resolveDeclineDrivers(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
): Promise<DeclineDriverResolution> {
  const blanks: BlankDecline[] = [];
  await eachPage<BlankDecline>(
    (from, to) =>
      admin
        .from("declined_transactions")
        .select("id, card_ref, driver_id")
        .eq("org_id", orgId)
        .is("driver_name", null)
        .range(from, to),
    (rows) => blanks.push(...rows),
  );
  if (blanks.length === 0) return EMPTY;

  // A masked/short ref identifies no single card. Those rows are counted and left alone.
  const identifiable = blanks.filter((b) => isFullCardNumber(b.card_ref));
  const unidentifiableCard = blanks.length - identifiable.length;

  const refs = [...new Set(identifiable.map((b) => (b.card_ref ?? "").trim()).filter(Boolean))];
  const mirror = await mirrorNamesByRef(admin, env, orgId, refs);

  const unresolvedDigits = new Set(
    identifiable
      .filter((b) => !mirror.has((b.card_ref ?? "").trim()))
      .map((b) => cardDigits(b.card_ref))
      .filter(Boolean),
  );
  const posted = await postedNamesByCard(admin, orgId, unresolvedDigits);
  const driverIds = await driverIdsByName(admin, orgId);

  // Group by (name, source) so each distinct driver costs one update round trip, not one per row.
  const batches = new Map<string, { name: string; source: DriverNameSource; ids: string[] }>();
  let unresolved = unidentifiableCard;
  for (const row of identifiable) {
    const ref = (row.card_ref ?? "").trim();
    const fromMirror = mirror.get(ref);
    const name = fromMirror ?? posted.get(cardDigits(row.card_ref));
    if (!name) {
      unresolved += 1;
      continue;
    }
    const source: DriverNameSource = fromMirror ? "card_mirror" : "posted_history";
    const key = `${source}|${name}`;
    const batch = batches.get(key) ?? { name, source, ids: [] };
    batch.ids.push(row.id);
    batches.set(key, batch);
  }

  const result: DeclineDriverResolution = {
    ...EMPTY,
    candidates: blanks.length,
    stillUnresolved: unresolved,
    unidentifiableCard,
  };
  for (const { name, source, ids } of batches.values()) {
    const { named, linked } = await applyResolution(admin, orgId, ids, {
      name,
      source,
      driverId: driverIds.get(driverMatchKey(name)),
    });
    if (source === "card_mirror") result.fromCardMirror += named;
    else result.fromPostedHistory += named;
    result.linkedToDriver += linked;
  }
  return result;
}
