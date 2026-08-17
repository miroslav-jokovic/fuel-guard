import type { CardCapabilities, EfsLocation, PromptInput, WsCard } from "@fuelguard/shared";
import { allowedInfoIdsFrom, editableInfoIds, missingEditableInfoIds, promptDrafts } from "./promptDrafts";
export { allowedInfoIdsFrom, editableInfoIds, missingEditableInfoIds, promptDrafts };
import {
  CARD_CAPABILITY_CONTRACTS,
  EFS_CARD_STATUS_LABELS,
  EFS_WRITABLE_STATUSES,
  PROMPT_INPUT_UNSET,
  type EfsWritableStatus,
  canonicalEfsStatus,
  efsStatusEquals,
} from "@fuelguard/shared";
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

export type CardOperationId = "status" | "grant" | "clear" | "promptAdd" | "prompts";

/**
 * The two SECTIONS of the card page, each with its own `⋮`.
 *
 * Not three groups of buttons — Miki, 2026-08-16, on seeing the stacked action card Phase 6 shipped:
 * *"Action section is completely out of flow, bad looking and UX nightmare."* An operation belongs to
 * the thing it changes, and there are two of those: the card itself, and what the pump asks for.
 */
export type CardOperationGroup = "Current card" | "Prompts";

/** The scope names `capabilities.scopes` uses — the approver-list vocabulary, not the capability key. */
export type CardOperationScope = "lock" | "unlock" | "deactivate" | "override" | "prompts";

/**
 * Which capability writes each status, and under whose scope — the P0-3 split, in one place.
 *
 * Derived from, not duplicated by, `capabilityFor` and `statusRows`. They each carried their own copy
 * of this mapping until Step 8.1, which is two hand-lists of a security rule that have to agree: the
 * row decides what the drawer DISABLES, `capabilityFor` decides what it SENDS, and a disagreement
 * between them is an operation offered under one scope and dispatched under another. One table, read
 * twice, is the only version of this that cannot drift (docs/35 §4.3).
 *
 * Three statuses, three capabilities, three scopes — as of Phase 8.1 there is no longer any status
 * two capabilities can write. `Inactive` used to be reachable through `card_lock`, which recorded a
 * retirement as `card.locked`; see `cardDeactivate.contract.ts`.
 */
const STATUS_CAPABILITY: Record<EfsWritableStatus, { key: string; scope: CardOperationScope }> = {
  Active: { key: "card_unlock", scope: "unlock" },
  Inactive: { key: "card_deactivate", scope: "deactivate" },
  Hold: { key: "card_lock", scope: "lock" },
};

/** What the drawer knows about the card it is changing. A masked reference, never a PAN. */
export type OperationCard = CapabilityCardContext["card"];

/** Everything the five operations can collect between them. One object, so the drawer has one dirty check. */
export interface OperationDraft {
  /** The status the operator has ticked. Seeded from the card, so an untouched draft is a no-op. */
  targetStatus: EfsWritableStatus;
  uses: number;
  scopeKind: "all" | "location";
  location: EfsLocation | null;
  prompts: PromptInput[];
  /** Which prompt `promptAdd` is adding. Seeded to the first the card lacks. */
  /**
   * Step 9.2 widened this from `EfsEditableInfoId` — the DRID/UNIT union — to a plain string, for the
   * same reason `promptInputSchema.infoId` widened: which ids are addable is a per-ACCOUNT fact
   * resolved at runtime, and a compile-time union can only ever be right for an account that happens
   * to match it.
   */
  addInfoId: string | null;
}

