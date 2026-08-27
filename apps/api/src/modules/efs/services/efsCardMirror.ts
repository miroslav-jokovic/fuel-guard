import type { SupabaseClient } from "@supabase/supabase-js";
import { cardLast4, isFullCardNumber, parseEfsDateTime } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { getCardSummaries, getCardV2, type CardSummaryRow } from "../lib/efsCardOps.js";
import type { CardDocument } from "../lib/efsCardXml.js";
import { isSecretBoxConfigured, seal, secretAad } from "../../../lib/secretBox.js";
import { preserveAttribution } from "./efsCardAttribution.js";
import { unmodelledCardFields } from "../lib/efsCardFields.js";
import { linkFuelCards } from "./efsCardLinking.js";
import { cardRefHmac } from "./efsCardRef.js";
import { tombstoneAbsentCards } from "./efsCardTombstone.js";
import type { EfsSoapCredentials } from "./efsSoapCredentials.js";
import { signalDetailBudgetShort, signalMirrorSweepCompleted } from "../../../lib/cardControlSignals.js";

/**
 * Mirror the EFS card inventory into `efs_cards` — vendor truth, refreshed on a schedule.
 *
 * WHY THIS EXISTS. Silvicom 360 has never known a card's actual configuration. `fuel_cards` rows are
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

/**
 * Columns safe to read back. `card_number_sealed` is deliberately absent — see `loadCardNumber`.
 *
 * `detail_synced_at` and `absent_since` were both added by Step 7.5/7.8, and both were columns the
 * mirror maintained that no surface could see:
 *   • `detail_synced_at` is the clock the OVERRIDE state hangs off (Step 7.8). `synced_at` is the
 *     roster clock and moves every sweep whether or not the card's document was re-read, so a page
 *     that renders one while meaning the other says "checked an hour ago" about a document from
 *     Tuesday.
 *   • `absent_since` is the tombstone. A card WEX has de-listed rendered identically to a live one.
 */
export const EFS_CARD_LIST_COLS =
  "id, org_id, fuel_card_id, fuel_card_link, card_last4, status, policy_number, driver_id_prompt, unit_prompt, driver_name, override_uses, override_all_locations, location_override_id, last_used_date, synced_at, detail_synced_at, absent_since, sync_error";

export const EFS_CARD_DETAIL_COLS = `${EFS_CARD_LIST_COLS}, original_status, payroll_status, payroll_use, company_xref, hand_enter, info_source, limit_source, location_source, time_source, last_transaction, document, card_version`;

export interface CardMirrorResult {
  orgId: string;
  cardsSeen: number;
  upserted: number;
  detailed: number;
  linked: number;
  /** Cards the roster no longer returns, newly marked absent this sweep (audit P2). */
  tombstoned: number;
  /**
   * Cards the roster stopped listing that the ratio guard REFUSED to mark (Step 7.5). Non-zero means
   * `tombstoned` is 0 by decision, not because nothing disappeared — the two must be read together.
   */
  tombstoneRefused: number;
  /**
   * Cards this sweep could not reach with its detail budget (Step 7.5's invariant).
   *
   * `EFS_CARD_SYNC_MAX_DETAIL` must exceed the fleet, or the depth pass can never cover it in one
   * sweep and every card's document ages past the sync cycle it is judged against. Non-zero is a
   * misconfiguration, not a busy night.
   */
  undetailedByBudget: number;
  failed: number;
  errors: string[];
}

/**
 * What one pass failed with, for one card. Step 7.5, and migration 0198 enforces the shape.
 *
 * `source` is what makes this different from the bare string it replaced: the pass that RECORDS a
 * failure and the pass that CLEARS it used to be different passes, so a detail-read failure was
 * erased by the next roster sweep whether or not anything had re-read the card.
 */
export interface SyncErrorRecord {
  code: string;
  source: "roster" | "detail";
  at: string;
}

/**
 * Write one pass's failure onto the card's own row.
 *
 * Best effort by design, in both directions. The update matches on `(org_id, card_ref_hmac)` and a
 * FIRST sighting that failed has no row yet, so nothing is written and the failure stays in the
 * sweep's `errors[]` where it already was. And a failure to record a failure is not itself worth
 * failing a sweep over — the card is no worse off than before.
 *
 * Deliberately does NOT touch `synced_at`. That column means "the mirror last wrote vendor truth for
 * this card", and a read that failed wrote none; the record's own `at` is what carries the timing.
 */
