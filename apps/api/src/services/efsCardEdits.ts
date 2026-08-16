import {
  EFS_EDITABLE_INFO_IDS,
  matchStatusCasing,
  type EfsWritableStatus,
  type OverrideScope,
  type PromptInput,
} from "@fuelguard/shared";
import type { CardEdit } from "../lib/efsCardEcho.js";
import type { CardDocument } from "../lib/efsCardXml.js";
import { childElements, collectElements, localName, type XmlElement } from "../lib/efsXml.js";
import { EfsSoapError } from "../lib/efsSoapSession.js";

/**
 * The vendor's own override and prompt recipes, expressed as `CardEdit[]` and nothing else.
 *
 * PURE — no database, no network, no clock. Every function here takes the card document EFS just sent
 * us and returns the edit list that should be applied to it. That makes the part of card control most
 * likely to be wrong in a way nobody notices — "which fields does an override actually set?" — testable
 * against fixtures without a Supabase stub in sight.
 *
 * ── Where these recipes come from ────────────────────────────────────────────────────────────────
 * `docs/22-EFS-CARD-CONTROL.md` §Overrides, transcribed from the guide's appendix (p194) and checked
 * line by line against the PDF. They are quoted in the comments at each call site rather than
 * paraphrased, because "the recipe is exact and must be followed literally" is the whole reason this
 * file is separate from the orchestration around it.
 *
 * ── The rule that governs every function below ───────────────────────────────────────────────────
 * An edit names what CHANGES. Everything unnamed is echoed byte-identical from the response DOM by
 * `serializeSetCardRequest`, and `assertEchoFidelity` refuses to send a request whose content does not
 * match "the response, plus exactly these edits". So the correctness question for this file is never
 * "did we remember to include field X" — it is only "is this the smallest true description of the
 * change".
 */

/** `override` carries a use count, not a boolean (p194) — 0 means the card has no exception left. */
const OVERRIDE_NONE = "0";
/**
 * `locationOverride` is typed boolean(1) but carries a 6-digit location id when a single-location
 * override is active. "0" is the value that means "no single-location override" — the literal false
 * of the declared type, and the shape `parseCardDocument` already reads as "not an id".
 */
const LOCATION_OVERRIDE_NONE = "0";

// ─── Status ────────────────────────────────────────────────────────────────────────────────────

/**
 * Lock: `status` → `Hold` (default) or `Inactive`.
 *
 * `Hold` is reversible and is what the UI defaults to. `Inactive` is offered for a card being retired.
 * `Deleted` is NEVER written — it is EFS's hard delete (p128) and there is no undo.
 *
 * `observedStatus` is the status field of the document EFS returned INSIDE this same operation
 * (`doc.card.status`) — never the mirror, which can be a sweep old. The write is spelled in that
 * document's own casing (`matchStatusCasing`), because Phase 0 proved this vendor silently ignores
 * a status whose casing does not match the account's stored vocabulary (H1, 2026-08-12: `HOLD`
 * landed in 533ms, `Active` was accepted-and-ignored). See docs/22 §Root cause.
 */
export const lockEdits = (status: EfsWritableStatus, observedStatus: string | null): CardEdit[] => [
  { op: "setField", name: "status", value: matchStatusCasing(observedStatus, status) },
];

/**
 * Deactivate: `status` → `Inactive`. Retiring a card, as opposed to pausing one.
 *
 * Takes no target status, because `card_deactivate` has none to give it — see that contract. This is
 * not `lockEdits(status, observed)` with a narrower argument; it is the same shape as `unlockEdits`,
 * for the same reason: the status IS the capability. Same casing rule as both (H1, 2026-08-12).
 *
 * `Deleted` remains NEVER written — that is EFS's hard delete (p128) and there is no undo. `Inactive`
 * is reversible through `card_unlock`, which is what makes it a retirement and not a deletion.
 */
export const deactivateEdits = (observedStatus: string | null): CardEdit[] => [
  { op: "setField", name: "status", value: matchStatusCasing(observedStatus, "Inactive") },
];

/**
 * Unlock: `status` → `Active`. The only status this product ever restores a card to.
 * Same casing rule as `lockEdits`, same reason.
 */
export const unlockEdits = (observedStatus: string | null): CardEdit[] => [
  { op: "setField", name: "status", value: matchStatusCasing(observedStatus, "Active") },
];

// ─── Overrides (p194) ──────────────────────────────────────────────────────────────────────────

