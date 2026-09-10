import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CROCKFORD_ALPHABET, TAG_ID_LENGTH } from "@silvicom/shared";
import type { ServiceError } from "./types.js";

/**
 * Issuing a tag code (INVENTORY-PLAN.md I10; D-INV18, `tagContract.ts`).
 *
 * ── WHY THIS IS NOT IN `tagContract.ts`, WHICH OWNS EVERYTHING ELSE ABOUT A TAG ───────────────
 * That file is pure by contract — no clock, no randomness, no I/O — because four things must agree
 * about a tag's GRAMMAR (the label PDF, the scanner, the resolve endpoint, the typed-entry field)
 * and a shared pure module is how they are kept from drifting. Issuing a NEW id agrees with none of
 * them: it needs a random source and a uniqueness check against a table, and its own header says so
 * and points here. This file knows how to mint one; it does not know what one means.
 *
 * ── THE BIRTHDAY MATH IS THE WHOLE REASON THIS RETRIES ────────────────────────────────────────
 * Six Crockford characters is 32^6 ≈ 1.07 billion, and ids are unique per ORG, so one carrier draws
 * from the whole billion. That sounds like enough to generate and trust, and it is not:
 * `tagContract.ts` records the number — **roughly 4.5 % odds of a collision somewhere in the set by
 * 10,000 tags**. A shop with 234 trailers, 207 tractors and a parts catalogue reaches four figures.
 *
 * So the insert IS the uniqueness check. `idx_part_stock_tag` and `idx_inventory_assets_tag` are
 * partial unique indexes on `(org_id, tag_code)`, and a duplicate arrives as 23505 (or, on assets,
 * as 0333's `IV022` from `guard_inventory_asset`, which checks the same thing a statement earlier).
 * Either one means "draw again", and after `MAX_ATTEMPTS` it means something is wrong that another
 * random number will not fix.
 *
 * ── `randomInt`, NOT `Math.random()` ──────────────────────────────────────────────────────────
 * Not for secrecy — a tag id is printed on the outside of a trailer and is not a credential; the
 * org scoping in `tags/registry.ts` is what makes a guessed id useless. It is for DISTRIBUTION.
 * `Math.random() * 32 | 0` is the standard modulo-bias shape, and a generator whose low characters
 * cluster spends the birthday budget faster than the arithmetic above assumes. `randomInt` is
 * rejection-sampled and free at this volume.
 *
 * ── AND WHY A TAG IS ONLY EVER SET ON A ROW THAT HAS NONE ─────────────────────────────────────
 * A tag is printed onto polyester and stuck to a tablet. Re-issuing one is how two physical objects
 * come to answer to a single code, and the second one is discovered by a technician holding it in a
 * bay months later. 0333's `guard_inventory_asset` refuses a change for the service role too
 * (`IV022`) — but **`part_stock` has NO such trigger**, only the unique index, so for a stock line
 * the guarantee lives here, in the `.is("tag_code", null)` predicate below. That asymmetry is
 * deliberate for now (I10 ships no migration) and is written into the plan's §8 as owed: the next
 * inventory migration should give `part_stock` the trigger its sibling already has.
 *
 * The predicate is not merely a filter — it is what makes concurrent issuance safe. Two requests
 * for the same shelf both read null, both UPDATE, and exactly one matches a row; the loser sees
 * zero rows changed and re-reads the winner's code rather than overwriting it.
 */

/**
 * How many draws before giving up.
 *
 * Six is far past the point of usefulness and that is the point: at 10,000 issued tags a single
 * draw collides with probability under 0.001 %, so six consecutive collisions is not bad luck, it
 * is a broken random source or a table in a state this function has misunderstood. Retrying forever
 * would turn either into a hung request.
 */
const MAX_ATTEMPTS = 6;

/** A duplicate, however the database chose to phrase it. */
const isCollision = (code: string | undefined): boolean => code === "23505" || code === "IV022";

/** Six Crockford characters, drawn without modulo bias. */
export function mintTagId(): string {
  let out = "";
  for (let i = 0; i < TAG_ID_LENGTH; i += 1) {
    out += CROCKFORD_ALPHABET[randomInt(CROCKFORD_ALPHABET.length)];
  }
  return out;
}

/** Which table a tag is being stamped on, and how to find the one row. */
export type TagSubject =
  | { table: "part_stock"; match: { part_id: string; location_id: string } }
  | { table: "inventory_assets"; match: { id: string } };

interface StampResult {
  rows: Array<{ tag_code: string }> | null;
  errorCode: string | undefined;
  failed: boolean;
}

