import { EfsSoapError } from "./efsSoapSession.js";
import { XSI_NS } from "./efsCardXml.js";
import type { CardEdit } from "./efsCardEcho.js";

/**
 * Phase 0 diagnostics for the `no_change` incident: build a `setCardv2` request in one of the
 * VARIANT shapes under test, so each hypothesis about why EFS accepted a write and applied nothing
 * can be tried as one call against the QA disposable card.
 *
 * PURE — no network, no clock, no database. The route (`routes/fuelCards/experiments.ts`) owns the
 * gates and the vendor calls; this file owns the request algebra, which is the part that must be
 * provably correct before anything is sent. See `docs/plans/EFS-CARD-CONTROL-FIX-PLAN.md` Phase 0
 * for the experiment matrix (E1–E5) and the hypothesis each variant settles.
 *
 * ── Why variants transform the SERIALIZED string instead of forking the serializer ──────────────
 * `serializeSetCardRequest` is the one place a request body is built, and `assertEchoFidelity` is
 * the guard on it. A second serializer for experiments would be a second place to get the echo
 * wrong — the exact class of bug Phase 0 exists to diagnose. So every variant starts from the
 * canonical output and rewrites ONLY the operation wrapper, whose exact text this codebase authored
 * (`efsCardEcho.ts` emits it verbatim), making the rewrite deterministic. The fidelity guard then
 * runs on the TRANSFORMED string — the bytes that actually go on the wire.
 */

/** The wrapper `serializeSetCardRequest` emits today, verbatim. A transform that does not find this
 *  prefix is operating on a string this module does not understand, and must refuse. */
const STANDARD_OPEN = `<CardManagementEP_setCardv2 xmlns:xsi="${XSI_NS}">`;
const STANDARD_CLOSE = `</CardManagementEP_setCardv2>`;

/** The service namespace, read off the live WSDL (`targetNamespace="http://com.tch.cards.service"`,
 *  binding `style="rpc" use="literal"`). Hypothesis H5: strict rpc/literal wants the OPERATION
 *  element, namespace-qualified — not the unqualified message name we send today. */
export const EFS_SERVICE_NS = "http://com.tch.cards.service";

export const EXPERIMENT_VARIANTS = ["standard", "qualified_wrapper", "setcard_v1"] as const;
export type ExperimentVariant = (typeof EXPERIMENT_VARIANTS)[number];

/**
 * Statuses an experiment may write, in the exact casing the operator asked for. Casing is the point
 * of hypothesis H1, so the raw string travels verbatim — but the STATE is allowlisted: `Deleted` is
 * EFS's hard delete (guide p128) and `Fraud` is never written by this product, experiments included.
 */
const WRITABLE_EXPERIMENT_STATUSES = /^(active|inactive|hold)$/i;

export function isExperimentStatus(value: string): boolean {
  return WRITABLE_EXPERIMENT_STATUSES.test(value.trim());
}

export interface ExperimentWrite {
  /** Sent verbatim — `Hold` vs `HOLD` is hypothesis H1, so no normalisation happens here. */
  statusValue: string;
  /** Hypothesis H3: a Hold may need the restore-to status supplied alongside it (guide p35). */
  originalStatusValue?: string | undefined;
}

/** The edit list for one experiment. Same `CardEdit` algebra as production, so the fidelity guard
 *  and the drift diff need no special cases. */
export function experimentEdits(spec: ExperimentWrite): CardEdit[] {
  if (!isExperimentStatus(spec.statusValue)) {
    throw new EfsSoapError(
      `Experiments may only write Active/Inactive/Hold (any casing) — refusing "${spec.statusValue}"`,
      "not_implemented",
    );
  }
  const edits: CardEdit[] = [{ op: "setField", name: "status", value: spec.statusValue.trim() }];
  if (spec.originalStatusValue !== undefined) {
    if (!isExperimentStatus(spec.originalStatusValue)) {
      throw new EfsSoapError(
        `originalStatus must be Active/Inactive/Hold — refusing "${spec.originalStatusValue}"`,
        "not_implemented",
      );
    }
    edits.push({ op: "setField", name: "originalStatus", value: spec.originalStatusValue.trim() });
  }
  return edits;
}

/** The operation a variant dispatches, needed before any body exists (SOAPAction is per-call). */
export const variantOperation = (variant: ExperimentVariant): "setCardv2" | "setCard" =>
  variant === "setcard_v1" ? "setCard" : "setCardv2";

export interface TransformedRequest {
  /** The body to dispatch — canonical serializer output with only the wrapper rewritten. */
  body: string;
  /** The operation for SOAPAction/dispatch. `setCard` for the v1 variant, else `setCardv2`. */
  operation: "setCardv2" | "setCard";
}

/**
 * Rewrite the operation wrapper for the variant under test.
 *
 *   standard          — untouched. The shape production sends today (E2/E4 use this).
 *   qualified_wrapper — `<setCardv2 xmlns="http://com.tch.cards.service">` (E3, hypothesis H5):
 *                       the canonical rpc/literal operation element. Part accessors stay
 *                       unqualified, which is correct for rpc/literal.
 *   setcard_v1        — the v1 message name and the `setCard` operation (E5, provisioning check).
 *                       The WSDL's WSCard differs from WSCardv2 only in the limits type
 *                       (no autoRoll fields); the QA card carries no limits, so the same echo is
 *                       lossless for it. The route re-checks that precondition at run time.
 */
export function transformForVariant(xml: string, variant: ExperimentVariant): TransformedRequest {
  if (!xml.startsWith(STANDARD_OPEN) || !xml.endsWith(STANDARD_CLOSE)) {
    // Refuse to guess: if the serializer's wrapper ever changes, this module must be updated with
    // it, not silently produce a third shape nobody reviewed.
    throw new EfsSoapError(
      "Experiment transform expected the canonical setCardv2 wrapper and did not find it — refusing to rewrite",
      "echo_unfaithful",
    );
  }
  const inner = xml.slice(STANDARD_OPEN.length, xml.length - STANDARD_CLOSE.length);
  switch (variant) {
    case "standard":
      return { body: xml, operation: "setCardv2" };
    case "qualified_wrapper":
      return {
        body: `<setCardv2 xmlns="${EFS_SERVICE_NS}" xmlns:xsi="${XSI_NS}">${inner}</setCardv2>`,
        operation: "setCardv2",
      };
    case "setcard_v1":
      return {
        body: `<CardManagementEP_setCard xmlns:xsi="${XSI_NS}">${inner}</CardManagementEP_setCard>`,
        operation: "setCard",
      };
  }
}