export interface CardOperationSpec {
  id: CardOperationId;
  /** The contract this operation writes through — the key `capabilityStates` is keyed by. */
  capabilityKey: string;
  scope: CardOperationScope;
  /**
   * For an operation that spans capabilities, the one this DRAFT would write through.
   *
   * Only `status` has this, and the reason is audit **P0-3**: three statuses, two capabilities, two
   * approver scopes. `card_lock` may write `Hold` and `Inactive`; `card_unlock` is the only path to
   * `Active`. `Active` in the lock schema was an unlock reachable through the lock route — a
   * `lock`-only approver could reactivate a Fraud-held card and the audit row would say
   * `card.locked`. One flat control that ignored the split would put that hole back in the UI, so
   * the capability, the scope, the confirmation and the dispatch all resolve from the ticked value.
   */
  capabilityFor?: (draft: OperationDraft) => { key: string; scope: CardOperationScope };
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
  /**
   * `allowed` is the account's editable prompt ids (Step 9.1's client half). Passed to every
   * operation rather than only the two that read it, so a future operation that needs it does not
   * have to change this signature and every call site again.
   */
  applies: (card: OperationCard, allowed: readonly string[]) => boolean;
  /** The operation-specific half of the request body. The drawer adds the version and the key. */
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
    id: "status",
    capabilityKey: "card_lock",
    scope: "lock",
    group: "Current card",
    menuLabel: "Change status…",
    /**
     * One control for all three writable statuses, mirroring WEX's own portal — *Cards → View Cards
     * → Select → Change Status → New Status*, a menu of exactly Active / Inactive / Hold.
     *
     * It replaces the Lock / Deactivate / Unlock trio Phase 6 shipped. Three buttons for three values
     * of one field made the operator pick the VERB when the decision is the STATE, and it could not
     * express "this card is on Hold and should be retired" without unlocking first.
     */
    applies: () => true,
    capabilityFor: (draft) => STATUS_CAPABILITY[draft.targetStatus],
    /**
     * Only `card_lock` takes a status, because it is the only one of the three whose schema HAS the
     * field. `card_unlock` and `card_deactivate` each write exactly one status and carry none —
     * which is why the drawer must dispatch from the resolved capability and not from the body: two
     * of these three bodies are `{}` and are not the same request.
     */
    body: (draft) => (STATUS_CAPABILITY[draft.targetStatus].key === "card_lock"
      ? { status: draft.targetStatus }
      : {}),
  },
  {
    id: "grant",
    capabilityKey: "override_grant",
    scope: "override",
    group: "Current card",
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
    group: "Current card",
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
    id: "promptAdd",
    capabilityKey: "prompts_set",
    scope: "prompts",
    group: "Prompts",
    menuLabel: "Add prompt…",
    /**
     * ⚠️ The gap Miki found, and it is not cosmetic.
     *
     * *"unassigned cards dont have any prompts and we dont even have option to add them."* Correct:
     * every prompt path this product had edited or REMOVED records the card already carried, so a
     * card with an empty `<infos>` could never be given a Driver ID prompt — which is the whole of
     * FuelGuard's attribution signal for that card. Unreachable, silently, since the feature shipped.
     */
    applies: (card, allowed) => missingEditableInfoIds(card, allowed).length > 0,
    /**
     * `replaceAll` means the array in the request IS the card's prompts afterwards (guide p137), so
     * an ADD has to send every existing record back alongside the new one. Sending only the new one
     * would delete the rest — the exact deletion the characterisation suite exists to catch.
     */
    body: (draft) => ({
      replaceAll: true,
      prompts: draft.prompts,
      // An add never removes anything, so the DRID opt-in can never be needed here.
      allowRemoveDriverId: false,
    }),
    blocker: (draft) => {
      if (!draft.addInfoId) return "This card already has every prompt this product can set.";
      const added = draft.prompts.find((p) => p.infoId === draft.addInfoId);
      if (added?.validationType === "EXACT_MATCH" && !(added.matchValue ?? "").trim()) {
        // EXACT_MATCH is what makes the pump VALIDATE the entry. An empty one validates nothing and
        // is a prompt that stops nobody.
        return "Enter the value the driver must type at the pump.";
      }
      return null;
    },
  },
  {
    id: "prompts",
    capabilityKey: "prompts_set",
    scope: "prompts",
    group: "Prompts",
    menuLabel: "Edit prompts…",
    // Nothing to edit on a card with no editable record — that is `promptAdd`'s job.
    applies: (card, allowed) => editableInfoIds(card, allowed).length > 0,
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
export const emptyDraft = (current: string | null = null): OperationDraft =>
  ({ targetStatus: currentWritableStatus(current), uses: 1, scopeKind: "all", location: null, prompts: [], addInfoId: null });

/**
 * The card's status as one of the three the operator may write, or `Active` when it is neither.
 *
 * A card sitting at `Fraud` or `Deleted` has no row in the list — those are not writable states —
 * so the draft has to start SOMEWHERE. It starts at Active, and `statusRows` marks the real state
 * separately, because silently pre-ticking a value the card is not at is how somebody presses Save
 * and changes a card they only meant to look at.
 */
export const currentWritableStatus = (status: string | null): EfsWritableStatus =>
  EFS_WRITABLE_STATUSES.find((s) => efsStatusEquals(s, status)) ?? "Active";

export interface StatusRow {
  value: EfsWritableStatus;
  label: string;
  /** True when this is the card's status right now — the row that opens ticked. */
  current: boolean;
  /** The capability this row would write through, so the drawer can gate it per row. */
  capabilityKey: string;
  scope: CardOperationScope;
}

/**
 * The three rows the status control renders, in the vendor's own order.
 *
 * Each row carries the capability it would write through, because they are NOT all the same one —
 * see `capabilityFor`. The drawer disables a row whose capability this operator cannot reach and
 * says which, rather than hiding it: a missing row reads as "not a thing you can do to a card",
 * which is a different and wrong message.
 */
export const statusRows = (cardStatus: string | null): StatusRow[] =>
  EFS_WRITABLE_STATUSES.map((value) => ({
    value,
    label: EFS_CARD_STATUS_LABELS[value],
    current: efsStatusEquals(value, cardStatus),
    capabilityKey: STATUS_CAPABILITY[value].key,
    scope: STATUS_CAPABILITY[value].scope,
  }));

/**
 * The card's state when it is NOT one of the three, in words — or null when it is.
 *
 * `Fraud` and `Deleted` are real statuses EFS reports and neither can be written here. Showing the
 * three rows with nothing ticked and no explanation would leave an operator hunting for the row
 * that describes the card in front of them.
 */
export const unwritableStatusLabel = (cardStatus: string | null): string | null => {
  if (EFS_WRITABLE_STATUSES.some((s) => efsStatusEquals(s, cardStatus))) return null;
  const known = canonicalEfsStatus(cardStatus);
  return cardStatus ? (EFS_CARD_STATUS_LABELS[known as never] ?? cardStatus) : "Unknown";
};

/** The capability and scope THIS draft would write through — see `capabilityFor`. */
export const resolveCapability = (
  spec: CardOperationSpec, draft: OperationDraft,
): { key: string; scope: CardOperationScope } =>
  spec.capabilityFor?.(draft) ?? { key: spec.capabilityKey, scope: spec.scope };

/**
 * A draft seeded from the card, including `promptAdd`'s new blank record.
 *
 * The new record joins `prompts` rather than sitting beside it, so the body is a plain `replaceAll`
 * of the whole array and nothing has to remember to merge the two — which is how an add turns into
 * a delete of everything else (guide p137).
 *
 * Pure, and out here rather than in the drawer, because the drawer calls it three times — on seed,
 * inside the dirty comparison, and on a 409 reseed — and a `dirty` check computing its baseline
 * differently from `seed()` reads TRUE on an untouched drawer. That is exactly the defect Step 6.1
 * shipped and `seededFor` had to paper over.
 */
export const seedDraftFor = (
  operation: CardOperationSpec | null,
  status: string,
  prompts: readonly { infoId: string; validationType: string | null; matchValue: string | null; reportValue: string | null }[],
  allowed: readonly string[],
): OperationDraft => {
  const base = { ...emptyDraft(status), prompts: promptDrafts(prompts, allowed) };
  if (operation?.id !== "promptAdd") return base;
  const addInfoId = missingEditableInfoIds({
    status, infos: prompts as OperationCard["infos"], limits: [],
    overrideUses: null, overrideAllLocations: null, locationOverrideId: null,
  }, allowed)[0] ?? null;
  return addInfoId === null ? base : {
    ...base,
    addInfoId,
    prompts: [...base.prompts, {
      infoId: addInfoId,
      // EXACT_MATCH by default: a prompt the pump only RECORDS stops nobody, and the operator can
      // downgrade it deliberately. Defaulting the other way makes the weaker choice the silent one.
      validationType: "EXACT_MATCH",
      ...PROMPT_INPUT_UNSET,
      matchValue: "",
      reportValue: null,
      remove: false,
    }],
  };
};

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

const viewFor = (spec: CardOperationSpec, draft?: OperationDraft): AnyView | null => {
  const key = draft ? resolveCapability(spec, draft).key : spec.capabilityKey;
  return (CARD_CAPABILITY_VIEWS[key] as AnyView | undefined) ?? null;
};

export const operationConfirmation = (
  spec: CardOperationSpec, body: Record<string, unknown>, card: CapabilityCardContext,
  draft?: OperationDraft,
): CapabilityConfirmation | null => viewFor(spec, draft)?.confirmation(body, card) ?? null;

export const operationDiff = (
  spec: CardOperationSpec, before: OperationCard, body: Record<string, unknown>,
  draft?: OperationDraft,
): CapabilityDiffRow[] => viewFor(spec, draft)?.diff(before, body) ?? [];

/** Null when this operation has no step-up gate — see `CAPABILITIES_WITH_STEP_UP_GATE`. */
export const operationStepUp = (
  spec: CardOperationSpec, body: Record<string, unknown>, card: CapabilityCardContext,
  draft?: OperationDraft,
): string | null => viewFor(spec, draft)?.stepUp?.(body, card) ?? null;

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
  draft?: OperationDraft,
): string | null => {
  const { key, scope } = draft ? resolveCapability(spec, draft) : { key: spec.capabilityKey, scope: spec.scope };
  return capabilityBlockedBy(key, scope, capabilities, scopes);
};

/** The same test for ONE capability — what the status control gates each of its three rows on. */
export const capabilityBlockedBy = (
  capabilityKey: string,
  scope: string,
  capabilities: CardCapabilities,
  scopes: readonly string[],
): string | null => {
  const state = capabilities.capabilityStates?.[capabilityKey];
  if (state) return state;
  return scopes.includes(scope) ? null : "not_approver";
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
