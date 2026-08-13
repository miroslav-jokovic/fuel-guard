import { cardLast4 } from "@fuelguard/shared";
import { efsEndpointHost } from "./efsSoapCredentialIdentity.js";
import type { CardMutationContext } from "./efsCardControl.js";

/** Snapshot the connection and card facts before a mutation is dispatched. */
export function mutationLedgerEvidence(ctx: Pick<CardMutationContext, "creds" | "cardNumber">) {
  return {
    environment: ctx.creds.environment,
    endpoint_host: efsEndpointHost(ctx.creds.endpointUrl),
    card_last4: cardLast4(ctx.cardNumber),
  };
}

export const cardOpOptions = (ctx: CardMutationContext) => ({
  priority: "interactive" as const,
  timeoutMs: ctx.env.EFS_SOAP_INTERACTIVE_TIMEOUT_MS,
  fetchImpl: ctx.fetchImpl,
  signal: ctx.signal,
});
