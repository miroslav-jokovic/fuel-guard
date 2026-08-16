import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CARD_CAPABILITY_CONTRACTS,
  CARD_CAPABILITY_KEYS,
  type CardBlockedBy,
  type CardCapabilities,
  type UserRole,
  rolesThatManage,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { credentialIdentityHash } from "./efsSoapCredentialIdentity.js";

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
 *      credential identity that established the entitlement. A null value REFUSES (Step 2.6): an
 *      entitlement confirmed against a credential nobody recorded is not evidence about the
 *      credential in the row today.
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
 * One account-level refusal, expressed per capability.
 *
 * A kill switch blocks all six, and saying so for each is what lets the drawer put the SAME sentence
 * on the one operation somebody is looking at rather than making them read a page-level banner and
 * work out whether it applies to the button in front of them.
 */
const allBlocked = (reason: CardBlockedBy): CardCapabilities["capabilityStates"] =>
  Object.fromEntries(CARD_CAPABILITY_KEYS.map((key) => [key, reason]));

/**
 * Resolve capabilities for one user in one org.
 *
 * Never throws: a missing settings row, a missing credentials row and a database hiccup all resolve
 * to "no write access, and here is why". A read page must render even when the write side is
 * misconfigured — that is the whole point of shipping the read layer independently.
 */
/**
 * Which capabilities are allowed on this one org, right now? (Step 4.2)
 *
 * ── Deliberately uncached, and that is the feature ──────────────────────────────────────────────
 * One extra indexed lookup per card write, against `uq_efs_capability_promotions_org_capability`.
 * A TTL cache would make suspension take effect "within a minute", and suspension is the control an
 * operator reaches for when a capability is actively doing damage — a minute of a runaway write path
 * is the entire scenario this table exists to end. The plan says not to add one; this is why.
 *
 * ── Fails CLOSED on a database error ────────────────────────────────────────────────────────────
 * An unreadable promotion table is not permission. It resolves to `not_promoted`, which refuses,
 * because the alternative is that a database hiccup silently opens every capability at once.
 *
 * ── One query for all six, since Step 6.1 ──────────────────────────────────────────────────────
 * It used to read a single named capability, which is all the WRITE path needs. The read path needs
 * every one at once — see `capabilityStates` on the contract — and running six single-row lookups to
 * build that map would multiply exactly the per-request cost the note above is careful about. Same
 * index, same fail-closed rule, one round trip; the write path then reads its own key out of the map.
 */
async function promotionStates(
  admin: SupabaseClient,
  orgId: string,
  /**
   * The capability being attempted, when there is one. Included in the query even if the shared
   * registry does not carry it: `efs/router.ts` mounts from `ALL_CAPABILITIES`, and a capability
   * mounted from somewhere else is still one this gate must answer for from its ROW rather than
   * from registry membership. Refusing on membership alone would make the gate a second, quieter
   * definition of which capabilities exist.
   */
  capabilityKey?: string,
): Promise<Record<string, CardBlockedBy | null>> {
  const keys = capabilityKey !== undefined && !CARD_CAPABILITY_KEYS.includes(capabilityKey)
    ? [...CARD_CAPABILITY_KEYS, capabilityKey]
    : CARD_CAPABILITY_KEYS;

  const { data, error } = await admin
    .from("efs_capability_promotions")
    .select("capability_key, state")
    .eq("org_id", orgId)
    .in("capability_key", keys);
  // An unreadable table is not permission for ANY of them — the whole map fails closed together.
  if (error) return Object.fromEntries(keys.map((key) => [key, "not_promoted" as const]));

  const rows = (data ?? []) as { capability_key: string; state: string }[];
  const byKey = new Map(rows.map((r) => [r.capability_key, r.state]));
  return Object.fromEntries(keys.map((key) => {
    const state = byKey.get(key) ?? null;
    if (state === "enabled") return [key, null];
    // `suspended` gets its own answer: "switched off deliberately" and "never approved" send an
    // admin to two different places, exactly as `not_entitled` and `not_enabled` already do.
    return [key, state === "suspended" ? "capability_suspended" : "not_promoted"];
  }));
}

/**
 * The scope a capability promotes under, as its own contract declares it.
 *
 * Fails CLOSED on a scope this service does not know: a capability whose scope is outside the four
 * is one no approver record can ever grant, and treating it as held would hand write access out on
 * a typo. Derived from the contract rather than a second table so adding a capability cannot leave
 * a mapping behind.
 */
const capabilityScope = (key: string): CardScope | null => {
  const scope = CARD_CAPABILITY_CONTRACTS[key]?.scope;
  return scope !== undefined && isCardScope(scope) ? scope : null;
};