/**
 * Grant a one-time exception.
 *
 * The guide's two recipes, verbatim:
 *   • All locations:    `overrideAllLocations=true`,  `override` = 1..9
 *   • Single location:  `locationOverride` = the 6-digit EFS location id,
 *                       `overrideAllLocations=false`, `override` = 1..9
 *
 * ── The one place this goes beyond the recipe, and why ───────────────────────────────────────────
 * The recipes are written as if applied to a card with no override configured. On a card that already
 * carries one, following them literally can produce a document that asserts BOTH forms at once — an
 * all-locations grant on a card whose `locationOverride` still holds last week's truck stop. The two
 * are mutually exclusive by construction (the single-location recipe explicitly sets
 * `overrideAllLocations=false`), and the failure mode is silent and expensive in the wrong direction:
 * the operator is told "at every location" and the driver is declined everywhere but Effingham.
 *
 * So the stale field is cleared, and ONLY when it actually holds an id — a card that already reads
 * `locationOverride` 0/1 is left untouched, because writing a value EFS already has is a change we
 * would then have to explain in the ledger. This is the single inference in this file; it is called
 * out here, in the ledger's `edits` column, and in docs/22 so the pilot can confirm it against real
 * vendor behaviour.
 */
export function overrideGrantEdits(doc: CardDocument, uses: number, scope: OverrideScope): CardEdit[] {
  const edits: CardEdit[] = [{ op: "setField", name: "override", value: String(uses) }];
  if (scope.kind === "all") {
    edits.push({ op: "setField", name: "overrideAllLocations", value: "true" });
    if (doc.card.locationOverrideId !== null) {
      edits.push({ op: "setField", name: "locationOverride", value: LOCATION_OVERRIDE_NONE });
    }
  } else {
    edits.push({ op: "setField", name: "locationOverride", value: scope.locationId });
    edits.push({ op: "setField", name: "overrideAllLocations", value: "false" });
  }
  return edits;
}

/**
 * Clear an exception: no remaining uses, neither scope armed.
 *
 * All three fields are written unconditionally here, unlike the grant path. Clearing is the SAFE
 * direction — the worst outcome of writing a value EFS already holds is a no-op edit in the ledger,
 * whereas leaving one of the three armed is an exception somebody thinks they revoked.
 */
export const overrideClearEdits = (): CardEdit[] => [
  { op: "setField", name: "override", value: OVERRIDE_NONE },
  { op: "setField", name: "overrideAllLocations", value: "false" },
  { op: "setField", name: "locationOverride", value: LOCATION_OVERRIDE_NONE },
];

/** The header trio an override lives in — what `deleteOverride` is expected to move (fix plan D1). */
export const OVERRIDE_FIELDS = ["override", "overrideAllLocations", "locationOverride"] as const;

/**
 * Did an override clear LAND, judged from the after-document alone (D1's vendor-op predicate).
 *
 * `deleteOverride`'s post-state is not documented — the guide says what the op does (p27), not what
 * it writes into the three fields (0? nil? removed?). Until the probe records the real shape, the
 * honest predicate is the one that matters for fuel: NO USES REMAIN. `parseCardDocument` reads 0,
 * nil and absent all as null-or-0 here, so every plausible clear-shape passes — while a card still
 * carrying uses fails, which is the outcome that must never be reported as done. Scope residue
 * without uses grants nothing (p194: the count is the exception) and is visible as vendor-maintained
 * drift in the ledger, not silently blessed.
 */
export const overrideClearedLanded = (after: CardDocument): boolean =>
  (after.card.overrideUses ?? 0) === 0;

// ─── Prompts (infos) ───────────────────────────────────────────────────────────────────────────

/**
 * A card record as a flat field map, in DOCUMENT ORDER, preserving every field including ones this
 * codebase has never heard of.
 *
 * This is what makes a prompts change safe. `replaceAll` re-serializes the whole `infos` array from
 * records, so anything not in the record is gone — and an `<infos>` element carries `reportValue`,
 * `lengthCheck`, `minimum`, `maximum`, `value` and potentially fields WEX adds next year. Rebuilding
 * records from the typed view instead of from the DOM would drop them, which for a prompt means the
 * pump stops applying a rule nobody meant to remove.
 *
 * ── Nested containers are REFUSED, not flattened ─────────────────────────────────────────────────
 * A flat map cannot hold `<a><b>x</b></a>`; collapsing it to `textContent` would keep the value and
 * lose the path, and the request would then carry `<a>x</a>` — a different document that no guard can
 * see, because the flattened record is the input to both the request and its expectation.
 *
 * No EFS collection nests today, so this throws rather than growing a nested record type for a shape
 * the vendor does not produce. If one ever does, this is where it fails loudly on the first write
 * instead of quietly reshaping a card. Named test: "refuses a record containing a nested container".
 */
export function recordFromElement(element: XmlElement): Record<string, string | null> {
  const record: Record<string, string | null> = {};
  for (const child of childElements(element)) {
    if (childElements(child).length > 0) {
      throw new EfsSoapError(
        `Refusing to rebuild a <${localName(element)}> record: <${localName(child)}> contains a nested `
          + `container, which a flat record cannot represent without losing its structure.`,
        "echo_unfaithful",
      );
    }
    const nil = child.getAttribute("xsi:nil") ?? child.getAttribute("nil");
    record[localName(child)] = nil === "true" || nil === "1" ? null : (child.textContent ?? "").trim();
  }
  return record;
}

const EDITABLE = new Set<string>(EFS_EDITABLE_INFO_IDS);

