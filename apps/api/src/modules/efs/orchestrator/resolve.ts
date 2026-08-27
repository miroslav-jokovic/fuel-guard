import type { z } from "zod";
import type { CapabilityContract } from "@silvicom/shared";
import type { CapabilityBehaviour } from "../types.js";
import type { ResolvedCapability } from "./types.js";

/**
 * Bind a contract to its behaviour and one request body — the registry path.
 *
 * The two halves are paired by KEY in the registry and joined here, which is why neither stores a
 * reference to the other: a stored link is a second pairing that can drift from the first.
 *
 * `governance` is the behaviour itself. `CapabilityBehaviour extends Governance`, so spreading the
 * fields into a fresh object would mean listing them — and a governance field added to the type but
 * forgotten in that list is a gate that silently stops running, which is the failure this codebase
 * has already produced five times (docs/29 §7).
 */
export function resolveCapability<TBody>(
  contract: CapabilityContract<z.ZodTypeAny>,
  behaviour: CapabilityBehaviour<TBody>,
  body: TBody,
): ResolvedCapability<TBody> {
  return {
    intent: contract.intent,
    capabilityKey: contract.key,
    requestBody: ledgerBody(contract, body),
    auditAction: contract.auditAction,
    target: behaviour.target,
    mutation: behaviour.mutation,
    verify: behaviour.verify,
    governance: behaviour,
    vendorMovesFields: behaviour.vendorMovesFields ?? [],
    body,
  };
}

/**
 * The request as the ledger records it, so a reconciler can re-run `verify.judge` against what was
 * actually asked for rather than guessing from the after-state (docs/27 §5.2).
 *
 * `carriesSecret` means the default redaction does not cover this body — a PIN, a password. Nothing
 * is stored in that case, rather than storing a guess about which field is the secret. The
 * cross-registry fitness test pairs `carriesSecret` with an overridden `redactResponse`; this is the
 * same posture applied to the column.
 */
function ledgerBody<TBody>(
  contract: CapabilityContract<z.ZodTypeAny>,
  body: TBody,
): Record<string, unknown> | null {
  if (contract.carriesSecret) return null;
  if (!body || typeof body !== "object") return null;
  return Object.fromEntries(Object.entries(body));
}
