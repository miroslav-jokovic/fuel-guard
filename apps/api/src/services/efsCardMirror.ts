import { createHmac, hkdfSync } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cardLast4, cardRefsMatch, isFullCardNumber, parseEfsDateTime } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { getCardSummaries, getCardV2, type CardSummaryRow } from "../lib/efsCardOps.js";
import type { CardDocument } from "../lib/efsCardXml.js";
import { decodeSecretsKey, isSecretBoxConfigured, seal, secretAad } from "../lib/secretBox.js";
import { preserveAttribution } from "./efsCardAttribution.js";
import type { EfsSoapCredentials } from "./efsSoapCredentials.js";

/**
 * Mirror the EFS card inventory into `efs_cards` — vendor truth, refreshed on a schedule.
 *
 * WHY THIS EXISTS. FuelGuard has never known a card's actual configuration. `fuel_cards` rows are
 * INFERRED by learnCardAssignments from fill history; `fuel_cards.status` is free text with no
 * relationship to anything EFS says. So "is this card locked?" has had no answer. This service gives
 * it one.
 *
 * WHAT IT IS NOT. Not a cache the write path reads. Every mutation re-reads `getCardv2` inside its own
 * operation, because `setCardV2` is a full-document write (p137) and echoing a document from ten
 * minutes ago would undo whatever changed in the WEX portal since. The mirror exists to draw a page
 * and to notice drift — never to build a request.
 *
 * WHAT IT NEVER DOES. Write to `fuel_cards`. Attribution is `syncCardAssignments`'s job, its manual
 * rows are authoritative, and two writers on one row is how both end up wrong. The link is one
 * nullable FK pointing the other way.
 *
 * ⚠ PAN DISCIPLINE. `getCardSummaries` returns FULL CARD NUMBERS FOR THE WHOLE FLEET IN ONE RESPONSE.
 * Nothing in this file logs a row, puts one in an error, or stores one in plaintext. The number is
 * sealed on the way in and never selected on the way out.
 */

/** Columns safe to read back. `card_number_sealed` is deliberately absent — see `loadCardNumber`. */
export const EFS_CARD_LIST_COLS =
  "id, org_id, fuel_card_id, card_last4, status, policy_number, driver_id_prompt, unit_prompt, driver_name, override_uses, override_all_locations, location_override_id, last_used_date, synced_at, sync_error";

export const EFS_CARD_DETAIL_COLS = `${EFS_CARD_LIST_COLS}, original_status, payroll_status, payroll_use, company_xref, hand_enter, info_source, limit_source, location_source, time_source, last_transaction, document, card_version`;

export interface CardMirrorResult {
  orgId: string;
  cardsSeen: number;
  upserted: number;
  detailed: number;
  linked: number;
  /** Cards the roster no longer returns, newly marked absent this sweep (audit P2). */
  tombstoned: number;
  failed: number;
  errors: string[];
}

/**
 * Deterministic, keyed, org-bound lookup handle for a card number.
 *
 * Keyed rather than a bare digest on purpose: a card number has a known BIN and, once you have a
 * transaction row, a known last four, so an unkeyed SHA-256 is a few million guesses away from the
 * PAN. HKDF gives this a subkey distinct from the sealing key, so the lookup index and the ciphertext
 * do not share a secret. The org id is inside the MAC so the same physical card in two tenants
 * produces two different handles and cannot be correlated across them.
 */
export function cardRefHmac(env: Env, orgId: string, cardNumber: string): string {
  // Strict, shared decoder (audit hardening): the old inline `Buffer.from(raw, includes("-") ? …)`
  // heuristic could silently derive this subkey from a TRUNCATED key — `Buffer.from(x, "hex")` stops
  // at the first non-hex char and returns a short buffer with no error, collapsing the keyed lookup
  // handle toward the guessable bare-digest case. decodeSecretsKey asserts exactly 32 bytes.
  const master = decodeSecretsKey(env);
  const subkey = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "efs-card-ref", 32));
  return createHmac("sha256", subkey).update(`${orgId}:${cardNumber}`).digest("hex");
}


/**
 * Refresh one org's card inventory.
 *
 * Two passes on purpose. `getCardSummaries` is ONE call that returns every card — cheap, and enough
 * to know the roster. `getCardv2` is one call PER CARD and is where the prompts, limits and
 * restrictions live. A 400-card fleet at the interactive lane's pacing is several minutes, so the
 * detail pass is bounded by `maxDetail` and prioritises the cards whose detail is most stale. The
 * roster is always complete; the depth catches up across runs.
 */
