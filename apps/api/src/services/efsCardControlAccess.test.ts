import { afterEach, describe, expect, it, vi } from "vitest";
import { EFS_EDITABLE_INFO_IDS } from "@fuelguard/shared";
import { createSupabaseRecorder } from "../testing/supabaseRecorder.js";
import { credentialIdentityHash } from "./efsSoapCredentialIdentity.js";
import { loadCardControlAccess } from "./efsCardControlAccess.js";
import { testEnv } from "../testing/testEnv.js";

const env = testEnv({
  EFS_CARD_CONTROL_ENABLED: true,
  SECRETS_ENCRYPTION_KEY: "0".repeat(64),
});
const envWithoutSecretsKey = testEnv({ EFS_CARD_CONTROL_ENABLED: true });

const baseIdentity = {
  endpointUrl: "https://qa.efsllc.com/axis2/services/CardManagementWS/",
  soapUsername: "qa-user",
  accountId: null,
};

function accessRecorder(
  probedIdentityHash: string | null,
  current: Partial<typeof baseIdentity> = {},
  /**
   * The promotion rows the Step 4.2 gate reads, keyed by capability. A key that is absent models a
   * capability nobody has promoted; `{ error }` models a table that cannot be read at all.
   *
   * A MAP, and an array on the wire, since Step 6.1 made this one query for every capability rather
   * than one lookup per named key. A fixture that still returned a bare row would have let the
   * production code's `.map` throw and no test would have said which line did it.
   */
  promotion?: Record<string, string> | { error: string },
  environment = "sandbox",
  /** Step 9.1's cache. `null` models an org whose inventory walk has never run. */
  promptTypes: string[] | null = null,
) {
  const promotionTable = promotion && "error" in promotion
    ? { data: null, error: { message: promotion.error } }
    : {
        data: Object.entries(promotion ?? {}).map(([capability_key, state]) => ({ capability_key, state })),
        error: null,
      };
  return createSupabaseRecorder({
    tables: {
      efs_capability_promotions: promotionTable,
      efs_card_control_settings: {
        data: {
          enabled: true,
          write_entitlement: "confirmed",
          require_approver: false,
          probed_identity_hash: probedIdentityHash,
          prompt_types: promptTypes,
        },
        error: null,
      },
      efs_soap_credentials: {
        data: {
          enabled: true,
          endpoint_url: current.endpointUrl ?? baseIdentity.endpointUrl,
          soap_username: current.soapUsername ?? baseIdentity.soapUsername,
          account_id: current.accountId ?? baseIdentity.accountId,
          environment,
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
  /**
   * Step 9.1's client half: the account's editable prompt ids must REACH the browser.
   *
   * Until 2026-08-17 they did not. The set was resolved server-side, cached per org and threaded to
   * the write path, and no endpoint carried it to the client — so `promptDrafts.ts` went on keying
   * the drawer to the hardcoded DRID/UNIT pair while the API accepted twenty-four. The drawer
   * offered two ids and nothing anywhere said why.
   */
  it("ships the ACCOUNT's editable prompt ids, resolved from the cached prompt_types", async () => {
    const rec = accessRecorder(credentialIdentityHash(env, baseIdentity), {}, undefined, "sandbox",
      ["DRID", "UNIT", "TRLR", "NAME"]);

    const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin");

    // Intersected with the guide's Info IDs table by `resolveEditableInfoIds`, so this asserts the
    // account's answer reached the field — not that the raw column was copied through.
    expect(access.editableInfoIds).toContain("TRLR");
    expect(access.editableInfoIds.length).toBeGreaterThan(2);
  });

  it("falls back to the pair for an org whose inventory walk has never run", async () => {
    // A missing cache is the state EVERY org is in until its first walk. It must narrow the UI, not
    // empty it — an empty set would claim this account permits editing nothing.
    const rec = accessRecorder(credentialIdentityHash(env, baseIdentity), {}, undefined, "sandbox", null);

    const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin");

    expect([...access.editableInfoIds]).toEqual([...EFS_EDITABLE_INFO_IDS]);
  });

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
    const rec = accessRecorder(identity(), {}, { card_lock: "suspended" });

    const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin", "card_lock");

    // Its own reason, not `not_promoted`: "switched off deliberately" and "never approved" send an
    // admin to two different places, and suspension is the one an operator reaches for at 2am.
    expect(access.blockedBy).toBe("capability_suspended");
  });

  it("allows a promoted capability", async () => {
    const rec = accessRecorder(identity(), {}, { card_lock: "enabled" });

    const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin", "card_lock");

    // The pair matters: without it, a gate that refused unconditionally would satisfy both cases
    // above for the wrong reason.
    expect(access.blockedBy).toBeNull();
    expect(access.canLock).toBe(true);
  });

  /**
   * Rewritten in Step 6.1, and the property it defends is unchanged.
   *
   * It used to assert the read path never READ the promotion table. That was the mechanism, not the
   * point: the point is that a read must not be blanked by one capability's state, which is why
   * `loadCardControlAccess` takes `capabilityKey` optionally at all. The read now does consult the
   * table — `capabilityStates` is built from it — so the assertion moves to the property itself, and
   * gains the half it could not previously make: that the suspension is REPORTED rather than merely
   * survived.
   */
  it("never blanks a read because one capability is suspended — it reports it per capability", async () => {
    const rec = accessRecorder(identity(), {}, { card_lock: "enabled", override_grant: "suspended" });

    const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin");

    expect(access.blockedBy).toBeNull();
    expect(access.canLock).toBe(true);
    expect(access.capabilityStates.card_lock).toBeNull();
    expect(access.capabilityStates.override_grant).toBe("capability_suspended");
  });

  it("FAILS CLOSED when the promotion table cannot be read", async () => {
    const rec = accessRecorder(identity(), {}, { error: "relation does not exist" });

    const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin", "card_lock");

    // An unreadable promotion table is not permission. The alternative is that one database hiccup
    // silently opens every capability at once.
    expect(access.blockedBy).toBe("not_promoted");
    expect(access.canLock).toBe(false);
  });

  /**
   * The trap this batch rewrite very nearly shipped.
   *
   * An ENABLED capability's entry in the map is `null`, so the ordinary fail-closed idiom —
   * `promotions[key] ?? "not_promoted"` — refuses every capability anybody has promoted, while all
   * three refusal cases above stay green. The gate would have looked thoroughly tested and worked
   * for nobody. `allows a promoted capability` covers `card_lock`; this covers the rest, so a
   * regression cannot hide behind the one key the other cases happen to name.
   */
  it("allows EVERY promoted capability, not only the one the other cases name", async () => {
    for (const key of ["card_unlock", "override_grant", "override_clear", "prompts_set"]) {
      const rec = accessRecorder(identity(), {}, { [key]: "enabled" });

      const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin", key);

      expect(access.blockedBy, `${key} blockedBy`).toBeNull();
      expect(access.capabilityStates[key], `${key} state`).toBeNull();
    }
  });

  it("refuses a capability key the registry does not carry", async () => {
    // Not a hypothetical shape: the key arrives from the mounted route table, and a capability this
    // service has no promotion record for must refuse rather than sail past the gate.
    const rec = accessRecorder(identity(), {}, { card_lock: "enabled" });

    const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin", "card_teleport");

    expect(access.blockedBy).toBe("not_promoted");
  });
});

describe("what the drawer renders one button from (Step 6.1)", () => {
  const identity = () => credentialIdentityHash(env, baseIdentity);
  const allEnabled = {
    card_lock: "enabled", card_unlock: "enabled", override_grant: "enabled",
    override_clear: "enabled", delete_override: "enabled", prompts_set: "enabled",
  };

  it("reports an account-level refusal against every capability, so each button can explain itself", async () => {
    // The kill switch blocks all six. A drawer that knew only `blockedBy` would have to render a
    // page-level banner and leave the operator to work out whether it covered the button in front
    // of them; `capabilityStates` lets the same sentence sit on the operation they are looking at.
    const rec = accessRecorder(identity(), {}, allEnabled);

    const access = await loadCardControlAccess(
      rec.client, testEnv({ EFS_CARD_CONTROL_ENABLED: false }), "org-1", "user-1", "admin",
    );

    expect(access.blockedBy).toBe("kill_switch");
    expect(Object.values(access.capabilityStates)).not.toHaveLength(0);
    for (const [key, state] of Object.entries(access.capabilityStates)) {
      expect(state, `${key} state`).toBe("kill_switch");
    }
  });

  /**
   * Promotion before scope, deliberately: "nobody here is approved for this action" and "you
   * personally are not on the list" send two different people to two different places, and reporting
   * the personal one first sends an approver hunting permissions that would not have helped.
   */
  it("blames the promotion, not the person, when both would block", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        efs_capability_promotions: {
          data: [{ capability_key: "card_lock", state: "suspended" }],
          error: null,
        },
        efs_card_control_settings: {
          data: {
            enabled: true, write_entitlement: "confirmed", require_approver: true,
            probed_identity_hash: identity(),
          },
          error: null,
        },
        efs_card_control_approvers: { data: { scopes: ["unlock"] }, error: null },
        efs_soap_credentials: {
          data: {
            enabled: true, endpoint_url: baseIdentity.endpointUrl,
            soap_username: baseIdentity.soapUsername, account_id: baseIdentity.accountId,
            environment: "production",
          },
          error: null,
        },
      },
    });

    const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin");

    // This user holds `unlock` only, so `card_lock` is suspended AND out of their scope. The
    // suspension is the answer: `not_approver` here would send them to ask for a permission that
    // would not have let them lock the card either.
    expect(access.capabilityStates.card_lock).toBe("capability_suspended");
  });

  it("names the scope the operator is missing when the capability itself is fine", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        efs_capability_promotions: {
          data: Object.entries(allEnabled).map(([capability_key, state]) => ({ capability_key, state })),
          error: null,
        },
        efs_card_control_settings: {
          data: {
            enabled: true, write_entitlement: "confirmed", require_approver: true,
            probed_identity_hash: identity(),
          },
          error: null,
        },
        efs_card_control_approvers: { data: { scopes: ["unlock"] }, error: null },
        efs_soap_credentials: {
          data: {
            enabled: true, endpoint_url: baseIdentity.endpointUrl,
            soap_username: baseIdentity.soapUsername, account_id: baseIdentity.accountId,
            environment: "production",
          },
          error: null,
        },
      },
    });

    const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin");

    expect(access.capabilityStates.card_unlock).toBeNull();
    expect(access.capabilityStates.card_lock).toBe("not_approver");
    expect(access.capabilityStates.override_grant).toBe("not_approver");
  });

  it("carries the environment, which is what tells an operator the card is real", async () => {
    const rec = accessRecorder(identity(), {}, allEnabled, "production");

    const access = await loadCardControlAccess(rec.client, env, "org-1", "user-1", "admin");

    expect(access.environment).toBe("production");
  });

  it("says nothing about the environment when the deploy is switched off before reading one", async () => {
    // Null is not "production". A kill-switched deploy never reaches the credential row, and
    // guessing here would put a confident badge on a screen that consulted nothing.
    const rec = accessRecorder(identity(), {}, allEnabled, "production");

    const access = await loadCardControlAccess(
      rec.client, testEnv({ EFS_CARD_CONTROL_ENABLED: false }), "org-1", "user-1", "admin",
    );

    expect(access.environment).toBeNull();
  });
});
