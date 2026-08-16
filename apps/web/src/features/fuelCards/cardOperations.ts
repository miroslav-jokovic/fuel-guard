import type { CardCapabilities, EfsLocation, PromptInput, WsCard } from "@fuelguard/shared";
import { CARD_CAPABILITY_CONTRACTS, EFS_EDITABLE_INFO_IDS, efsStatusEquals } from "@fuelguard/shared";
import { CARD_CAPABILITY_VIEWS } from "./capabilities/registry.js";
import type { CapabilityCardContext, CapabilityConfirmation, CapabilityDiffRow } from "./capabilities/types.js";

/**
 * Every way this product can change a fuel card, as DATA — one row per thing an operator does.
 *
 * ── Why operations and capabilities are not the same list ───────────────────────────────────────
 * `card_lock` is one capability and TWO operations: Hold is reversible and is what somebody reaches
 * for at 2am, Inactive is how a card is retired. Offering them as one button with a dropdown is how
 * a card gets retired when somebody meant to pause it, so they are separate rows here with separate
 * confirmations — the view already writes different copy for each (`cardLock.view.ts`).
 *
 * ── Why this is a table and not six components ──────────────────────────────────────────────────
 * Phase 6's whole point (docs/28 Problem 3) is one button and one drawer per operation. Six drawer
 * components would be six places to forget the snapshot-on-confirm rule, the dirty guard, or the
 * `sent` retry lock. `CardOperationDrawer.vue` implements those once and reads this for the parts
 * that genuinely differ: what it is called, when it is worth offering, and what body it sends.
 *
 * The CONFIRMATION and the DIFF are not here — they come from `CARD_CAPABILITY_VIEWS`, which is the
 * registry Phase 3 built and nothing consumed until now.
 */

export type CardOperationId = "lock" | "deactivate" | "unlock" | "grant" | "clear" | "prompts";

/** The three questions an operator is actually asking, and the grouping the detail page renders. */
export type CardOperationGroup = "Card status" | "Fuel access" | "At the pump";

/** The scope names `capabilities.scopes` uses — the approver-list vocabulary, not the capability key. */
export type CardOperationScope = "lock" | "unlock" | "override" | "prompts";

/** What the drawer knows about the card it is changing. A masked reference, never a PAN. */
export type OperationCard = CapabilityCardContext["card"];

/** Everything the six operations can collect between them. One object, so the drawer has one dirty check. */
export interface OperationDraft {
  lockStatus: "Hold" | "Inactive";
  uses: number;
  scopeKind: "all" | "location";
  location: EfsLocation | null;
  prompts: PromptInput[];
  reason: string;
}

export interface CardOperationSpec {
  id: CardOperationId;
  /** The contract this operation writes through — the key `capabilityStates` is keyed by. */
  capabilityKey: string;
  scope: CardOperationScope;
  group: CardOperationGroup;
  /** Trailing ellipsis on every one: they open a drawer rather than doing something immediately. */
  menuLabel: string;
  /**
   * Is this operation worth offering for this card, right now?
   *
   * About the CARD's state, never about the operator's permission — that is `capabilityStates`, and
   * conflating them is how "you cannot do this" gets shown to somebody whose real problem is that
   * the card is already locked.
   */
  applies: (card: OperationCard) => boolean;
  /** The operation-specific half of the request body. The drawer adds version, reason and the key. */
  body: (draft: OperationDraft) => Record<string, unknown>;
  /**
   * What is still missing before Confirm can be pressed, in words — invariant 6.
   *
   * Returns the SENTENCE, never a boolean: a disabled button whose tooltip says "invalid" tells an
   * operator to go and hunt. Null means ready.
   */
  blocker?: (draft: OperationDraft) => string | null;
}

const usesLeft = (card: OperationCard): number => card.overrideUses ?? 0;

