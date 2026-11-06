import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { crc32 } from "./imageComplete.js";
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

/** A PNG chunk: length, type, data, CRC (PNG spec §5.3). */
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A 200×200 RGB PNG built from constants: the brand green with a stripe every 10 rows, deflated at level 9. */
const CONSTANT_PNG = (() => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(200, 0); ihdr.writeUInt32BE(200, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Array.from({ length: 200 }, (_, y) => Buffer.concat([Buffer.from([0]), Buffer.alloc(600, y % 10 === 0 ? 0xff : 0x3d)]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
})();
const IDAT_AT = 8 + 25;
const IDAT_LEN = CONSTANT_PNG.readUInt32BE(IDAT_AT);
/** Ten bytes into the IDAT's data: inside the picture, past every header. */
const CUT_PNG_OFFSET = IDAT_AT + 8 + 10;

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
    // Cut at a FIXED offset inside the IDAT chunk of a PNG built from constants (no sharp, no randomness).
    expect(CUT_PNG_OFFSET).toBeGreaterThan(IDAT_AT + 8);
    expect(CUT_PNG_OFFSET).toBeLessThan(IDAT_AT + 8 + IDAT_LEN);
    expect(await prepareAsset(CONSTANT_PNG)).toMatchObject({ kind: "ready", ref: { width: 200, height: 200 } });
    expect(await prepareAsset(CONSTANT_PNG.subarray(0, CUT_PNG_OFFSET))).toEqual({ kind: "refused", code: "unreadable", reason: "The file starts like a PNG but cannot be read as one: it is cut short." });
  });

  it("refuses a cut-short PNG even while other decodes are failing beside it (the libvips race, 2026-11-06)", async () => {
    // Measured: with other failing decodes in the same process, libvips accepted this cut file 8–15 times in 40.
    const cut = CONSTANT_PNG.subarray(0, CUT_PNG_OFFSET);
    const noise = Array.from({ length: 15 }, (_, i) => Buffer.from(`not an image ${i}`));
    const verdicts: unknown[] = [];
    for (let round = 0; round < 40; round++) {
      const [mine] = await Promise.all([prepareAsset(Buffer.from(cut)), ...noise.map((n) => sharp(n, { failOn: "error" }).stats().catch(() => null))]);
      verdicts.push(mine);
    }
    expect(new Set(verdicts.map((v) => JSON.stringify(v)))).toEqual(new Set([JSON.stringify({ kind: "refused", code: "unreadable", reason: "The file starts like a PNG but cannot be read as one: it is cut short." })]));
  });

  it("refuses a PNG whose chunks are whole but whose picture data stops early, and a cut JPEG and WebP", async () => {
    // Re-wrap half of the deflate stream as a complete IDAT with a correct CRC: the chunk walk passes, inflate does not.
    const head = CONSTANT_PNG.subarray(0, IDAT_AT);
    const half = CONSTANT_PNG.subarray(IDAT_AT + 8, IDAT_AT + 8 + Math.floor(IDAT_LEN / 2));
    const short = Buffer.concat([head, chunk("IDAT", half), chunk("IEND", Buffer.alloc(0))]);
    expect(await prepareAsset(short)).toEqual({ kind: "refused", code: "unreadable", reason: "The file starts like a PNG but cannot be read as one: its picture data ends early." });
    // A whole, valid zlib stream holding only 100 of the 200 rows the header promises: only the size check sees it.
    const rows100 = Buffer.concat(Array.from({ length: 100 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(600, 0x3d)])));
    const fewer = Buffer.concat([head, chunk("IDAT", deflateSync(rows100)), chunk("IEND", Buffer.alloc(0))]);
    expect(await prepareAsset(fewer)).toEqual({ kind: "refused", code: "unreadable", reason: "The file starts like a PNG but cannot be read as one: its picture data ends early." });
    // One flipped byte inside the picture data, the length untouched: the chunk's CRC names it.
    const flipped = Buffer.from(CONSTANT_PNG); flipped[IDAT_AT + 8 + 20]! ^= 0x01;
    expect(await prepareAsset(flipped)).toEqual({ kind: "refused", code: "unreadable", reason: "The file starts like a PNG but cannot be read as one: its IDAT chunk is damaged." });
    const jpg = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#123456" } }).jpeg().toBuffer();
    expect(await prepareAsset(jpg.subarray(0, jpg.length - 40))).toMatchObject({ kind: "refused", code: "unreadable", reason: expect.stringMatching(/JPEG.*it is cut short\.$/) });
    const webp = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#123456" } }).webp().toBuffer();
    expect(await prepareAsset(webp.subarray(0, webp.length - 10))).toMatchObject({ kind: "refused", code: "unreadable", reason: expect.stringMatching(/WebP.*it is cut short\.$/) });
    expect((await prepareAsset(jpg)).kind).toBe("ready");
    expect((await prepareAsset(webp)).kind).toBe("ready");
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