export async function syncEfsCards(
  admin: SupabaseClient,
  env: Env,
  creds: EfsSoapCredentials,
  opts: { fetchImpl?: typeof fetch; maxDetail?: number } = {},
): Promise<CardMirrorResult> {
  const result: CardMirrorResult = {
    orgId: creds.orgId, cardsSeen: 0, upserted: 0, detailed: 0, linked: 0, tombstoned: 0, failed: 0, errors: [],
  };

  if (!isSecretBoxConfigured(env)) {
    // Matches saveSamsaraToken's posture: refuse to persist rather than fall back to plaintext.
    result.errors.push("SECRETS_ENCRYPTION_KEY is not configured — refusing to store card numbers");
    result.failed = 1;
    return result;
  }

  const summaries = await getCardSummaries(env, creds, { fetchImpl: opts.fetchImpl, priority: "backfill" });
  result.cardsSeen = summaries.length;

  // Which cards the mirror already holds. The roster pass MUST know, because a roster row carries no
  // document — treating a known card as new would overwrite the detailed document with `{}` (see
  // upsertFromSummary). If this read fails we stop rather than guess: a sweep that cannot tell new
  // from known is a sweep that can only do damage.
  //
  // PAGED, not `.limit(10_000)` (audit P0-7). PostgREST caps every response at the server's
  // `max-rows` (Supabase default 1000) REGARDLESS of the requested limit, and truncation is not an
  // error — so past ~1000 cards, the single-read version silently classified known cards as new and
  // the roster pass blanked their documents on every sweep. Paging to a short page is the only read
  // that cannot truncate silently; any page-level error still aborts the whole sweep.
  const knownRows: { card_ref_hmac: string; detail_synced_at: string | null }[] = [];
  const PAGE = 1_000;
  for (let from = 0; ; from += PAGE) {
    const { data: page, error: knownError } = await admin
      .from("efs_cards")
      .select("card_ref_hmac, detail_synced_at")
      .eq("org_id", creds.orgId)
      .order("card_ref_hmac", { ascending: true })
      .range(from, from + PAGE - 1);
    if (knownError) {
      result.errors.push(`could not read the existing mirror: ${errorText(knownError.message)}`);
      result.failed = summaries.length;
      return result;
    }
    const rows = (page ?? []) as { card_ref_hmac: string; detail_synced_at: string | null }[];
    knownRows.push(...rows);
    if (rows.length < PAGE) break;
  }
  const known = new Set(knownRows.map((r) => r.card_ref_hmac));
  /** When the DETAIL pass last saw each card. Null/absent = never — those go first in the budget. */
  const detailSeen = new Map(knownRows.map((r) => [r.card_ref_hmac, r.detail_synced_at]));

  for (const summary of summaries) {
    try {
      await upsertFromSummary(admin, env, creds.orgId, summary, known);
      result.upserted += 1;
    } catch (error) {
      result.failed += 1;
      // The message may quote the card number back at us; last four only, ever.
      result.errors.push(`card ••••${cardLast4(summary.cardNumber) ?? "????"}: ${errorText(error)}`);
    }
  }

  // STALEST-FIRST, not vendor order (audit P0-7). `summaries.slice(0, budget)` refreshed the same
  // prefix every sweep, so a card past the budget never acquired a document at all — the header's
  // "depth catches up across runs" was a promise the code didn't keep. Ordering by the detail
  // pass's own clock keeps it: never-detailed cards first, then oldest documents, and every card's
  // position improves as others are refreshed ahead of it.
  const budget = opts.maxDetail ?? 200;
  const byStaleness = summaries
    .map((summary) => ({
      summary,
      // Hashed once per card, not once per comparison — the HMAC is cheap but not free at fleet size.
      seenAt: detailSeen.get(cardRefHmac(env, creds.orgId, summary.cardNumber)) ?? null,
    }))
    .sort((a, b) => {
      if (a.seenAt === null && b.seenAt === null) return 0;
      if (a.seenAt === null) return -1;
      if (b.seenAt === null) return 1;
      return a.seenAt < b.seenAt ? -1 : a.seenAt > b.seenAt ? 1 : 0;
    })
    .map((entry) => entry.summary);
  for (const summary of byStaleness.slice(0, budget)) {
    try {
      await refreshCardDetail(admin, env, creds, summary.cardNumber, { fetchImpl: opts.fetchImpl });
      result.detailed += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push(`detail ••••${cardLast4(summary.cardNumber) ?? "????"}: ${errorText(error)}`);
      await admin
        .from("efs_cards")
        .update({ sync_error: errorText(error), synced_at: new Date().toISOString() })
        .eq("org_id", creds.orgId)
        .eq("card_ref_hmac", cardRefHmac(env, creds.orgId, summary.cardNumber));
    }
  }

  result.linked = await linkFuelCards(admin, creds.orgId);
  result.tombstoned = await tombstoneAbsentCards(admin, env, creds.orgId, summaries);
  return result;
}