export const CARD_OPERATIONS: readonly CardOperationSpec[] = [
  {
    id: "lock",
    capabilityKey: "card_lock",
    scope: "lock",
    group: "Card status",
    menuLabel: "Lock card…",
    // Only a working card can be paused. Offering Lock on a held card invites a write that changes
    // nothing and still spends a vendor call and an hourly-cap slot.
    applies: (card) => efsStatusEquals(card.status, "Active"),
    body: () => ({ status: "Hold" }),
  },
  {
    id: "deactivate",
    capabilityKey: "card_lock",
    scope: "lock",
    group: "Card status",
    menuLabel: "Deactivate card…",
    /**
     * On Active AND Hold — the Step 6.2 correction.
     *
     * Retiring a card is a decision about the card's future, not about whether somebody paused it
     * first. The old drawer offered Inactive only as a second choice inside the Lock control, so a
     * card already on Hold could not be retired here at all and an operator had to unlock it first
     * — two writes, and a window where a card nobody wants working is working.
     */
    applies: (card) => efsStatusEquals(card.status, "Active") || efsStatusEquals(card.status, "Hold"),
    body: () => ({ status: "Inactive" }),
  },
  {
    id: "unlock",
    capabilityKey: "card_unlock",
    scope: "unlock",
    group: "Card status",
    menuLabel: "Unlock card…",
    // `efsStatusEquals`, never `!==`: this account returns ACTIVE upper-cased, and an exact
    // comparison read every working card as locked and offered Unlock on all of them.
    applies: (card) => !efsStatusEquals(card.status, "Active"),
    body: () => ({}),
  },
  {
    id: "grant",
    capabilityKey: "override_grant",
    scope: "override",
    group: "Fuel access",
    menuLabel: "Grant exception…",
    // Always offerable: granting a new exception replaces whatever is there, which is the vendor's
    // own semantic (guide p194) and is what an operator means by "let him fuel once more".
    applies: () => true,
    body: (draft) => ({
      uses: draft.uses,
      scope: draft.scopeKind === "all"
        ? { kind: "all" }
        : { kind: "location", locationId: draft.location?.locId ?? "" },
    }),
    blocker: (draft) =>
      (draft.scopeKind === "location" && draft.location === null
        ? "Choose the location this exception applies at."
        : null),
  },
  {
    id: "clear",
    capabilityKey: "override_clear",
    scope: "override",
    group: "Fuel access",
    menuLabel: "Remove exception…",
    /**
     * Uses > 0 **or** a scope field armed — the Step 6.2 correction.
     *
     * The old panel showed Remove only when `overrideUses > 0`, which is the right test for "is an
     * exception ACTIVE" (`activeOverrides` uses it, and should). It is the wrong test for "is there
     * residue worth clearing": a card carrying `locationOverride` with zero uses left is
     * configuration this product can tidy and previously could not reach. Clearing is safe on a card
     * with nothing to clear; being unable to clear a card that visibly shows a scope is not.
     */
    applies: (card) =>
      usesLeft(card) > 0 || card.overrideAllLocations === true || card.locationOverrideId !== null,
    body: () => ({}),
  },
  {
    id: "prompts",
    capabilityKey: "prompts_set",
    scope: "prompts",
    group: "At the pump",
    menuLabel: "Edit prompts…",
    applies: () => true,
    body: (draft) => ({
      // Always the literal `true`: full replace is the EFS semantic, and sending it explicitly means
      // the client can never arrive at it by omission.
      replaceAll: true,
      prompts: draft.prompts,
      allowRemoveDriverId: draft.prompts.some((p) => p.infoId === "DRID" && p.remove),
    }),
    blocker: (draft) =>
      (draft.prompts.length === 0 ? "This card has no prompt this product can edit." : null),
  },
];

/** A draft with nothing entered. The baseline the drawer's dirty check compares against. */
export const emptyDraft = (): OperationDraft =>
  ({ lockStatus: "Hold", uses: 1, scopeKind: "all", location: null, prompts: [], reason: "" });

/**
 * The card's prompts as editable drafts.
 *
 * Only `EFS_EDITABLE_INFO_IDS`. Everything else is echoed untouched by the API — and a `replaceAll`
 * carrying an info id nobody may edit is refused by the contract's own schema, while silently
 * dropping the rest is what deletes a driver assignment (guide p137).
 */
export const promptDrafts = (
  rows: readonly { infoId: string; validationType: string | null; matchValue: string | null; reportValue: string | null }[],
): PromptInput[] =>
  rows
    .filter((p) => (EFS_EDITABLE_INFO_IDS as readonly string[]).includes(p.infoId))
    .map((p) => ({
      infoId: p.infoId as PromptInput["infoId"],
      validationType: p.validationType === "REPORT_ONLY" ? "REPORT_ONLY" : "EXACT_MATCH",
      matchValue: p.matchValue,
      reportValue: p.reportValue,
      remove: false,
    }));

export const operationById = (id: CardOperationId): CardOperationSpec | null =>
  CARD_OPERATIONS.find((op) => op.id === id) ?? null;

/**
 * The link that opens one operation on one card — the ONLY place `?action=` is spelled.
 *
 * Three surfaces link here (the list page's kebab, the active-exceptions panel, the effective-config
 * table) and `FuelCardDetailPage.vue` parses it back through `operationFromQuery`. A hand-written
 * query string in any of them fails silently: the card page opens with no drawer, which reads as a
 * slow page rather than a broken link. One builder and one parser mean the only way to write an
 * unresolvable link is to pass a spec that does not exist, which the type system already refuses.
 */
export const operationLink = (cardId: string, operation: CardOperationSpec): string =>
  `/fuel-cards/${cardId}?action=${operation.id}`;

/** The other half, for a link somebody arrived on. Null for an id nobody declared. */
export const operationFromQuery = (action: unknown): CardOperationSpec | null =>
  (typeof action === "string" ? operationById(action as CardOperationId) : null);

