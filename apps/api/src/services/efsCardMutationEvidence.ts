import { cardLast4 } from "@fuelguard/shared";
import { efsEndpointHost } from "./efsSoapCredentialIdentity.js";
import type { CardMutationContext } from "../efs/orchestrator/types.js";

/** Snapshot the connection and card facts before a mutation is dispatched. */
export function mutationLedgerEvidence(ctx: Pick<CardMutationContext, "creds" | "cardNumber">) {
  return {
    environment: ctx.creds.environment,
    endpoint_host: efsEndpointHost(ctx.creds.endpointUrl),
    card_last4: cardLast4(ctx.cardNumber),
  };
}
