import type { CardMutationContext } from "./efsCardControl.js";

/** Options shared by the interactive card reads and writes in one mutation. */
export const cardOpOptions = (ctx: CardMutationContext) => ({
  priority: "interactive" as const,
  timeoutMs: ctx.env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
  fetchImpl: ctx.fetchImpl,
  signal: ctx.signal,
});
