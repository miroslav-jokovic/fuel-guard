import type { SupabaseClient } from "@supabase/supabase-js";
import { type CardCapabilities, type UserRole, rolesThatManage } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { credentialIdentityHash } from "./efsSoapCredentialIdentity.js";

const grandfatheredProbeOrgs = new Set<string>();

/**
 * One place that answers "may this person change this card, and if not, why not?"
 *
 * There is deliberately no `ModuleKey` in this chain. Card control is not a separate product — it is
 * what the EFS integration the customer already pays for does once EFS allows it. Gating on
 * entitlements would mean a customer with SOAP wired up and write access confirmed still gets a
 * `module_disabled` 403 for an unrelated reason. Instead FIVE facts must all hold, and each one is
 * real, diagnosable, and produces a different sentence on screen:
 *
 *   1. `EFS_CARD_CONTROL_ENABLED`      — the deploy-wide kill switch. Default off.
 *   2. `efs_soap_credentials.enabled`  — this org has a working EFS connection at all.
 *   3. `efs_card_control_settings.enabled` — this org has opted in. Default off: being able to READ
 *      cards must never imply permission to change them.
 *   4. `write_entitlement = 'confirmed'` — the probe proved EFS will accept our writes AND that a
 *      no-op echo leaves the card byte-identical. Until then this is 'unknown', which behaves exactly
 *      like 'denied' at the gate and differently in the UI, because "an admin needs to run the write
 *      check" and "EFS has not enabled this for your account" send a person to two different places.
 *   5. `probed_identity_hash` — the current EFS endpoint, username and account id still match the
 *      credential identity that established the entitlement. A null value is grandfathered temporarily.
 *
 * On top of those: the role must manage the `fuel` section, AND — when `require_approver` is on,
 * which is the default — the user must be named in `efs_card_control_approvers` for the relevant
 * scope. A forty-truck fleet has three or four fleet managers, and switching card control on must not
 * silently hand write access to all of them.
 *
 * The result is computed SERVER-SIDE and shipped to the client as `capabilities`. The browser can see
 * a role; it cannot see an entitlement, a kill switch or an approver list, so it must never be asked
 * to work this out.
 */

export type CardScope = "lock" | "unlock" | "override" | "prompts";

export interface CardControlAccess extends CardCapabilities {
  /** Scopes this user holds. Empty when they are not an approver, or when the gate is shut. */
  scopes: CardScope[];
  /** True when the org has opted in AND the entitlement is confirmed — i.e. writes are reachable. */
  orgReady: boolean;
}

export interface CardControlSettingsRow {
  enabled: boolean;
  write_entitlement: "unknown" | "confirmed" | "denied";
  require_approver: boolean;
  probed_identity_hash: string | null;
}

const NO_SCOPES: CardScope[] = [];

/**
 * Resolve capabilities for one user in one org.
 *
 * Never throws: a missing settings row, a missing credentials row and a database hiccup all resolve
 * to "no write access, and here is why". A read page must render even when the write side is
 * misconfigured — that is the whole point of shipping the read layer independently.
 */
export async function loadCardControlAccess(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  userId: string,
  role: UserRole | null,
): Promise<CardControlAccess> {
  const denied = (blockedBy: CardCapabilities["blockedBy"], writeEntitlement: CardCapabilities["writeEntitlement"] = "unknown"): CardControlAccess => ({
    canLock: false, canUnlock: false, canOverride: false, canSetPrompts: false,
    writeEntitlement, blockedBy, scopes: NO_SCOPES, orgReady: false,
  });

  if (!env.EFS_CARD_CONTROL_ENABLED) return denied("kill_switch");

  const [{ data: settings }, { data: credentials }] = await Promise.all([
    admin.from("efs_card_control_settings")
      .select("enabled, write_entitlement, require_approver, probed_identity_hash")
      .eq("org_id", orgId).maybeSingle(),
    admin.from("efs_soap_credentials")
      .select("enabled, endpoint_url, soap_username, account_id")
      .eq("org_id", orgId).maybeSingle(),
  ]);

  const row = (settings ?? null) as CardControlSettingsRow | null;
  const entitlement = row?.write_entitlement ?? "unknown";

  if (!credentials || (credentials as { enabled?: boolean }).enabled !== true) {
    return denied("no_credentials", entitlement);
  }
  if (!row?.enabled) return denied("not_enabled", entitlement);
  if (entitlement !== "confirmed") return denied("not_entitled", entitlement);

  const currentCredentials = credentials as {
    endpoint_url: string;
    soap_username: string;
    account_id: string | null;
  };
  const currentIdentity = credentialIdentityHash(env, {
    endpointUrl: currentCredentials.endpoint_url,
    soapUsername: currentCredentials.soap_username,
    accountId: currentCredentials.account_id,
  });
  const probedIdentity = row?.probed_identity_hash ?? null;
  if (probedIdentity !== null && probedIdentity !== currentIdentity) {
    return denied("endpoint_changed", entitlement);
  }
  if (probedIdentity === null && !grandfatheredProbeOrgs.has(orgId)) {
    grandfatheredProbeOrgs.add(orgId);
    console.warn(
      `[card-control] org ${orgId} has confirmed write entitlement without a recorded credential identity; ` +
        "allowing grandfathered access until the Phase 2 exit gate is satisfied",
    );
  }

  // The role gate is derived from the shared matrix rather than a hardcoded list, so it stays in step
  // with the API's other fuel-section routes and with the UI. rolesThatManage("fuel") is
  // admin + fleet_manager; a dispatcher granting fuel overrides is precisely the pattern this product
  // exists to DETECT, so it is not on this list by accident.
  if (!role || !rolesThatManage("fuel").includes(role)) {
    return { ...denied("role", entitlement), orgReady: true };
  }

  let scopes: CardScope[] = ["lock", "unlock", "override", "prompts"];
  if (row.require_approver) {
    const { data: approver } = await admin
      .from("efs_card_control_approvers")
      .select("scopes")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!approver) return { ...denied("not_approver", entitlement), orgReady: true };
    scopes = ((approver as { scopes?: string[] }).scopes ?? []).filter(isCardScope);
    if (scopes.length === 0) return { ...denied("not_approver", entitlement), orgReady: true };
  }

  return {
    canLock: scopes.includes("lock"),
    canUnlock: scopes.includes("unlock"),
    canOverride: scopes.includes("override"),
    canSetPrompts: scopes.includes("prompts"),
    writeEntitlement: entitlement,
    blockedBy: null,
    scopes,
    orgReady: true,
  };
}

function isCardScope(value: string): value is CardScope {
  return value === "lock" || value === "unlock" || value === "override" || value === "prompts";
}
