import { describe, it, expect } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { addRepresentative, deleteRepresentative, isRepresentativeError, listRepresentatives } from "./representatives.js";

/**
 * The people who sign for the carrier (D-HB3): added with a signature, deleted until they have signed.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
// The eight PNG magic bytes and a byte after them — the smallest thing `pngBytes` accepts.
const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString("base64")}`;
const NOT_PNG = `data:image/png;base64,${Buffer.from("GIF89a-not-a-png").toString("base64")}`;

describe("adding a representative", () => {
  it("stores the signature in the org's own folder and returns the row without the path", async () => {
    const rec = createSupabaseRecorder({
      tables: { carrier_representatives: [{ id: "r-1", full_name: "Miroslav Jokovic", title: "Safety manager", created_at: "t" }] },
      storage: { upload: async () => ({ data: {}, error: null }) },
    });
    const result = await addRepresentative(rec.client, ORG, "u-1", { full_name: "  Miroslav Jokovic ", title: "Safety manager", signature_png: PNG });
    expect(isRepresentativeError(result)).toBe(false);
    const upload = rec.storageCalls().find((c) => c.fn === "upload")!;
    expect(String(upload.args[0])).toMatch(new RegExp(`^${ORG}/representatives/[0-9a-f-]+\\.png$`));
    const row = rec.writtenRows("carrier_representatives")[0]!;
    expect(row.full_name).toBe("Miroslav Jokovic");
    expect(row.created_by).toBe("u-1");
    expect(row.signature_path).toBe(upload.args[0]);
    expectOrgScoped(rec, ORG);
  });

  it("refuses bytes that only claim to be a PNG, and stores nothing", async () => {
    const rec = createSupabaseRecorder({ tables: { carrier_representatives: [] } });
    const result = await addRepresentative(rec.client, ORG, "u-1", { full_name: "A Person", title: "Owner", signature_png: NOT_PNG });
    expect(isRepresentativeError(result) && result.code).toBe("invalid_request");
    expect(rec.storageCalls()).toHaveLength(0);
  });
});

describe("deleting a representative", () => {
  it("deletes one who has signed nothing, and their picture with them", async () => {
    const rec = createSupabaseRecorder({
      tables: { carrier_representatives: [{ id: "r-1", signature_path: `${ORG}/representatives/r-1.png` }] },
      storage: { remove: async () => ({ data: [], error: null }) },
    });
    const result = await deleteRepresentative(rec.client, ORG, "r-1");
    expect(result).toEqual({ id: "r-1" });
    expect(rec.storageCalls().find((c) => c.fn === "remove")?.args[0]).toEqual([`${ORG}/representatives/r-1.png`]);
    expectOrgScoped(rec, ORG);
  });

  it("keeps one who countersigned a handbook: Postgres' 23001 becomes a sentence, not a 500", async () => {
    const rec = createSupabaseRecorder({
      tables: { carrier_representatives: { writeError: { code: "23001", message: "restrict" } } },
    });
    const result = await deleteRepresentative(rec.client, ORG, "r-1");
    expect(isRepresentativeError(result) && result.code).toBe("has_signed");
    expect(isRepresentativeError(result) && result.message).toMatch(/signed a driver handbook/);
    expect(rec.storageCalls()).toHaveLength(0);
  });

  it("says not found for somebody who is not on this carrier's list", async () => {
    const rec = createSupabaseRecorder({ tables: { carrier_representatives: [] } });
    const result = await deleteRepresentative(rec.client, ORG, "r-9");
    expect(isRepresentativeError(result) && result.code).toBe("not_found");
  });
});

describe("listing representatives", () => {
  it("reads this carrier's only", async () => {
    const rec = createSupabaseRecorder({ tables: { carrier_representatives: [] } });
    await listRepresentatives(rec.client, ORG);
    expectOrgScoped(rec, ORG);
  });
});
