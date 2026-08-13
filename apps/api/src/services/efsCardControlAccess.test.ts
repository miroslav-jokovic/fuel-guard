import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../env.js";
import { createSupabaseRecorder } from "../testing/supabaseRecorder.js";
import { credentialIdentityHash } from "./efsSoapCredentialIdentity.js";
import { loadCardControlAccess } from "./efsCardControlAccess.js";

const env = {
  EFS_CARD_CONTROL_ENABLED: true,
  SECRETS_ENCRYPTION_KEY: "0".repeat(64),
} as unknown as Env;

const baseIdentity = {
  endpointUrl: "https://qa.efsllc.com/axis2/services/CardManagementWS/",
  soapUsername: "qa-user",
  accountId: null,
};

function accessRecorder(
  probedIdentityHash: string | null,
  current: Partial<typeof baseIdentity> = {},
) {
  return createSupabaseRecorder({
    tables: {
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

  it("allows card control when the probed identity has never been recorded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rec = accessRecorder(null);

    const access = await loadCardControlAccess(
      rec.client,
      env,
      "org-grandfathered",
      "user-1",
      "admin",
    );

    expect(access.blockedBy).toBeNull();
    expect(access.canLock).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
