import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env.js";
import { createSupabaseRecorder } from "../testing/supabaseRecorder.js";
import { credentialIdentityHash } from "./efsSoapCredentialIdentity.js";
import { loadCardControlAccess } from "./efsCardControlAccess.js";

const env = {
  EFS_CARD_CONTROL_ENABLED: true,
  SECRETS_ENCRYPTION_KEY: "0".repeat(64),
} as unknown as Env;
const envWithoutSecretsKey = { EFS_CARD_CONTROL_ENABLED: true } as unknown as Env;

const baseIdentity = {
  endpointUrl: "https://qa.efsllc.com/axis2/services/CardManagementWS/",
  soapUsername: "qa-user",
  accountId: null,
};

function accessRecorder(
  probedIdentityHash: string | null,
  current: Partial<typeof baseIdentity> = {},
  /** The promotion row the Step 4.2 gate reads. `undefined` models a row that does not exist. */
  promotion?: { state: string } | { error: string },
) {
  const promotionTable = promotion && "error" in promotion
    ? { data: null, error: { message: promotion.error } }
    : { data: promotion ?? null, error: null };
  return createSupabaseRecorder({
    tables: {
      efs_capability_promotions: promotionTable,
      efs_card_control_settings: {
        data: {
          enabled: true,
          write_entitlement: "confirmed",
          require_approver: false,
          probed_identity_hash: probedIdentityHash,
        },
        error: null,
      },
      efs_soap_credentials: {
        data: {
          enabled: true,
          endpoint_url: current.endpointUrl ?? baseIdentity.endpointUrl,
          soap_username: current.soapUsername ?? baseIdentity.soapUsername,
          account_id: current.accountId ?? baseIdentity.accountId,
        },
        error: null,
      },
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("card-control credential identity binding", () => {
  it("refuses card control when the SOAP username changed since the probe", async () => {
    const rec = accessRecorder(credentialIdentityHash(env, baseIdentity), {
      soapUsername: "production-user",
    });

    const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin");

    expect(access.blockedBy).toBe("endpoint_changed");
    expect(access.canLock).toBe(false);
  });

  it("still allows card control when only the password changed", async () => {
    const rec = accessRecorder(credentialIdentityHash(env, baseIdentity));

    const access = await loadCardControlAccess(
      rec.client,
      env,
      "org-password-rotation",
      "user-1",
      "admin",
    );

    expect(access.blockedBy).toBeNull();
    expect(access.canLock).toBe(true);
  });

  /**
   * Step 2.6, and this test is the whole point of it.
   *
   * Until 2026-08-15 this case asserted the OPPOSITE — that a confirmed entitlement with no recorded
   * credential identity was allowed through, logging one warning. That was migration 0187's
   * "temporary" grandfather clause, and it was live on 100% of the orgs card control governed: the
   * one org with an entitlement had a null hash, so the guard that stops a QA-confirmed entitlement
   * being exercised against a repointed credential never once ran.
   *
   * It refuses as `endpoint_changed` rather than earning a reason of its own because the operator's
   * next action is identical — re-run the write check — and migration 0194 makes the state
   * unrepresentable anyway. The distinction that would mislead ("the connection changed" when
   * nothing changed) is kept in the server log instead of the enum.
   */
  it("refuses card control when the entitlement was confirmed but no identity was ever recorded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rec = accessRecorder(null);

    const access = await loadCardControlAccess(
      rec.client,
      env,
      "org-never-bound",
      "user-1",
      "admin",
    );

    expect(access.blockedBy).toBe("endpoint_changed");
    expect(access.canLock).toBe(false);
    expect(access.canUnlock).toBe(false);
    expect(access.canOverride).toBe(false);
    expect(access.canSetPrompts).toBe(false);
    expect(access.orgReady).toBe(false);
    // Loud, and every time. This is now a refusal on a state a database constraint forbids, so a
    // line per request is a signal that something wrote around the constraint — not log spam.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("refuses on every request, not once per org — the warning is not deduplicated", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rec = accessRecorder(null);

    const first = await loadCardControlAccess(rec.client, env, "org-never-bound", "user-1", "admin");
    const second = await loadCardControlAccess(rec.client, env, "org-never-bound", "user-1", "admin");

    // The deleted grandfather branch remembered which orgs it had warned about, so the second call
    // was silent. A refusal that goes quiet after one request is how this defect stayed invisible.
    expect(first.blockedBy).toBe("endpoint_changed");
    expect(second.blockedBy).toBe("endpoint_changed");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("refuses card control when the stored endpoint URL cannot be parsed", async () => {
    const rec = accessRecorder(credentialIdentityHash(env, baseIdentity), {
      endpointUrl: "not-a-url",
    });

    const access = await loadCardControlAccess(rec.client, env, "org-invalid-endpoint", "user-1", "admin");

    expect(access.blockedBy).toBe("endpoint_changed");
    expect(access.canLock).toBe(false);
  });

  it("refuses card control when the secrets key is unavailable", async () => {
    const rec = accessRecorder(credentialIdentityHash(env, baseIdentity));

    const access = await loadCardControlAccess(
      rec.client,
      envWithoutSecretsKey,
      "org-missing-secrets-key",
      "user-1",
      "admin",
    );

    expect(access.blockedBy).toBe("endpoint_changed");
    expect(access.canLock).toBe(false);
  });

});

describe("the promotion gate (Step 4.2)", () => {
  const identity = () => credentialIdentityHash(env, baseIdentity);

  it("refuses a capability nobody has promoted, even for an admin on a confirmed org", async () => {
    // Every account-level fact holds — enabled, entitled, identity matching, admin role. The only
    // thing missing is our own record that somebody approved THIS capability here.
    const rec = accessRecorder(identity(), {}, undefined);

    const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin", "card_lock");

    expect(access.blockedBy).toBe("not_promoted");
    expect(access.canLock).toBe(false);
  });

  it("refuses a suspended capability even when write_entitlement is confirmed", async () => {
    const rec = accessRecorder(identity(), {}, { state: "suspended" });

    const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin", "card_lock");

    // Its own reason, not `not_promoted`: "switched off deliberately" and "never approved" send an
    // admin to two different places, and suspension is the one an operator reaches for at 2am.
    expect(access.blockedBy).toBe("capability_suspended");
  });

  it("allows a promoted capability", async () => {
    const rec = accessRecorder(identity(), {}, { state: "enabled" });

    const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin", "card_lock");

    // The pair matters: without it, a gate that refused unconditionally would satisfy both cases
    // above for the wrong reason.
    expect(access.blockedBy).toBeNull();
    expect(access.canLock).toBe(true);
  });

  it("does not consult the promotion table at all for a read — no capability named", async () => {
    // The read paths render what a user could do in general. Making them answer for a capability
    // nobody named would blank the whole card-control UI the moment one capability were suspended.
    const rec = accessRecorder(identity(), {}, undefined);

    const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin");

    expect(access.blockedBy).toBeNull();
    expect(access.canLock).toBe(true);
  });

  it("FAILS CLOSED when the promotion table cannot be read", async () => {
    const rec = accessRecorder(identity(), {}, { error: "relation does not exist" });

    const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin", "card_lock");

    // An unreadable promotion table is not permission. The alternative is that one database hiccup
    // silently opens every capability at once.
    expect(access.blockedBy).toBe("not_promoted");
    expect(access.canLock).toBe(false);
  });
});
