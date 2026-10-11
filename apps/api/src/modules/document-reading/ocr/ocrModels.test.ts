import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { modelFile, OCR_MODEL_FILES, type ModelFile } from "./ocrModels.js";

/** The OCR model loader (§7B A5): a file is run only if it is the pinned one. */
const BYTES = Buffer.from("pretend model");
const FILE: ModelFile = { name: "m.ort", url: "https://example.test/m.ort", sha256: createHash("sha256").update(BYTES).digest("hex"), bytes: BYTES.length };
const fetchOf = (body: Buffer, status = 200) => vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const dir = () => mkdtemp(join(tmpdir(), "ocr-models-"));

describe("modelFile", () => {
  it("downloads the pinned file once, then serves it from the cache without fetching", async () => {
    const d = await dir();
    const f = fetchOf(BYTES);
    expect(await modelFile(FILE, d, f)).toEqual(BYTES);
    expect(await modelFile(FILE, d, f)).toEqual(BYTES);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("refuses a download whose sha256 is not the pinned one, and caches nothing", async () => {
    const d = await dir();
    await expect(modelFile(FILE, d, fetchOf(Buffer.from("substituted")))).rejects.toThrow(/sha256/);
    await expect(readFile(join(d, FILE.sha256.slice(0, 16), FILE.name))).rejects.toThrow();
  });

  it("downloads again over a cached file whose hash is wrong", async () => {
    const d = await dir();
    await mkdir(join(d, FILE.sha256.slice(0, 16)), { recursive: true });
    await writeFile(join(d, FILE.sha256.slice(0, 16), FILE.name), "truncated");
    const f = fetchOf(BYTES);
    expect(await modelFile(FILE, d, f)).toEqual(BYTES);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("fails on an HTTP error", async () => {
    await expect(modelFile(FILE, await dir(), fetchOf(Buffer.from(""), 404))).rejects.toThrow(/HTTP 404/);
  });

  it("pins every model URL to one repository revision, never a branch", () => {
    for (const m of Object.values(OCR_MODEL_FILES)) expect(m.url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
  });
});
