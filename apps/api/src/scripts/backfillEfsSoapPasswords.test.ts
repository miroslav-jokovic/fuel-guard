import { describe, expect, it } from "vitest";
import { loadEnv } from "../env.js";
import { sealingKeyId } from "../lib/secretBox.js";
import { createSupabaseRecorder } from "../testing/supabaseRecorder.js";
import { compareSealedKeyIds, runBackfill } from "./backfillEfsSoapPasswords.js";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ORG_A = "07fe4058-cc72-4a69-b3e9-29b4cf1c6a44";
const ORG_B = "86d6b3ea-4361-4f71-877f-e8373615769b";
const env = loadEnv({ NODE_ENV: "test", SECRETS_ENCRYPTION_KEY: KEY } as NodeJS.ProcessEnv);
const envelope = (keyId: string): string => `v1.${keyId}.iv.tag.ciphertext`;
const pending = (orgId: string) => ({ org_id: orgId, soap_password: `password-${orgId}`, soap_password_sealed: null });

describe("compareSealedKeyIds", () => {
  it("accepts when every stored envelope carries the current key id", () => {
    expect(compareSealedKeyIds("current1", [envelope("current1"), envelope("current1")])).toEqual({
      currentKeyId: "current1",
      keyIds: [{ keyId: "current1", count: 2 }],
      sealedCount: 2,
      hasAnchor: true,
      ok: true,
    });
  });

  it("refuses when any stored envelope carries a different key id", () => {
    const verdict = compareSealedKeyIds("current1", [envelope("current1"), envelope("previous1")]);
    expect(verdict.ok).toBe(false);
    expect(verdict.keyIds).toEqual([
      { keyId: "current1", count: 1 },
      { keyId: "previous1", count: 1 },
    ]);
  });

  it("reports no anchor when nothing sealed exists", () => {
    expect(compareSealedKeyIds("current1", [null, undefined, ""])).toEqual({
      currentKeyId: "current1",
      keyIds: [],
      sealedCount: 0,
      hasAnchor: false,
      ok: true,
    });
  });
});

describe("runBackfill", () => {
  it("issues no update when the stored sealing key id differs", async () => {
    const db = createSupabaseRecorder({
      tables: {
        efs_cards: [{ card_number_sealed: envelope("foreign1") }],
        efs_soap_client_certs: [],
        efs_soap_credentials: [pending(ORG_A)],
      },
    });

    await expect(runBackfill(db.client, env, true)).resolves.toBe(false);
    expect(db.queries.every((q) => q.write === null)).toBe(true);
  });

  it("seals each pending row when the key ids match", async () => {
    const db = createSupabaseRecorder({
      tables: {
        efs_cards: [{ card_number_sealed: envelope(sealingKeyId(env)) }],
        efs_soap_client_certs: [],
        efs_soap_credentials: [pending(ORG_A), pending(ORG_B)],
      },
    });

    await expect(runBackfill(db.client, env, true)).resolves.toBe(true);
    const writes = db.writtenRows("efs_soap_credentials");
    expect(writes).toHaveLength(2);
    for (const write of writes) {
      expect(write.soap_password).toBe("");
      expect(write.soap_password_sealed).toEqual(expect.any(String));
    }
  });

  it("refuses to apply when no sealed material exists to compare against", async () => {
    const db = createSupabaseRecorder({
      tables: {
        efs_cards: [],
        efs_soap_client_certs: [],
        efs_soap_credentials: [pending(ORG_A)],
      },
    });

    await expect(runBackfill(db.client, env, true)).resolves.toBe(false);
    expect(db.queries.every((q) => q.write === null)).toBe(true);
  });
});
