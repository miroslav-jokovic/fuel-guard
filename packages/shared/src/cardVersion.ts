import { z } from "zod";

/**
 * The optimistic-concurrency token, computed by us over the mutable part of the card document. EFS
 * offers no ETag, no lastModified and no row version, so this is the only defence against two
 * dispatchers editing one card — or against a change made in the WEX portal between the read that
 * drew the screen and the write that acts on it.
 *
 * ── Why it lives in a leaf module of its own ────────────────────────────────────────────────────
 * Every mutation schema needs it, including the prompt schemas that Step 9.2 moved into
 * `cardControlPrompts.ts`. Leaving it in `cardControlContract.ts` — which re-exports the prompt
 * schemas so no caller has to know they moved — made a RUNTIME CYCLE: prompts imported the version
 * schema from contract, contract imported the prompt schemas from prompts, and whichever loaded
 * second saw `undefined` where a Zod schema belonged. `setPromptsSchema` was built against it and
 * every prompt contract test failed with "expected a Zod schema".
 *
 * That is the failure `orchestrator/types.ts` warns about in almost these words, and it is worth
 * noting it did NOT stay hidden until a bundler found it: the ten contract tests went red
 * immediately. A leaf with no imports of its own cannot participate in a cycle at all.
 */
export const cardVersionSchema = z.string().min(16);