/**
 * Mark cards the roster no longer returns as absent, and clear the mark from cards that came back.
 *
 * A card removed in the WEX portal drops out of getCardSummaries silently (audit P2). Never a hard
 * delete — efs_card_mutations cascades from efs_cards, and a removed card's history is exactly what
 * an auditor asks about. `absent_since` is set once (first sweep that misses it) and cleared the
 * moment it reappears, so a transient roster hiccup does not keep re-stamping the timestamp.
 *
 * Guarded by a NON-EMPTY roster: a sweep that legitimately returns zero cards is indistinguishable
 * here from a vendor blip that returned nothing, and tombstoning the ENTIRE fleet on one empty
 * response is the kind of damage this file refuses elsewhere. Zero summaries → touch nothing.
 */
async function tombstoneAbsentCards(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  summaries: readonly CardSummaryRow[],
): Promise<number> {
  if (summaries.length === 0) return 0;
  const present = new Set(summaries.map((s) => cardRefHmac(env, orgId, s.cardNumber)));

  // Read the org's hmac + current absent flag in pages (same max-rows discipline as the roster read).
  const rows: { card_ref_hmac: string; absent_since: string | null }[] = [];
  const PAGE = 1_000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("efs_cards")
      .select("card_ref_hmac, absent_since")
      .eq("org_id", orgId)
      .order("card_ref_hmac", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return 0; // best effort: a tombstone failure must not fail the whole sweep
    const page = (data ?? []) as { card_ref_hmac: string; absent_since: string | null }[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const nowIso = new Date().toISOString();
  const toMark = rows.filter((r) => !present.has(r.card_ref_hmac) && r.absent_since === null).map((r) => r.card_ref_hmac);
  const toClear = rows.filter((r) => present.has(r.card_ref_hmac) && r.absent_since !== null).map((r) => r.card_ref_hmac);

  if (toClear.length > 0) {
    await admin.from("efs_cards").update({ absent_since: null }).eq("org_id", orgId).in("card_ref_hmac", toClear);
  }
  if (toMark.length > 0) {
    await admin.from("efs_cards").update({ absent_since: nowIso }).eq("org_id", orgId).in("card_ref_hmac", toMark);
  }
  return toMark.length;
}

/** The roster pass: everything getCardSummaries knows, with no per-card round trip. */
async function upsertFromSummary(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  summary: CardSummaryRow,
  known: ReadonlySet<string>,
): Promise<void> {
  const last4 = cardLast4(summary.cardNumber);
  if (!last4) throw new Error("card number had no usable last four");
  const refHmac = cardRefHmac(env, orgId, summary.cardNumber);

  // What the roster genuinely knows. Deliberately NOT document/card_version: the roster call carries
  // no card document, and an upsert that wrote `document: {}` over a known row erased the detail pass's
  // work on every sweep — permanently, for any card beyond the detail budget. The empty document is
  // for FIRST sightings only, where `document not null` demands some value until the detail pass runs.
  const rosterFields = {
    card_last4: last4,
    // A status EFS reports but the getCard enum omits (notably 'Fraud', the `U` search code) is
    // stored verbatim — see 0175. Coercing it to something familiar would hide the single most
    // important thing about that card. "Unknown" rather than "Inactive" when EFS reported none:
    // the column is not-null, but inventing a real state is worse than admitting we have none.
    status: summary.status ?? "Unknown",
    policy_number: summary.policyNumber,
    company_xref: summary.companyXref,
    payroll_status: summary.payrollStatus,
    info_source: normalizeSource(summary.infoSource),
    driver_id_prompt: summary.driverId,
    unit_prompt: summary.unitNumber,
    driver_name: summary.driverName,
    // The roster now carries the actual remaining-use COUNT (WSDL int, audit W1) — no more
    // null-for-unknown: the summary is authoritative for this number on every sweep.
    override_uses: summary.override,
    synced_at: new Date().toISOString(),
    sync_error: null,
  };

  if (known.has(refHmac)) {
    // Known card: refresh the roster facts and nothing else. The sealed PAN does not change and the
    // document belongs to the detail pass.
    const { error } = await admin
      .from("efs_cards")
      .update(rosterFields)
      .eq("org_id", orgId)
      .eq("card_ref_hmac", refHmac);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await admin.from("efs_cards").upsert(
    {
      org_id: orgId,
      card_ref_hmac: refHmac,
      card_number_sealed: seal(env, summary.cardNumber, secretAad(orgId, "efs_card_pan")),
      ...rosterFields,
      // First sighting: an empty document until the detail pass replaces it — `document` is not-null
      // so the row is never half-formed. (Upsert rather than insert so two overlapping sweeps racing
      // on a brand-new card cannot fail on the unique index.)
      document: {},
      card_version: "",
    },
    { onConflict: "org_id,card_ref_hmac", ignoreDuplicates: false },
  );
  if (error) throw new Error(error.message);
}


/** The depth pass: one getCardv2, which is the only call that returns prompts, limits and restrictions. */
export async function refreshCardDetail(
  admin: SupabaseClient,
  env: Env,
  creds: EfsSoapCredentials,
  cardNumber: string,
  opts: { fetchImpl?: typeof fetch; priority?: "interactive" | "backfill" } = {},
): Promise<{ cardVersion: string }> {
  const doc = await getCardV2(env, creds, cardNumber, {
    fetchImpl: opts.fetchImpl,
    priority: opts.priority ?? "backfill",
  });
  return upsertCardDetail(admin, env, creds.orgId, cardNumber, doc);
}

/**
 * Write one already-read card document into the mirror.
 *
 * Split from `refreshCardDetail` for the post-mutation path (audit B5.1): every mutation already
 * ends with a verifying `getCardv2`, and the mirror update used to dial the vendor AGAIN to learn
 * what that read had just learned — a fourth paced call on a lane a person is waiting on. The
 * document from the verifying read goes straight in instead. Vendor truth still only ever flows
 * EFS → mirror; this just stops paying twice for the same truth.
 */
export async function upsertCardDetail(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  cardNumber: string,
  doc: CardDocument,
): Promise<{ cardVersion: string }> {
  const last4 = cardLast4(cardNumber);
  if (!last4) throw new Error("card number had no usable last four");

  const { error } = await admin.from("efs_cards").upsert(
    {
      org_id: orgId,
      card_ref_hmac: cardRefHmac(env, orgId, cardNumber),
      card_number_sealed: seal(env, cardNumber, secretAad(orgId, "efs_card_pan")),
      card_last4: last4,
      // "Unknown", not "Inactive". The column is not-null, so a card EFS reported without a status
      // needs SOME value — but Inactive is a real state an operator acts on, and inventing it means
      // the page confidently shows a working card as dead. Unknown renders verbatim.
      status: doc.card.status ?? "Unknown",
      original_status: doc.card.originalStatus,
      payroll_status: doc.card.payrollStatus,
      payroll_use: doc.card.payrollUse,
      policy_number: doc.card.policyNumber,
      company_xref: doc.card.companyXRef,
      hand_enter: doc.card.handEnter,
      info_source: doc.card.infoSource,
      limit_source: doc.card.limitSource,
      location_source: doc.card.locationSource,
      time_source: doc.card.timeSource,
      override_uses: doc.card.overrideUses,
      override_all_locations: doc.card.overrideAllLocations,
      location_override_id: doc.card.locationOverrideId,
      // driver_id_prompt / unit_prompt / driver_name are NOT written here unconditionally — see
      // preserveAttribution below. Writing them blind is what erased them on every sweep.
      ...preserveAttribution(doc.card),
      // EFS servers are Central Time and the offset is optional (p10-11). A bare timestamp read as
      // UTC lands five or six hours out and quietly makes every fill time on the page wrong.
      last_used_date: parseEfsDateTime(doc.card.lastUsedDate),
      last_transaction: doc.card.lastTransaction,
      document: doc.card,
      card_version: doc.version,
      last_response_xml_redacted: doc.redactedXml.slice(0, 60_000),
      synced_at: new Date().toISOString(),
      // The detail pass's own clock — orders the sweep's budget stalest-first (migration 0179).
      detail_synced_at: new Date().toISOString(),
      sync_error: null,
    },
    { onConflict: "org_id,card_ref_hmac", ignoreDuplicates: false },
  );
  if (error) throw new Error(error.message);
  return { cardVersion: doc.version };
}

/**
 * Point each mirror row at its `fuel_cards` row, where that can be established without guessing.
 *
 * Deliberately conservative. `fuel_cards.card_ref` is a cardIdentityKey: sometimes a full PAN,
 * sometimes "<last4>|<controlId>". A last-four match alone is NOT proof — two physical cards can
 * share four digits, and WP3c already documents the false "card assigned to a different truck" alerts
 * that a loose match produced. So: link only when exactly one candidate matches provably, and record
 * `ambiguous_fuel_card_link` otherwise. A missing link shows as "not linked"; a wrong one silently
 * attributes fuel to the wrong truck.
 */
export async function linkFuelCards(admin: SupabaseClient, orgId: string): Promise<number> {
  const { data: unlinked } = await admin
    .from("efs_cards")
    .select("id, card_last4, driver_id_prompt")
    .eq("org_id", orgId)
    .is("fuel_card_id", null)
    .limit(1000);
  if (!unlinked?.length) return 0;

  const { data: candidates } = await admin
    .from("fuel_cards")
    .select("id, card_ref, card_last4")
    .eq("org_id", orgId)
    .eq("provider", "efs")
    .limit(2000);
  if (!candidates?.length) return 0;

  let linked = 0;
  for (const row of unlinked as { id: string; card_last4: string; driver_id_prompt: string | null }[]) {
    const matches = (candidates as { id: string; card_ref: string; card_last4: string | null }[]).filter(
      (c) => c.card_last4 === row.card_last4 || cardRefsMatch(c.card_ref, row.card_last4),
    );
    if (matches.length !== 1) {
      if (matches.length > 1) {
        await admin.from("efs_cards")
          .update({ sync_error: "ambiguous_fuel_card_link" })
          .eq("id", row.id).eq("org_id", orgId);
      }
      continue;
    }
    const { error } = await admin
      .from("efs_cards")
      .update({ fuel_card_id: matches[0]!.id })
      .eq("id", row.id)
      .eq("org_id", orgId);
    if (!error) linked += 1;
  }
  return linked;
}

/** Unseal a card number for an operation that needs it. The ONLY reader of card_number_sealed. */
export async function loadCardNumber(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  efsCardId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("efs_cards")
    .select("card_number_sealed")
    .eq("id", efsCardId)
    .eq("org_id", orgId) // service role bypasses RLS; org scoping is the caller's job (audit B5)
    .maybeSingle();
  if (!data?.card_number_sealed) return null;
  const { open } = await import("../lib/secretBox.js");
  return open(env, data.card_number_sealed as string, secretAad(orgId, "efs_card_pan"));
}

/** EFS returns sources as `Policy`/`Card`/`Both` on read and `POLICY`/`CARD`/`BOTH` on write (p35 vs p134). */
function normalizeSource(value: string | null): string | null {
  if (!value) return null;
  // Case is normalised because EFS genuinely varies it between read and write. The VALUE is kept,
  // whatever it is: this used to return null for anything outside the three documented sources —
  // because 0171's check constraint would have rejected the row — so an unrecognised source was
  // silently erased and the card rendered as though EFS had said nothing about where its rules come
  // from. 0175 dropped that constraint for exactly this reason. An unexpected source is news.
  return value.toUpperCase();
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Belt and braces: a vendor message can quote the card number back at us.
  return message
    .replace(/\b\d{10,25}[A-Z]{2,6}\b/g, (value) => `••••${value.replace(/\D/g, "").slice(-4)}`)
    .replace(/\b\d{10,25}\b/g, (d) => `••••${d.slice(-4)}`)
    .slice(0, 300);
}

export { isFullCardNumber };