export interface PromptPlan {
  edits: CardEdit[];
  /** Editable prompts explicitly marked for removal — the removals the caller must authorise. */
  removedInfoIds: string[];
  /** For the audit trail: what the editable prompts were, and what they became. */
  before: { infoId: string; validationType: string | null; matchValue: string | null; reportValue: string | null }[];
  after: { infoId: string; validationType: string | null; matchValue: string | null; reportValue: string | null }[];
}

/**
 * Build a full-replace of the `infos` array from the editable prompts the operator submitted.
 *
 * ── What "full replace" means here, and what it deliberately does not ────────────────────────────
 * EFS has no partial prompt update: the array in the request IS the card's prompts afterwards. So the
 * request has to carry every record, not just the edited ones. Editable omissions are preserved unless
 * the caller marks `remove: true`; records whose `infoId` is not editable in Phase 1 — `ODRD`, `TRIP`,
 * `TRLR`, `NAME`, `PPIN`, `CNTN` — are passed through EXACTLY as EFS sent them.
 *
 * For an editable record that already exists, only `validationType`, `matchValue` and `reportValue` are
 * touched; the rest of the record keeps its original values AND its original position in the array,
 * because rebuilding it would silently normalise fields we were never asked to change.
 *
 * ── Blank versus nil ─────────────────────────────────────────────────────────────────────────────
 * A cleared `matchValue` is written as an EMPTY element rather than `xsi:nil`. The guide's instruction
 * is "only remove fields or blank them out if you intend to remove them" (p137) — blanking is an empty
 * element, and this codebase has already learned that EFS's Axis2 binding treats an omitted element
 * and an empty one very differently. Removing the RECORD is a separate, explicit act (below), not
 * something that happens because a text box was emptied.
 */
export function promptsEdits(doc: CardDocument, prompts: readonly PromptInput[]): PromptPlan {
  const existing = collectElements(doc.root, "infos");
  const wanted = new Map(prompts.map((p) => [p.infoId as string, p]));
  const records: Record<string, string | null>[] = [];
  const removedInfoIds: string[] = [];
  const seen = new Set<string>();

  for (const element of existing) {
    const record = recordFromElement(element);
    const infoId = record.infoId ?? "";
    if (!EDITABLE.has(infoId)) {
      records.push(record); // untouched, in place
      continue;
    }
    seen.add(infoId);
    const update = wanted.get(infoId);
    if (!update) {
      // The full-replace request still carries this record when the operator did not explicitly remove
      // it. Removal must be authored with `remove: true`, never inferred from omission or an empty value.
      records.push(record);
      continue;
    }
    if (update.remove) {
      removedInfoIds.push(infoId);
      continue;
    }
    records.push({
      ...record,
      validationType: update.validationType,
      matchValue: update.validationType === "EXACT_MATCH" ? update.matchValue ?? "" : "",
      reportValue: update.validationType === "REPORT_ONLY" ? update.reportValue ?? "" : "",
    });
  }

  // A prompt the card does not have yet — assigning a driver to a card that has never had one.
  // Appended in submission order, after everything that already existed.
  //
  // FULL VENDOR SHAPE, in WSCardInfo's sequence order (WSDL; guide p138-139) — not just the three
  // fields we care about. The schema marks none of the record's nine elements optional, EFS's own
  // serializer emits them all, and this vendor's demonstrated failure mode for a shape it has never
  // seen is "accepted and ignored" (audit W3). `value` is "0" per the guide's own instruction for
  // every non-accrual combination (p39). numericMatchValue is deliberately absent: EFS's own
  // responses omit it, so the omission is a shape the vendor demonstrably produces.
  for (const prompt of prompts) {
    if (seen.has(prompt.infoId) || prompt.remove) continue;
    records.push({
      infoId: prompt.infoId,
      lengthCheck: "false",
      matchValue: prompt.validationType === "EXACT_MATCH" ? prompt.matchValue ?? "" : "",
      maximum: "0",
      minimum: "0",
      reportValue: prompt.validationType === "REPORT_ONLY" ? prompt.reportValue ?? "" : "",
      validationType: prompt.validationType,
      value: "0",
    });
  }

  const view = (list: Record<string, string | null>[]) =>
    list
      .filter((r) => EDITABLE.has(r.infoId ?? ""))
      .map((r) => ({
        infoId: r.infoId ?? "",
        validationType: r.validationType ?? null,
        matchValue: r.matchValue ?? null,
        reportValue: r.reportValue ?? null,
      }));

  return {
    // `removals` is what lets the echo guard tell an intended removal from a lost record. Anything
    // omitted from `records` without being named here is refused before the request is sent.
    edits: [{ op: "replaceAll", name: "infos", records, removals: removedInfoIds }],
    removedInfoIds,
    before: doc.card.infos
      .filter((i) => EDITABLE.has(i.infoId))
      .map((i) => ({
        infoId: i.infoId,
        validationType: i.validationType,
        matchValue: i.matchValue,
        reportValue: i.reportValue,
      })),
    after: view(records),
  };
}
