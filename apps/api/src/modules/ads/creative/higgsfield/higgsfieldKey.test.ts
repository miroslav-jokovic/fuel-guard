import { describe, expect, it } from "vitest";
import { loadEnv } from "../../../../env.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { higgsfieldKeyFor, sealHiggsfieldKey } from "./higgsfieldKey.js";

/** The Higgsfield key at rest (C3): sealed like the Meta token, bound to its org and purpose. */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") } as NodeJS.ProcessEnv);
const withRow = (row: Record<string, unknown> | null) => createSupabaseRecorder({ tables: { ads_platform_connections: row ? [row] : [] } });

describe("the Higgsfield key is sealed, and opens only for its own org", () => {
  it("seals to an envelope that holds neither half in plaintext, and opens back to both halves", async () => {
    const sealed = sealHiggsfieldKey(env, ORG, { id: "kid-123", secret: "s3cr3t-value" });
    expect(sealed).toMatch(/^v1\.[0-9a-f]{8}\./);
    expect(sealed).not.toContain("kid-123");
    expect(sealed).not.toContain("s3cr3t-value");
    const db = withRow({ org_id: ORG, provider: "higgsfield", is_sandbox: false, token_sealed: sealed, status: "connected" });
    expect(await higgsfieldKeyFor(db.client, env, ORG)).toEqual({ ok: true, key: { id: "kid-123", secret: "s3cr3t-value" } });
    expectOrgScoped(db, ORG);
  });

  it("a key sealed for another org cannot be opened here", async () => {
    const sealed = sealHiggsfieldKey(env, OTHER, { id: "kid", secret: "sec" });
    const db = withRow({ org_id: ORG, provider: "higgsfield", is_sandbox: false, token_sealed: sealed, status: "connected" });
    expect(await higgsfieldKeyFor(db.client, env, ORG)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("no row, or a disconnected one, is not_connected", async () => {
    expect(await higgsfieldKeyFor(withRow(null).client, env, ORG)).toEqual({ ok: false, reason: "not_connected" });
    const sealed = sealHiggsfieldKey(env, ORG, { id: "kid", secret: "sec" });
    expect(await higgsfieldKeyFor(withRow({ org_id: ORG, token_sealed: sealed, status: "disconnected" }).client, env, ORG)).toEqual({ ok: false, reason: "not_connected" });
  });
});
