import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { AD_ASSETS_BUCKET, acceptAsset, assetKey, mismatchedAssets, prepareAsset, svgHazard } from "./brandAssets.js";

/**
 * C1's uploads (workflow C1 done-when: "a `.png` that is really a PDF is refused"). The bytes are real —
 * sharp encodes the fixtures and decodes the uploads — and Storage is an in-memory bucket that answers
 * as Supabase Storage does (a second upload to an existing key is a 409, not a silent overwrite).
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const UPLOAD = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
const incoming = `${ORG}/incoming/${UPLOAD}`;

const png = (width = 40, height = 20) =>
  sharp({ create: { width, height, channels: 3, background: { r: 11, g: 61, b: 46 } } }).png().toBuffer();
const PDF = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
const SVG = (inner = '<rect width="100" height="50" fill="#0B3D2E"/>') =>
  Buffer.from(`<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50">${inner}</svg>`);

let objects: Map<string, Buffer>;
let db: SupabaseRecorder;

beforeEach(() => {
  objects = new Map();
  db = createSupabaseRecorder({
    storage: {
      download: (key: string) => objects.has(key)
        ? { data: new Blob([new Uint8Array(objects.get(key)!)]), error: null }
        : { data: null, error: { message: "Object not found" } },
      upload: (key: string, bytes: Buffer) => {
        if (objects.has(key)) return { data: null, error: { statusCode: "409", message: "The resource already exists" } };
        objects.set(key, Buffer.from(bytes));
        return { data: { path: key }, error: null };
      },
      remove: (keys: string[]) => {
        for (const k of keys) objects.delete(k);
        return { data: [], error: null };
      },
    },
  });
});

const uploads = () => db.storageCalls().filter((c) => c.fn === "upload");

describe("an upload is what its bytes are", () => {
  it("refuses a .png that is really a PDF, stores nothing and keeps nothing", async () => {
    objects.set(incoming, PDF);
    const out = await acceptAsset(db.client, ORG, UPLOAD);
    expect(out).toMatchObject({ kind: "refused", code: "unsupported_format" });
    expect(out.kind === "refused" && out.reason).toMatch(/This file is a PDF/);
    expect(uploads()).toEqual([]);
    expect(objects.has(incoming)).toBe(false);
  });

  it("stores a PNG under its own hash, in the private ad-assets bucket, and reads its size from the pixels", async () => {
    const bytes = await png(40, 20);
    objects.set(incoming, bytes);
    const out = await acceptAsset(db.client, ORG, UPLOAD);
    const sha = createHash("sha256").update(bytes).digest("hex");
    expect(out).toEqual({ kind: "stored", asset: { sha256: sha, format: "png", source_format: "png", width: 40, height: 20, byte_size: bytes.length } });
    expect(objects.get(`${ORG}/${sha}.png`)?.equals(bytes)).toBe(true);
    expect(db.storageCalls().every((c) => c.bucket === AD_ASSETS_BUCKET)).toBe(true);
    expect(objects.has(incoming)).toBe(false);
  });

  it("answers the same ref for the same file uploaded twice, without replacing the stored object", async () => {
    const bytes = await png();
    objects.set(incoming, bytes);
    const first = await acceptAsset(db.client, ORG, UPLOAD);
    objects.set(incoming, bytes);
    const second = await acceptAsset(db.client, ORG, UPLOAD);
    expect(second).toEqual(first);
    expect(uploads().every((c) => (c.args[2] as { upsert?: boolean }).upsert === false)).toBe(true);
  });

  it("refuses a file that starts like a PNG but is cut short", async () => {
    const bytes = await png(200, 200);
    expect(await prepareAsset(bytes.subarray(0, Math.floor(bytes.length / 2)))).toMatchObject({ kind: "refused", code: "unreadable" });
  });

  it("refuses formats the kit does not take, naming what the file is", async () => {
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).gif().toBuffer();
    expect(await prepareAsset(gif)).toMatchObject({ kind: "refused", code: "unsupported_format", reason: expect.stringMatching(/This file is a GIF/) });
    expect(await prepareAsset(Buffer.from("just some text"))).toMatchObject({ kind: "refused", code: "unsupported_format" });
  });

  it("answers not_found when nothing was uploaded under the id", async () => {
    expect(await acceptAsset(db.client, ORG, UPLOAD)).toEqual({ kind: "not_found" });
  });
});

describe("an SVG is rasterised and may not reach outside itself", () => {
  it("rasterises a plain SVG to a PNG with a 2048 px long edge, and stores only the PNG", async () => {
    objects.set(incoming, SVG());
    const out = await acceptAsset(db.client, ORG, UPLOAD);
    expect(out).toMatchObject({ kind: "stored", asset: { format: "png", source_format: "svg", width: 2048, height: 1024 } });
    const [key] = [...objects.keys()];
    expect(key).toMatch(new RegExp(`^${ORG}/[0-9a-f]{64}\\.png$`));
    expect((await sharp(objects.get(key!)!).metadata()).format).toBe("png");
  });

  it.each([
    ["a file: href", '<image href="file:///etc/passwd" width="10" height="10"/>', /links to another file/],
    ["an http xlink:href", '<image xlink:href="https://evil.example/x.png"/>', /links to another file/],
    ["a url() to another file", '<rect style="fill:url(other.svg#g)"/>', /links to another file/],
    ["script", "<script>alert(1)</script>", /contains script/],
    ["foreignObject", "<foreignObject><p>hi</p></foreignObject>", /embeds HTML/],
    ["an @import", "<style>@import url(#x);</style>", /imports another file/],
  ])("refuses an SVG with %s", async (_label, inner, why) => {
    const out = await prepareAsset(SVG(inner));
    expect(out).toMatchObject({ kind: "refused", code: "unsafe_svg" });
    expect(out.kind === "refused" && out.reason).toMatch(why);
  });

  it("refuses an SVG that declares entities, and accepts one that refers only to itself", () => {
    expect(svgHazard('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>')).toMatch(/entities/);
    expect(svgHazard('<svg><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use href="#g"/></svg>')).toBeNull();
  });
});

describe("a kit's asset refs are read again from storage", () => {
  it("names a ref whose bytes are missing or whose description is not the stored file's", async () => {
    const bytes = await png(40, 20);
    objects.set(incoming, bytes);
    const out = await acceptAsset(db.client, ORG, UPLOAD);
    if (out.kind !== "stored") throw new Error("setup");
    const good = out.asset;
    const forged = { ...good, width: 4000 };
    const absent = { ...good, sha256: "f".repeat(64) };
    expect(await mismatchedAssets(db.client, ORG, [good])).toEqual([]);
    expect(await mismatchedAssets(db.client, ORG, [forged])).toEqual([good.sha256]);
    expect(await mismatchedAssets(db.client, ORG, [absent])).toEqual(["f".repeat(64)]);
    // Another org's object under the same hash is not this org's.
    expect(await mismatchedAssets(db.client, "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", [good])).toEqual([good.sha256]);
    expect(assetKey(ORG, good)).toBe(`${ORG}/${good.sha256}.png`);
  });
});
