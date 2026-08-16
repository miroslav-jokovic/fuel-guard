import type { z } from "zod";
import type { CardMutationIntent } from "../cardControlLedger.js";
import type { CardWriteBucket } from "../cardWriteLimits.js";

/**
 * The CONTRACT half of a capability: what it is called, where it lives, and what it looks like.
 *
 * Browser-safe by construction — zod and plain data, no DOM, no `api` import, nothing that reaches a
 * vendor. That is what lets the API's router, the web drawer, the promotion table and the config
 * scanner all read the same declaration instead of four hand-kept copies (docs/27 §6.1, §7.1).
 *
 * Nothing consumes these yet. Step 3.3 introduces the vocabulary; 3.4 teaches the orchestrator to
 * speak it and 3.5 migrates the first capability. Adding the types first is what keeps that a
 * compile-checked migration rather than a rewrite.
 */

/**
 * WHAT is being mutated — and therefore three things the orchestrator derives and the capability
 * never implements: how the target is resolved from the request, what optimistic-concurrency token
 * exists, and what the ledger keys on (docs/27 §3.1).
 *
 * `expectedVersion` is a property of the TARGET, not of every write. A location group has no
 * document and no version; saying so in the type is what stops non-card operations from being
 * contorted into the card ledger.
 */
export type Target =
  | { kind: "card" }
  | { kind: "cardPair" }
  | { kind: "policy" }
  | { kind: "group" }
  | { kind: "account" };

/** A form control the drawer can render from the contract alone. */
export interface CapabilityInput {
  name: string;
  control: "stepper" | "radio" | "text" | "select" | "limitEditor" | "promptEditor";
  label?: string;
  optional?: boolean;
  min?: number;
  max?: number;
  options?: readonly string[];
}

export interface CapabilityUi {
  title: string;
  verb: string;
  tone: "neutral" | "warning" | "danger";
  inputs: readonly CapabilityInput[];
  /** Canonical field paths the confirmation diff should show, in order. */
  diffRows: readonly string[];
}


export interface CapabilityContract<TSchema extends z.ZodTypeAny> {
  /** The FINE key, persisted to `efs_card_mutations.capability_key` and unique across the registry. */
  key: string;
  /** The COARSE audit key. Many capabilities may share one intent — `override_clear` has two mechanisms. */
  intent: CardMutationIntent;
  /** The approver scope this promotes under. Widening the 0173 CHECK permits a value; it never grants it. */
  scope: string;
  route: { method: "POST" | "DELETE"; path: string };
  /**
   * MUST equal the bucket `cardWriteBucket()` resolves for the mounted path. The fitness test asserts
   * equality rather than existence, because `cardWriteBucket` returns null on a miss and the limiter
   * treats null as ALLOW — so a typo here is an unmetered write route, not a broken one.
   */
  writeBucket: CardWriteBucket;
  auditAction: string;
  schema: TSchema;
  /**
   * True when the request or response can contain a secret the default redaction does not cover — a
   * PIN, a password. Forces `redactResponse` to be overridden; the fitness test checks the pair.
   */
  carriesSecret: boolean;
  /** Vendor string fields this capability sends, and what it can emit — the config scanner's surface. */
  vocabularyFields: readonly string[];
  emittableValues: Readonly<Record<string, readonly string[]>>;
  /**
   * Fields whose casing is taken from the account's own fresh read AT WRITE TIME rather than from
   * `emittableValues` — so a case-only difference between the two is a handled adaptation, not a
   * mis-spelling that will be silently ignored.
   *
   * Exists because the config scanner (Step 4.4) would otherwise be factually wrong about `status`:
   * this account emits `ACTIVE`/`HOLD` where the guide says `Active`/`Hold`, and `matchStatusCasing`
   * has borrowed the observed casing since the 2026-08-12 incident. Reporting that as `mismatch`
   * would claim the next write is about to be dropped, which is the one thing that is NOT true of a
   * field with a named adapter in front of it — and it would make a correct, safe capability
   * permanently unpromotable under Step 4.6's `match`-only gate.
   *
   * Declared per field and per capability so it is never a blanket tolerance: standing rule 4 allows
   * a named, tested adapter and nothing else. The scanner still REPORTS the casing difference on the
   * value; only the field-level verdict changes.
   */
  casingAdaptiveFields?: readonly string[];
  ui: CapabilityUi;
}

/**
 * Identity, and the inference anchor.
 *
 * It looks like a no-op and is not: it pins `TSchema` so `z.infer` gives the behaviour and the view
 * the SAME body type. A contract change then breaks both at compile time instead of at runtime on a
 * real card (docs/27 §7.3).
 */
export const defineContract = <TSchema extends z.ZodTypeAny>(
  contract: CapabilityContract<TSchema>,
): CapabilityContract<TSchema> => contract;

/** The request body a contract accepts, shared by all three artifacts. */
export type BodyOf<TContract> = TContract extends CapabilityContract<infer TSchema> ? z.infer<TSchema> : never;
