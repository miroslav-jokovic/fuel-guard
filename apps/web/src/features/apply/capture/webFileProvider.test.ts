import { describe, it, expect, vi, beforeEach } from "vitest";
import { BUNDLED_DEFAULT_CONFIG, type CaptureConfig } from "@silvicom/capture-engine";
import { createWebFileProvider, processPhoto } from "./webFileProvider";
import type { DecodedImage, EncodedImage, WebImageIo } from "./webImageIo";

/**
 * The web capture provider (A7).
 *
 * The property this file exists for is one sentence: **a photograph that fails the gate never reaches
 * the network.** A driver photographing a licence in a truck-stop car park is on a connection they
 * are paying for and waiting on, and uploading a picture that will be rejected costs them twice.
 * Everything else here — the downscale, the format fallback, the EXIF story — is in service of that.
 */

const CONFIG: CaptureConfig = BUNDLED_DEFAULT_CONFIG;

/** A stand-in for the browser's canvas pipeline; the decision under test needs no pixels. */
function fakeIo(over: Partial<WebImageIo> & { width?: number; height?: number } = {}): WebImageIo & {
  encoded: Array<{ target: number; format: string }>;
} {
  const encoded: Array<{ target: number; format: string }> = [];
  const closed = { count: 0 };
  const io = {
    encoded,
    closed,
    async decode(): Promise<DecodedImage> {
      return {
        width: over.width ?? 2400,
        height: over.height ?? 1600,
        source: {} as CanvasImageSource,
        close: () => { closed.count += 1; },
      };
    },
    async encode(image: DecodedImage, target: number, format: "webp" | "jpeg"): Promise<EncodedImage> {
      encoded.push({ target, format });
      const scale = Math.min(1, target / Math.max(image.width, image.height));
      return {
        blob: new Blob(["x".repeat(64)], { type: `image/${format}` }),
        width: Math.round(image.width * scale),
        height: Math.round(image.height * scale),
        mediaType: format === "webp" ? "image/webp" : "image/jpeg",
      };
    },
    async sha256(): Promise<string> {
      return "a".repeat(64);
    },
    ...over,
  };
  return io as WebImageIo & { encoded: Array<{ target: number; format: string }> };
}

const photo = () => new File([new Uint8Array([1, 2, 3])], "cdl.jpg", { type: "image/jpeg" });

// jsdom has no object-URL implementation; the provider only ever creates and revokes them.
beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:capture"),
    revokeObjectURL: vi.fn(),
  }));
});

describe("what the gate can see", () => {
  it("measures the ORIGINAL long edge, not the downscaled copy", async () => {
    // 2400px original, downscaled to the config's 1568px model-facing profile. Gating the copy would
    // be circular — everything is resized to the same long edge, so everything would pass.
    const io = fakeIo({ width: 2400, height: 1600 });
    const page = await processPhoto(photo(), CONFIG, io);

    const resolution = page.quality.checks.find((c) => c.name === "resolution");
    expect(resolution?.status).toBe("pass");
    expect(resolution?.detail?.longEdgePx).toBe(2400);
    expect(page.originalOfRecord.width).toBe(1568);
  });

  /** §5's rule: an unmeasured check is `na`, never a silent pass. The server gate is the backstop. */
  it("reports everything it cannot measure as na rather than as passing", async () => {
    const page = await processPhoto(photo(), CONFIG, fakeIo());
    const byName = Object.fromEntries(page.quality.checks.map((c) => [c.name, c.status]));
    expect(byName.resolution).toBe("pass");
    for (const unmeasurable of ["blur", "glare", "coverage", "contrast", "brightness", "shadow"]) {
      expect({ check: unmeasurable, status: byName[unmeasurable] }).toEqual({ check: unmeasurable, status: "na" });
    }
    // And the degraded-legibility flag is raised rather than the check being quietly skipped.
    expect(page.quality.ocrDegraded).toBe(true);
  });

  it("stamps the config version and the platform on the capture", async () => {
    const page = await processPhoto(photo(), CONFIG, fakeIo());
    expect(page.metadata.configVersion).toBe(CONFIG.configVersion);
    expect(page.metadata.device).toBe("web");
    expect(page.integrityHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("a photograph that fails the gate", () => {
  /** THE test. A rejected capture produces no page, so there is nothing for the caller to upload. */
  it("never becomes a page, so nothing can be uploaded", async () => {
    // Below the 1200px floor the server also enforces.
    const io = fakeIo({ width: 900, height: 600 });
    const provider = createWebFileProvider(CONFIG, { io, pick: async () => photo() });

    const result = await provider.scan();
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("RESOLUTION_TOO_LOW");
    // No pages at all — the caller has nothing to send even if it wanted to.
    expect("pages" in result).toBe(false);
  });

  it("releases the rejected photo rather than leaving four re-shoots in a phone's memory", async () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:capture", revokeObjectURL: revoke }));
    const provider = createWebFileProvider(CONFIG, {
      io: fakeIo({ width: 900, height: 600 }),
      pick: async () => photo(),
    });

    await provider.scan();
    expect(revoke).toHaveBeenCalledWith("blob:capture");
  });

  it("accepts one that clears the floor", async () => {
    const provider = createWebFileProvider(CONFIG, {
      io: fakeIo({ width: 2400, height: 1600 }),
      pick: async () => photo(),
    });
    const result = await provider.scan();
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.pages).toHaveLength(1);
  });
});

describe("the picker", () => {
  it("reports a dismissed camera as cancelled, not as an error", async () => {
    const provider = createWebFileProvider(CONFIG, { io: fakeIo(), pick: async () => null });
    const result = await provider.scan();
    expect(result.ok === false && result.reason).toBe("CAPTURE_CANCELLED");
  });

  it("turns a browser that cannot process the photo into a named refusal, not a crash", async () => {
    const io = fakeIo();
    io.decode = async () => {
      throw new Error("This browser cannot process the photo.");
    };
    const provider = createWebFileProvider(CONFIG, { io, pick: async () => photo() });
    const result = await provider.scan();
    expect(result.ok === false && result.reason).toBe("PROVIDER_ERROR");
    expect(result.ok === false && result.message).toContain("cannot process");
  });
});

describe("the encoded image", () => {
  it("asks for the configured profile — WebP at the model-facing long edge", async () => {
    const io = fakeIo();
    await processPhoto(photo(), CONFIG, io);
    expect(io.encoded).toEqual([{ target: CONFIG.enhance.modelFacing.longEdgePx, format: "webp" }]);
  });

  /**
   * The EXIF story, asserted where it can be: the provider hands the encoder a decoded bitmap and
   * publishes whatever comes back, so the original file's bytes — GPS included — never travel. The
   * stripping is a property of decode-then-re-encode rather than a step somebody must remember, which
   * is why there is no `stripExif` call to assert on.
   */
  it("publishes the re-encoded blob and never the original file", async () => {
    const original = photo();
    const page = await processPhoto(original, CONFIG, fakeIo());
    expect(page.originalOfRecord.uri).toBe("blob:capture");
    expect(page.originalOfRecord.mediaType).toBe("image/webp");
    expect(page.originalOfRecord.bytes).toBe(64);
  });
});