/**
 * The two statements this needs, bound to one row.
 *
 * ⚠ **Each branch names its table as a LITERAL, and that is a gate requirement rather than a style
 * preference.** `admin.from(subject.table)` reads perfectly well and is invisible to every table
 * gate in the repo — `lint:table-access` refuses it by name, and `lint:table-writers`, which freezes
 * the (table → file) pairs that may write, simply would not see this file at all. A writer nothing
 * can see is how a second producer for an owned table arrives unnoticed, which is the whole thing
 * that gate exists to prevent. So the dispatch is a branch and the algorithm below stays shared.
 */
function stamperFor(admin: SupabaseClient, orgId: string, subject: TagSubject) {
  if (subject.table === "part_stock") {
    const { part_id, location_id } = subject.match;
    return {
      read: async (): Promise<{ tag_code: string | null } | null | undefined> => {
        const { data, error } = await admin
          .from("part_stock")
          .select("tag_code")
          .eq("org_id", orgId)
          .eq("part_id", part_id)
          .eq("location_id", location_id)
          .maybeSingle();
        if (error) return undefined;
        return data as { tag_code: string | null } | null;
      },
      stamp: async (code: string): Promise<StampResult> => {
        const { data, error } = await admin
          .from("part_stock")
          .update({ tag_code: code })
          .eq("org_id", orgId)
          .eq("part_id", part_id)
          .eq("location_id", location_id)
          // The concurrency guarantee, and — for `part_stock`, which has no trigger — the
          // immutability one as well. See the header.
          .is("tag_code", null)
          .select("tag_code");
        return {
          rows: (data ?? null) as Array<{ tag_code: string }> | null,
          errorCode: error?.code,
          failed: Boolean(error),
        };
      },
    };
  }

  const { id } = subject.match;
  return {
    read: async (): Promise<{ tag_code: string | null } | null | undefined> => {
      const { data, error } = await admin
        .from("inventory_assets")
        .select("tag_code")
        .eq("org_id", orgId)
        .eq("id", id)
        .maybeSingle();
      if (error) return undefined;
      return data as { tag_code: string | null } | null;
    },
    stamp: async (code: string): Promise<StampResult> => {
      const { data, error } = await admin
        .from("inventory_assets")
        .update({ tag_code: code })
        .eq("org_id", orgId)
        .eq("id", id)
        // Belt and braces: 0333's `guard_inventory_asset` already refuses a change for the service
        // role too (`IV022`), so this predicate is what makes the RACE cheap rather than what makes
        // it safe — a loser matches zero rows instead of raising.
        .is("tag_code", null)
        .select("tag_code");
      return {
        rows: (data ?? null) as Array<{ tag_code: string }> | null,
        errorCode: error?.code,
        failed: Boolean(error),
      };
    },
  };
}

/**
 * Give one row a tag code, or hand back the one it already has.
 *
 * Idempotent by design rather than by accident: a caller that asks twice — a preview followed by a
 * print, or a print retried after a dropped connection — gets the same code both times, because the
 * first call's code is already in the row and the `.is("tag_code", null)` predicate matches nothing
 * the second time. That is what lets the label screen preview and print without either step being
 * the one that "really" assigns.
 */
export async function issueTagCode(
  admin: SupabaseClient,
  orgId: string,
  subject: TagSubject,
): Promise<string | ServiceError> {
  const row = stamperFor(admin, orgId, subject);

  const existing = await row.read();
  if (existing === undefined) {
    return { code: "tag_lookup_failed", error: "Could not read that label's row." };
  }
  if (existing === null) {
    return { code: "IV024", error: "That item is not on file." };
  }
  if (existing.tag_code) return existing.tag_code;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const written = await row.stamp(mintTagId());

    if (written.failed) {
      if (isCollision(written.errorCode)) continue;
      return { code: "tag_issue_failed", error: "Could not assign a label code." };
    }

    const stamped = written.rows?.[0];
    if (stamped) return stamped.tag_code;

    // Zero rows changed and no error: somebody else issued a code between the read above and this
    // UPDATE. Their code is the right answer — re-read rather than trying to win the race.
    const raced = await row.read();
    if (raced && raced.tag_code) return raced.tag_code;
    // The row lost its tag between two statements, which no path in this product does. Draw again
    // rather than assert; the loop's own bound is what stops this being forever.
  }

  return {
    code: "tag_issue_exhausted",
    error: "Could not assign a label code. Try again, and tell somebody if it happens twice.",
  };
}