export async function loadCardControlAccess(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  userId: string,
  role: UserRole | null,
  /**
   * The capability being attempted. Omitted by the READ paths, which render what a user could do in
   * general and must not be made to answer for a capability nobody named — passing one there would
   * blank the whole card-control UI the moment a single capability were suspended.
   */
  capabilityKey?: string,
): Promise<CardControlAccess> {
  /**
   * Filled once the credential row is read, and NOT before. A kill-switched deploy is refused
   * without ever looking at a credential, so its answer is honestly null rather than a guess.
   * `denied` reads it at call time, so every refusal after that point carries the badge.
   */
  let environment: CardCapabilities["environment"] = null;

  const denied = (blockedBy: CardBlockedBy, writeEntitlement: CardCapabilities["writeEntitlement"] = "unknown"): CardControlAccess => ({
    canLock: false, canUnlock: false, canOverride: false, canSetPrompts: false,
    writeEntitlement, blockedBy, capabilityStates: allBlocked(blockedBy), environment,
    scopes: NO_SCOPES, orgReady: false,
  });

  if (!env.EFS_CARD_CONTROL_ENABLED) return denied("kill_switch");

  const [{ data: settings }, { data: credentials }] = await Promise.all([
    admin.from("efs_card_control_settings")
      .select("enabled, write_entitlement, require_approver, probed_identity_hash")
      .eq("org_id", orgId).maybeSingle(),
    admin.from("efs_soap_credentials")
      .select("enabled, endpoint_url, soap_username, account_id, environment")
      .eq("org_id", orgId).maybeSingle(),
  ]);

  const row = (settings ?? null) as CardControlSettingsRow | null;
  const entitlement = row?.write_entitlement ?? "unknown";

  // Read before the enabled check: which installation a disabled connection POINTS at is exactly
  // what an admin is trying to confirm while they switch it on. The column is `not null` with a
  // 'sandbox' default and a CHECK of the two values (migration 0091); anything else stays null
  // rather than being coerced into a claim about where a write would land.
  const environmentValue = (credentials as { environment?: string } | null)?.environment ?? null;
  if (environmentValue === "sandbox" || environmentValue === "production") {
    environment = environmentValue;
  }

  if (!credentials || (credentials as { enabled?: boolean }).enabled !== true) {
    return denied("no_credentials", entitlement);
  }
  if (!row?.enabled) return denied("not_enabled", entitlement);
  if (entitlement !== "confirmed") return denied("not_entitled", entitlement);

  // AFTER the account-level facts and before the per-user ones: a capability nobody promoted is
  // refused whoever is asking, and telling an approver "you are not on the list" when the real
  // answer is "this action is not approved for anyone here" sends them to the wrong place.
  const promotions = await promotionStates(admin, orgId, capabilityKey);
  if (capabilityKey) {
    /**
     * `??` is deliberately NOT used here. An enabled capability's entry IS `null`, so the ordinary
     * fail-closed idiom `promotions[key] ?? "not_promoted"` would refuse every capability anybody
     * had promoted — a fail-closed reflex applied to a map whose success value is nullish. The map
     * is built to hold an entry for `capabilityKey` whether or not the registry carries it, so a
     * missing row has already become `not_promoted` above.
     */
    const promotion = promotions[capabilityKey];
    if (promotion) return denied(promotion, entitlement);
  }

  const currentCredentials = credentials as {
    endpoint_url: string;
    soap_username: string;
    account_id: string | null;
  };
  /**
   * A credential whose identity cannot be computed — an unparseable endpoint or a missing sealing key —
   * is not a credential that matches what was probed. Returning `endpoint_changed` is strictly better
   * than a 500 that tells the operator nothing and could leave the capability path ambiguous.
   */
  let currentIdentity: string;
  try {
    currentIdentity = credentialIdentityHash(env, {
      endpointUrl: currentCredentials.endpoint_url,
      soapUsername: currentCredentials.soap_username,
      accountId: currentCredentials.account_id,
    });
  } catch {
    return denied("endpoint_changed", entitlement);
  }
  const probedIdentity = row?.probed_identity_hash ?? null;
  /**
   * Step 2.6 — this branch used to ALLOW.
   *
   * Migration 0187 added the column nullable and grandfathered a null "temporarily", logging one
   * warning per process. The temporary outlived the migration: on 2026-08-15 the only org with card
   * control had `write_entitlement = 'confirmed'` and a null hash, so this guard had never once run
   * on any org it governed. An entitlement proved against a credential nobody recorded says nothing
   * about the credential the row points at today — which is the entire question this fact exists to
   * answer — so it now refuses.
   *
   * Migration 0194 makes the state unrepresentable. Reaching this branch therefore means the
   * constraint is gone or something wrote around it, and both are reasons to refuse rather than
   * allow. It is deliberately NOT deduplicated per org the way the grandfather warning was: a
   * refusal that goes quiet after the first request is how the original defect stayed invisible.
   *
   * It reuses `endpoint_changed` rather than earning a reason of its own because the operator's next
   * action is identical — re-run the write check. That code's copy ("the EFS connection changed")
   * is wrong for this case in a way that would send somebody hunting a credential rotation that
   * never happened, so the honest sentence lives here, in the log, where they will actually be.
   */
  if (probedIdentity === null) {
    console.warn(
      `[card-control] org ${orgId} has a confirmed write entitlement and NO recorded credential ` +
        "identity — refusing. Nothing changed; it was never bound. Re-run the EFS write check.",
    );
    return denied("endpoint_changed", entitlement);
  }
  if (probedIdentity !== currentIdentity) {
    return denied("endpoint_changed", entitlement);
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
    /**
     * Promotion FIRST, then this user's scopes.
     *
     * The order is the same one the refusals above follow, and for the same reason: "nobody here is
     * approved for this action" and "you personally are not on the list" send two different people
     * to two different places, and reporting the personal one first would send an approver hunting
     * their own permissions for a capability no amount of permission would unlock.
     */
    capabilityStates: Object.fromEntries(CARD_CAPABILITY_KEYS.map((key) => {
      const promotion = promotions[key];
      if (promotion) return [key, promotion];
      const scope = capabilityScope(key);
      return [key, scope !== null && scopes.includes(scope) ? null : "not_approver"];
    })),
    environment,
    scopes,
    orgReady: true,
  };
}

function isCardScope(value: string): value is CardScope {
  return value === "lock" || value === "unlock" || value === "override" || value === "prompts";
}