async function recordSyncError(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  cardNumber: string,
  source: SyncErrorRecord["source"],
  error: unknown,
): Promise<void> {
  const record: SyncErrorRecord = { code: errorText(error), source, at: new Date().toISOString() };
  await admin
    .from("efs_cards")
    .update({ sync_error: record })
    .eq("org_id", orgId)
    .eq("card_ref_hmac", cardRefHmac(env, orgId, cardNumber));
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
    orgId: creds.orgId, cardsSeen: 0, upserted: 0, detailed: 0, linked: 0,
    tombstoned: 0, tombstoneRefused: 0, undetailedByBudget: 0, failed: 0, errors: [],
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
      // On the ROW too, not only in this array (Step 7.5). A roster-pass failure for one card used
      // to live exclusively in the job's stats blob — which is not what an operator looking at that
      // card sees, and not something they can find from the card page at all.
      await recordSyncError(admin, env, creds.orgId, summary.cardNumber, "roster", error);
    }
  }

  // STALEST-FIRST, not vendor order (audit P0-7). `summaries.slice(0, budget)` refreshed the same
  // prefix every sweep, so a card past the budget never acquired a document at all — the header's
  // "depth catches up across runs" was a promise the code didn't keep. Ordering by the detail
  // pass's own clock keeps it: never-detailed cards first, then oldest documents, and every card's
  // position improves as others are refreshed ahead of it.
  const budget = opts.maxDetail ?? 200;
  /**
   * Step 7.5's invariant: `budget > fleetSize`.
   *
   * The header above promises "the depth catches up across runs", and stalest-first ordering keeps
   * that promise — but only in the sense that every card eventually gets a turn. If the budget is
   * below the fleet then NO sweep ever holds a current document for the whole fleet, and every
   * surface that judges a row against one sync cycle (`staleAfterMinutes`, the override badge in
   * Step 7.8) is judging it against a cadence the sweep cannot meet. Production shipped 199 cards
   * against a budget of 200 — one card from this being true, with nothing that would have said so.
   *
   * A signal rather than a throw: refusing to sweep would turn a configuration problem into a total
   * outage of the mirror, and the partial sweep is still worth having. It is loud, it names both
   * numbers, and `undetailedByBudget` puts it in the job's stats where the next sweep's operator
   * will see it.
   */
  if (budget < summaries.length) {
    result.undetailedByBudget = summaries.length - budget;
    signalDetailBudgetShort({ orgId: creds.orgId, budget, cardsSeen: summaries.length });
  }
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
      await recordSyncError(admin, env, creds.orgId, summary.cardNumber, "detail", error);
    }
  }

  result.linked = await linkFuelCards(admin, env, creds.orgId);
  const tombstones = await tombstoneAbsentCards(admin, env, creds.orgId, summaries);
  result.tombstoned = tombstones.tombstoned;
  result.tombstoneRefused = tombstones.refused ? tombstones.candidates : 0;

  /**
   * Step 5.1's sweep signal.
   *
   * `cardsWithoutDetail` is counted against the mirror AFTER the sweep rather than derived from
   * `cardsSeen - detailed`: the detail pass is budgeted (`EFS_CARD_SYNC_MAX_DETAIL`) and works oldest
   * first, so most sweeps legitimately detail only a slice of the fleet. The arithmetic would report
   * a large number every single run and mean nothing. The question worth alerting on is how many
   * cards have NEVER been detailed — those are the rows the product cannot answer questions about,
   * because a badge renders the mirror and a mirror row only says what EFS said at
   * `detail_synced_at`.
   *
   * A clean sweep still emits, at `info`. This is the heartbeat: the scheduler runs every 24h and a
   * scheduler that has stopped produces silence, not an error, so the absence of this signal is
   * itself the thing to alert on.
   */
  const { count: withoutDetail } = await admin
    .from("efs_cards")
    .select("id", { count: "exact", head: true })
    .eq("org_id", creds.orgId)
    .is("detail_synced_at", null);

  signalMirrorSweepCompleted({
    orgId: creds.orgId,
    cardsSeen: result.cardsSeen,
    detailed: result.detailed,
    linked: result.linked,
    tombstoned: result.tombstoned,
    failed: result.failed,
    cardsWithoutDetail: withoutDetail ?? 0,
  });
  return result;
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
    /**
     * ⚠ NO `sync_error: null` HERE. Step 7.5, and this one line is the behavioural half of it.
     *
     * The roster pass is not the pass that records a detail failure, and it must not be the pass
     * that erases one. It used to clear the column for every card on every sweep, BEFORE the budgeted
     * detail pass ran — so a `getCardv2` failure recorded on Monday was gone by Tuesday whether or
     * not anything had managed to re-read that card, and the page said "clean" over a document days
     * old. Only a pass holding the whole document may clear it, which is `upsertCardDetail`.
     *
     * `efsCardMirror.test.ts` → "the roster pass does not clear an error the detail pass recorded"
     * goes red if this is put back.
     */
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

  /**
   * Step 7.3: the sweep LOGS an unmodelled field; the config scan REFUSES on one.
   *
   * Deliberately asymmetric. This runs unattended against a live fleet, and refusing to mirror a card
   * because WEX added a field would take the product offline over something harmless — the echo
   * preserves unknown fields either way (`getCardV2.unknownField.xml`). The scan is the operator-run
   * surface whose answer scopes Phases 9–12, so that one is entitled to stop. Names only, never
   * values: a value could be anything the vendor put in the field, and this line reaches logs.
   */
  const unmodelled = unmodelledCardFields(doc.root);
  if (unmodelled.length > 0) {
    console.warn(
      `[efs-cards] org ${orgId} card ••••${last4}: unmodelled field(s) ${unmodelled.join(", ")} — `
        + "mirrored anyway; run the config scan and model them (Step 7.3)",
    );
  }

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
      // The ONLY clear (Step 7.5). This pass is holding the whole document, so it is the only one
      // entitled to say the card reads cleanly — including over an error the ROSTER pass recorded,
      // which a successful full read has just disproved.
      sync_error: null,
    },
    { onConflict: "org_id,card_ref_hmac", ignoreDuplicates: false },
  );
  if (error) throw new Error(error.message);
  return { cardVersion: doc.version };
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
  const { open } = await import("../../../lib/secretBox.js");
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
export { cardRefHmac } from "./efsCardRef.js";