/**
 * The `ui` block the contract declares — title, verb and tone, shared with the API's router and the
 * config scanner. The drawer's header reads it so a capability cannot be titled two different things
 * in two places.
 */
export const operationUi = (spec: CardOperationSpec) => CARD_CAPABILITY_CONTRACTS[spec.capabilityKey]?.ui ?? null;

/**
 * Whether this operation demands a WRITTEN reason.
 *
 * Per-capability, per the 2026-08-13 decision: `override_grant` is the discretionary end of the
 * range and "Why" is the first column an auditor reads on it, while nobody should be stranded at a
 * pump at 2am because a dispatcher had to type a sentence to lock a stolen card.
 */
export const reasonRequired = (spec: CardOperationSpec): boolean =>
  CARD_CAPABILITY_CONTRACTS[spec.capabilityKey]?.reason === "required";

/**
 * Bridge to the view registry, which is typed `CapabilityView<never>`.
 *
 * The cast is the one the registry's own docblock predicts and is confined to these three functions:
 * a map has one value type, so five views with five body types cannot keep their inference inside it.
 * What keeps it honest is that the BODY comes from `spec.body`, which is written against the same
 * contract the view was bound to by `defineView` — and
 * `capabilities/registry.test.ts` asserts the pairing exists.
 */
type AnyView = { confirmation: (body: unknown, card: CapabilityCardContext) => CapabilityConfirmation;
  diff: (before: OperationCard, body: unknown) => CapabilityDiffRow[];
  stepUp?: (body: unknown, card: CapabilityCardContext) => string | null };

const viewFor = (spec: CardOperationSpec): AnyView | null =>
  (CARD_CAPABILITY_VIEWS[spec.capabilityKey] as AnyView | undefined) ?? null;

export const operationConfirmation = (
  spec: CardOperationSpec, body: Record<string, unknown>, card: CapabilityCardContext,
): CapabilityConfirmation | null => viewFor(spec)?.confirmation(body, card) ?? null;

export const operationDiff = (
  spec: CardOperationSpec, before: OperationCard, body: Record<string, unknown>,
): CapabilityDiffRow[] => viewFor(spec)?.diff(before, body) ?? [];

/** Null when this operation has no step-up gate — see `CAPABILITIES_WITH_STEP_UP_GATE`. */
export const operationStepUp = (
  spec: CardOperationSpec, body: Record<string, unknown>, card: CapabilityCardContext,
): string | null => viewFor(spec)?.stepUp?.(body, card) ?? null;

/**
 * Why this operation is unavailable, or null — invariant 6, and the reason `capabilityStates` was
 * put on the wire.
 *
 * Promotion and suspension come from the server's per-capability map. The scope check is a SECOND
 * line and not the primary one: `capabilityStates` already folds the approver scopes in, and this
 * repeats it against `scopes` so an older API response that carries no map still refuses rather
 * than opening every operation at once.
 */
export const operationBlockedBy = (
  spec: CardOperationSpec,
  capabilities: CardCapabilities,
  scopes: readonly string[],
): string | null => {
  const state = capabilities.capabilityStates?.[spec.capabilityKey];
  if (state) return state;
  return scopes.includes(spec.scope) ? null : "not_approver";
};

/** One sentence per reason, each naming who to ask or what to run — never a bare "forbidden". */
export const blockedSentence = (reason: string): string => {
  switch (reason) {
    case "kill_switch": return "Card actions are switched off for this deployment.";
    case "not_enabled": return "Card actions are not switched on for this company yet. An admin can enable them in Settings → Card control.";
    case "no_credentials": return "EFS is not connected for this company.";
    case "not_entitled": return "EFS has not confirmed write access for this account. An admin needs to run the EFS write check.";
    case "endpoint_changed": return "The EFS connection changed since this company was checked. An admin needs to re-run the connection check.";
    case "not_promoted": return "This action has not been approved for this company yet. An admin needs to prove it on a test card first.";
    case "capability_suspended": return "This action is suspended for this company. An admin can re-enable it.";
    case "role": return "Your role cannot change fuel cards.";
    case "not_approver": return "You are not on this company's approver list for this action. Ask an admin to add you.";
    default: return "This action is not available for you on this card.";
  }
};

/** The card fields the drawer feeds a view, from the shape the detail page already holds. */
export const toOperationCard = (card: {
  status: string | null;
  infos?: WsCard["infos"];
  limits?: WsCard["limits"];
  overrideUses: number | null;
  overrideAllLocations: boolean | null;
  locationOverrideId: string | null;
}): OperationCard => ({
  status: card.status,
  infos: card.infos ?? [],
  limits: card.limits ?? [],
  overrideUses: card.overrideUses,
  overrideAllLocations: card.overrideAllLocations,
  locationOverrideId: card.locationOverrideId,
});
