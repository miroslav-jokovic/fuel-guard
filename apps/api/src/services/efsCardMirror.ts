import { createHmac, hkdfSync } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cardLast4, cardRefsMatch, isFullCardNumber, parseEfsDateTime } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { getCardSummaries, getCardV2, type CardSummaryRow } from "../lib/efsCardOps.js";
import { EfsSoapError } from "../lib/efsSoapSession.js";
import { isSecretBoxConfigured, seal, secretAad } from "../lib/secretBox.js";
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
  const raw = env.SECRETS_ENCRYPTION_KEY;
  if (!raw) {
    throw new EfsSoapError("SECRETS_ENCRYPTION_KEY is not set — refusing to index card numbers", "not_implemented");
  }
  const master = Buffer.from(raw, raw.includes("-") || raw.includes("_") || /[+/=]/.test(raw) ? "base64" : "hex");
  const subkey = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "efs-card-ref", 32));
  return createHmac("sha256", subkey).update(`${orgId}:${cardNumber}`).digest("hex");
}

const infoValue = (document: { infos?: { infoId: string; matchValue: string | null }[] }, id: string): string | null =>
  document.infos?.find((i) => i.infoId === id)?.matchValue ?? null;

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
    orgId: creds.orgId, cardsSeen: 0, upserted: 0, detailed: 0, linked: 0, failed: 0, errors: [],
  };

  if (!isSecretBoxConfigured(env)) {
    // Matches saveSamsaraToken's posture: refuse to persist rather than fall back to plaintext.
    result.errors.push("SECRETS_ENCRYPTION_KEY is not configured — refusing to store card numbers");
    result.failed = 1;
    return result;
  }

  const summaries = await getCardSummaries(env, creds, { fetchImpl: opts.fetchImpl, priority: "backfill" });
  result.cardsSeen = summaries.length;

  for (const summary of summaries) {
    try {
      await upsertFromSummary(admin, env, creds.orgId, summary);
      result.upserted += 1;
    } catch (error) {
      result.failed += 1;
      // The message may quote the card number back at us; last four only, ever.
      result.errors.push(`card ••••${cardLast4(summary.cardNumber) ?? "????"}: ${errorText(error)}`);
    }
  }

  const budget = opts.maxDetail ?? 200;
  for (const summary of summaries.slice(0, budget)) {
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
  return result;
}

/** The roster pass: everything getCardSummaries knows, with no per-card round trip. */
async function upsertFromSummary(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  summary: CardSummaryRow,
): Promise<void> {
  const last4 = cardLast4(summary.cardNumber);
  if (!last4) throw new Error("card number had no usable last four");

  const { error } = await admin.from("efs_cards").upsert(
    {
      org_id: orgId,
      card_ref_hmac: cardRefHmac(env, orgId, summary.cardNumber),
      card_number_sealed: seal(env, summary.cardNumber, secretAad(orgId, "efs_card_pan")),
      card_last4: last4,
      // A status EFS reports but the getCard enum omits (notably 'Fraud', the `U` search code) is
      // stored verbatim; the check constraint accepts it. Coercing it to something familiar would
      // hide the single most important thing about that card.
      status: summary.status ?? "Inactive",
      policy_number: summary.policyNumber,
      company_xref: summary.companyXref,
      payroll_status: summary.payrollStatus,
      info_source: normalizeSource(summary.infoSource),
      driver_id_prompt: summary.driverId,
      unit_prompt: summary.unitNumber,
      driver_name: summary.driverName,
      override_uses: summary.override ? null : 0,
      // The roster call carries no card document. A first sighting gets an empty one, which the
      // detail pass replaces; `document` is not-null so the row is never half-formed.
      document: {},
      card_version: "",
      synced_at: new Date().toISOString(),
      sync_error: null,
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
  const last4 = cardLast4(cardNumber);
  if (!last4) throw new Error("card number had no usable last four");

  const { error } = await admin.from("efs_cards").upsert(
    {
      org_id: creds.orgId,
      card_ref_hmac: cardRefHmac(env, creds.orgId, cardNumber),
      card_number_sealed: seal(env, cardNumber, secretAad(creds.orgId, "efs_card_pan")),
      card_last4: last4,
      status: doc.card.status ?? "Inactive",
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
      driver_id_prompt: infoValue(doc.card, "DRID"),
      unit_prompt: infoValue(doc.card, "UNIT"),
      driver_name: infoValue(doc.card, "NAME"),
      // EFS servers are Central Time and the offset is optional (p10-11). A bare timestamp read as
      // UTC lands five or six hours out and quietly makes every fill time on the page wrong.
      last_used_date: parseEfsDateTime(doc.card.lastUsedDate),
      last_transaction: doc.card.lastTransaction,
      document: doc.card,
      card_version: doc.version,
      last_response_xml_redacted: doc.redactedXml.slice(0, 60_000),
      synced_at: new Date().toISOString(),
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
  const upper = value.toUpperCase();
  return upper === "POLICY" || upper === "CARD" || upper === "BOTH" ? upper : null;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Belt and braces: a vendor message can quote the card number back at us.
  return message.replace(/\b\d{12,25}\b/g, (d) => `••••${d.slice(-4)}`).slice(0, 300);
}

export { isFullCardNumber };
