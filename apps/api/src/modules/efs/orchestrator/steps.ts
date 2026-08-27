import type { ResolvedCapability, ResolvedStep } from "./types.js";

/**
 * Every capability is a sequence. Most of them are a sequence of one.
 *
 * Normalising here rather than branching in `dispatch` is what stops the step loop having two shapes,
 * and two shapes is how a guard that runs on the single-step path quietly stops running on the other.
 * A one-step sequence must produce byte-identical behaviour to the un-sequenced form — that is what
 * `fuelCardsControl.characterisation.test.ts` checks for all five existing routes.
 */
export const stepsOf = <TBody>(capability: ResolvedCapability<TBody>): readonly ResolvedStep<TBody>[] =>
  capability.mutation.kind === "sequence"
    ? capability.mutation.steps
    : [{ label: capability.intent, mutation: capability.mutation, verify: capability.verify }];

/** True when the capability declared steps, and therefore when `step_index` means anything. */
export const isSequenced = <TBody>(capability: ResolvedCapability<TBody>): boolean =>
  capability.mutation.kind === "sequence";

export function firstStep<TBody>(capability: ResolvedCapability<TBody>): ResolvedStep<TBody> {
  const step = stepsOf(capability)[0];
  // A sequence with no steps would dispatch nothing and then settle `succeeded`, reporting a change
  // that never happened. Refuse instead.
  if (!step) throw new Error(`capability ${capability.capabilityKey ?? capability.intent} declares an empty sequence`);
  return step;
}
