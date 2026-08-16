import { describe, it, expect, vi } from "vitest";
import {
  loadSamsaraToken,
  saveSamsaraToken,
  clearSamsaraToken,
  sealPlaintextSamsaraTokens,
  SAMSARA_TOKEN_PURPOSE,
} from "./samsaraToken.js";
import { seal, secretAad, SecretBoxError } from "./secretBox.js";
import { createSupabaseRecorder, expectOrgScoped } from "../testing/supabaseRecorder.js";
import { testEnv } from "../testing/testEnv.js";

/**
 * Migrated off the local `makeAdmin` Proxy (audit 2026-08-09, Stage 2.5): its fallthrough discarded
 * every filter, so `.eq("org_id", orgId)` on the credential read/update was untestable — and this is
 * the table where a cross-tenant read hands out another fleet's telematics token. The recorder keeps
 * the same write capture and lets `expectOrgScoped` assert the tenant filter itself.
 */
const KEY = Buffer.alloc(32, 7).toString("base64");
const env = testEnv({ SECRETS_ENCRYPTION_KEY: KEY });
const envNoKey = testEnv();
const envWithFallback = testEnv({ SECRETS_ENCRYPTION_KEY: KEY, SAMSARA_API_TOKEN: "env-fallback" });
const ORG = "org1";

/** The one table this module touches; `data` is what a read of it returns. */
const creds = (data: unknown) => createSupabaseRecorder({ tables: { integration_credentials: { data } } });
const written = (rec: ReturnType<typeof creds>) => rec.writtenRows("integration_credentials");

describe("saveSamsaraToken / loadSamsaraToken", () => {
  it("stores a sealed envelope (never the raw token) and reads it back", async () => {
    const writer = creds(null);
    await saveSamsaraToken(writer.client, env, ORG, "samsara_secret_token_12345");
    const stored = written(writer)[0]!.samsara_api_token as string;
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored).not.toContain("samsara_secret_token_12345");
    expectOrgScoped(writer, ORG); // the upsert carries org_id + onConflict("org_id")

    const reader = creds({ samsara_api_token: stored, enabled: true });
    await expect(loadSamsaraToken(reader.client, env, ORG)).resolves.toBe("samsara_secret_token_12345");
    expectOrgScoped(reader, ORG);
  });

  it("still reads a legacy plaintext token as-is", async () => {
    const rec = creds({ samsara_api_token: "legacy-plain", enabled: true });
    await expect(loadSamsaraToken(rec.client, env, ORG)).resolves.toBe("legacy-plain");
    expectOrgScoped(rec, ORG);
  });

  it("falls back to the env token when disabled or when a sealed value cannot be opened", async () => {
    const disabled = creds({ samsara_api_token: "x", enabled: false });
    await expect(loadSamsaraToken(disabled.client, envWithFallback, ORG)).resolves.toBe("env-fallback");

    // Sealed for a DIFFERENT org → AAD mismatch → logged + env fallback, never a crash.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const foreign = seal(env, "tok", secretAad("other-org", SAMSARA_TOKEN_PURPOSE));
    const tampered = creds({ samsara_api_token: foreign, enabled: true });
    await expect(loadSamsaraToken(tampered.client, envWithFallback, ORG)).resolves.toBe("env-fallback");
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();

    // Both reads still asked for THIS org's row — the fallback is about the payload, not the scope.
    expectOrgScoped(disabled, ORG);
    expectOrgScoped(tampered, ORG);
  });

  it("fails CLOSED on save when no sealing key is configured", async () => {
    const rec = creds(null);
    await expect(saveSamsaraToken(rec.client, envNoKey, ORG, "tok-123456789012345678")).rejects.toThrow(
      SecretBoxError,
    );
    expect(rec.writes()).toHaveLength(0); // nothing persisted
  });

  it("clearSamsaraToken nulls the stored token", async () => {
    const rec = creds(null);
    await clearSamsaraToken(rec.client, ORG);
    expect(written(rec)[0]!.samsara_api_token).toBeNull();
    expectOrgScoped(rec, ORG); // a clear that forgot its filter would blank every tenant's token
  });
});

describe("sealPlaintextSamsaraTokens (boot sweep)", () => {
  it("seals plaintext rows in place and leaves sealed rows untouched", async () => {
    const alreadySealed = seal(env, "tok-a", secretAad("orgA", SAMSARA_TOKEN_PURPOSE));
    const rec = createSupabaseRecorder({
      tables: {
        integration_credentials: {
          data: [
            { org_id: "orgA", samsara_api_token: alreadySealed },
            { org_id: "orgB", samsara_api_token: "plain-token-b" },
          ],
        },
      },
    });
    const res = await sealPlaintextSamsaraTokens(rec.client, env);
    expect(res.sealed).toBe(1);
    const writes = rec.writes();
    expect(writes).toHaveLength(1);
    expect((rec.writtenRows("integration_credentials")[0]!.samsara_api_token as string).startsWith("v1.")).toBe(true);
    // No expectOrgScoped here: the sweep is a CROSS-TENANT boot job by design (it reads every org's row
    // to find plaintext). What must hold is that each rewrite targets only the row it read — assert the
    // per-row filter instead, which the old Proxy fake could not see at all.
    expect(writes[0]!.filters()).toEqual([{ col: "org_id", val: "orgB" }]);
  });

  it("only warns (writes nothing) when the sealing key is not configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rec = createSupabaseRecorder({
      tables: { integration_credentials: { data: [{ org_id: "orgB", samsara_api_token: "plain-token-b" }] } },
    });
    const res = await sealPlaintextSamsaraTokens(rec.client, envNoKey);
    expect(res.sealed).toBe(0);
    expect(rec.writes()).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
