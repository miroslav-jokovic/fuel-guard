import { describe, expect, it } from "vitest";
import type { CapturedPage } from "@silvicom/capture-engine";
import { buildCapturePayloads, decideCapture, queuedRegisters } from "@/features/hazmat/hazmatCaptureModel";

/**
 * Multi-page capture (SCANNER-UPGRADE-PLAN.md Step 1.2, F4).
 *
 * ── THE DEFECT THESE PIN ──────────────────────────────────────────────────────────────────────
 * `decideCapture` took `result.pages[0]` and dropped the rest without a word. A driver who scanned a
 * three-page bill of lading uploaded one page, was shown a success screen, and had a hazmat verdict
 * computed from a third of the document — while `scan()` had asked for up to ten pages and Android
 * had faithfully returned them. That is the exact case the plan's "3-page BOL under 1.5 MB"
 * definition of done was written for, and it had never worked.
 */

/**
 * A page from the JS fallback provider: ONE artifact, all four image fields aliasing it. That is the
 * honest shape for a provider that picks a single image and has nothing to derive from it, and it is
 * the default here so every pre-existing assertion keeps testing what it always tested.
 * `nativePage` below is the two-artifact shape.
 */
function pageAt(passed: boolean, reasons: CapturedPage["quality"]["reasons"] = [], uri = "file:///tmp/bol.webp"): CapturedPage {
  const img = { uri, width: 1568, height: 2000, bytes: 300000, mediaType: "image/webp" as const };
  return {
    originalOfRecord: img, perspectiveCorrected: img, enhancedColor: img, enhancedGray: img,
    quality: { passed, checks: [], reasons, score: passed ? 1 : 0, ocrDegraded: false },
    metrics: { longEdgePx: 1568 },
    ocr: { engine: "test", recognizedChars: 0, recognizedWords: 0, textCoverageFraction: 0, medianCharHeightPx: 0, smallTextBandCoverage: 0, numberTokens: [], available: false },
    metadata: { providerId: "p", providerVersion: "0.1.0", configVersion: "capture-2026.08.0" },
    integrityHash: "abc123", provenance: { captureMode: "expo_camera", osEnhanced: false },
  };
}

/**
 * A page from the native provider since Phase 4b: an untouched ORIGINAL and a separate derivative,
 * each with the hash and size of its own bytes. Deliberately different in every field the two share,
 * so a test that read the wrong one fails instead of passing on a coincidence.
 */
function nativePage(uri = "file:///tmp/bol"): CapturedPage {
  const original = { uri: `${uri}.original.jpg`, width: 3024, height: 4032, bytes: 3_100_000, mediaType: "image/jpeg" as const, sha256: "original-hash" };
  const derived = { uri: `${uri}.jpg`, width: 1568, height: 2000, bytes: 300_000, mediaType: "image/jpeg" as const, sha256: "derived-hash" };
  return {
    originalOfRecord: original, perspectiveCorrected: derived, enhancedColor: derived, enhancedGray: derived,
    quality: { passed: true, checks: [], reasons: [], score: 1, ocrDegraded: false },
    // The five values the gate renders `na` and discards — the reason Step 5.1 exists.
    metrics: { longEdgePx: 4032, blurVariance: 812.5, glareFraction: 0.014, shadowRange: 0.31, brightnessMean: 0.62, contrastRms: 0.22 },
    ocr: { engine: "test", recognizedChars: 0, recognizedWords: 0, textCoverageFraction: 0, medianCharHeightPx: 0, smallTextBandCoverage: 0, numberTokens: [], available: false },
    metadata: {
      providerId: "capture.native.system_scanner", providerVersion: "0.1.0",
      configVersion: "capture-2026.08.0", device: "ios",
      analysisLongEdgePx: 1024, captureMs: 4200, processingMs: 180,
    },
    integrityHash: "original-hash", provenance: { captureMode: "system_scanner", osEnhanced: true },
  };
}

describe("decideCapture", () => {
  it("accepts a passing single page", () => {
    const r = decideCapture({ ok: true, pages: [pageAt(true)] });
    expect(r.accepted).toBe(true);
    expect(r.pages).toHaveLength(1);
    expect(r.reasons).toEqual([]);
  });

  it("keeps EVERY page of a multi-page scan instead of the first one", () => {
    // The regression that matters. Before Step 1.2 this returned one page and discarded two.
    const r = decideCapture({ ok: true, pages: [pageAt(true), pageAt(true), pageAt(true)] });
    expect(r.accepted).toBe(true);
    expect(r.pages).toHaveLength(3);
  });

  it("names WHICH page failed when a multi-page scan is refused", () => {
    const r = decideCapture({ ok: true, pages: [pageAt(true), pageAt(false, ["IMAGE_BLURRED"]), pageAt(true)] });
    expect(r.accepted).toBe(false);
    expect(r.pageRejections).toEqual([{ page: 2, reasons: [expect.stringMatching(/blurry/i)] }]);
    expect(r.reasons[0]).toMatch(/^Page 2: /);
  });

  it("refuses the whole set when one page fails, and says so by returning no pages", () => {
    // All-or-nothing is forced by the v1 architecture, not chosen: the OS scanner owns its multi-page
    // session and there is no way back into it for page two alone once scan() has returned. Accepting
    // the good pages would upload a document the driver believes is complete and is not.
    const r = decideCapture({ ok: true, pages: [pageAt(true), pageAt(false, ["GLARE_OVER_TEXT"])] });
    expect(r.accepted).toBe(false);
    expect(r.pages).toEqual([]);
  });

  it("does not prefix a page number when there was only one page", () => {
    const r = decideCapture({ ok: true, pages: [pageAt(false, ["RESOLUTION_TOO_LOW"])] });
    expect(r.reasons[0]).toMatch(/low-resolution/i);
    expect(r.reasons[0]).not.toMatch(/^Page /);
  });

  it("reports every failing page, not just the first", () => {
    const r = decideCapture({
      ok: true,
      pages: [pageAt(false, ["IMAGE_BLURRED"]), pageAt(true), pageAt(false, ["GLARE_OVER_TEXT"])],
    });
    expect(r.pageRejections.map((p) => p.page)).toEqual([1, 3]);
  });

  it("refuses a scan over the page cap rather than letting the server refuse it mid-upload", () => {
    // iOS's VNDocumentCameraViewController has no page-limit API, so the cap cannot bind where it is
    // requested. Letting the surplus through would hit the server's MAX_BOL_PAGES after the driver
    // had already been told the capture worked.
    const pages = Array.from({ length: 11 }, () => pageAt(true));
    const r = decideCapture({ ok: true, pages }, 10);
    expect(r.accepted).toBe(false);
    expect(r.reasons[0]).toMatch(/11 pages and the limit is 10/);
  });

  it("maps a scan-level failure to copy", () => {
    const r = decideCapture({ ok: false, reason: "CAPTURE_CANCELLED" });
    expect(r.accepted).toBe(false);
    expect(r.reasons[0]).toMatch(/cancelled/i);
  });

  it("refuses an empty successful scan rather than accepting nothing", () => {
    const r = decideCapture({ ok: true, pages: [] });
    expect(r.accepted).toBe(false);
    expect(r.reasons[0]).toMatch(/no page/i);
  });
});

describe("decideCapture — cleaning up after a refused scan", () => {
  it("hands back every file a refused scan produced", () => {
    // The scanner writes each page into the OS cache and nothing else will ever delete them:
    // `sweepOrphans` only knows about the staging directory. A driver re-shooting a glaring page five
    // times would otherwise leave five orphans behind forever (F9).
    const r = decideCapture({
      ok: true,
      pages: [pageAt(true, [], "file:///tmp/a.webp"), pageAt(false, ["IMAGE_BLURRED"], "file:///tmp/b.webp")],
    });
    expect(r.accepted).toBe(false);
    expect(r.discardUris).toEqual(["file:///tmp/a.webp", "file:///tmp/b.webp"]);
  });

  it("discards the good pages of a refused set too, since the whole set is refused", () => {
    const r = decideCapture({ ok: true, pages: [pageAt(true, [], "file:///tmp/keep.webp"), pageAt(false, ["GLARE_OVER_TEXT"])] });
    expect(r.discardUris).toContain("file:///tmp/keep.webp");
  });

  it("discards nothing on an accepted scan, because those files are still the only copy", () => {
    // Until the caller has staged them, deleting these would destroy the capture. It discards them
    // itself once the outbox record exists.
    const r = decideCapture({ ok: true, pages: [pageAt(true)] });
    expect(r.accepted).toBe(true);
    expect(r.discardUris).toEqual([]);
  });

  it("discards nothing when the scan never produced a file", () => {
    expect(decideCapture({ ok: false, reason: "CAPTURE_CANCELLED" }).discardUris).toEqual([]);
  });

  it("lists a page's file once even though four fields point at it", () => {
    // On the v1 SystemScanner path all four image fields alias one file. They stop aliasing at
    // Phase 4, when the untouched original is preserved separately — so deduplicating now is what
    // keeps this cleanup correct then, rather than leaking three files out of four.
    const r = decideCapture({ ok: true, pages: [pageAt(false, ["IMAGE_BLURRED"], "file:///tmp/one.webp")] });
    expect(r.discardUris).toEqual(["file:///tmp/one.webp"]);
  });

  it("refuses a scan over the cap without leaking its pages", () => {
    const pages = Array.from({ length: 11 }, (_, i) => pageAt(true, [], `file:///tmp/p${i}.webp`));
    const r = decideCapture({ ok: true, pages }, 10);
    expect(r.accepted).toBe(false);
    expect(r.discardUris).toHaveLength(11);
  });
});

describe("buildCapturePayloads", () => {
  it("shapes one register per page, numbered from 1, with matching local uris", () => {
    const pages = [pageAt(true, [], "file:///tmp/p1.webp"), pageAt(true, [], "file:///tmp/p2.webp"), pageAt(true, [], "file:///tmp/p3.webp")];
    const { payload, uploads } = buildCapturePayloads({ loadId: "L1", documentIds: ["D1", "D2", "D3"], pages });

    expect(payload.create.id).toBe("L1");
    expect(payload.registers).toHaveLength(3);
    expect(payload.registers.map((r) => r.page)).toEqual([1, 2, 3]);
    expect(payload.registers.map((r) => r.id)).toEqual(["D1", "D2", "D3"]);
    // Index alignment between registers and uploads is what the handler relies on to pair a page
    // with its bytes; a mismatch would upload page one's image under page three's storage path.
    expect(uploads.map((u) => u.archiveUri)).toEqual(["file:///tmp/p1.webp", "file:///tmp/p2.webp", "file:///tmp/p3.webp"]);
  });

  it("carries the capture provenance on every page, not only the first", () => {
    const { payload } = buildCapturePayloads({
      loadId: "L1",
      documentIds: ["D1", "D2"],
      pages: [pageAt(true), pageAt(true)],
    });
    for (const register of payload.registers) {
      expect(register.kind).toBe("bol");
      expect(register.contentType).toBe("image/webp");
      expect(register.capture.mode).toBe("expo_camera");
      expect(register.capture.configVersion).toBe("capture-2026.08.0");
    }
  });

  /**
   * ⚠ The assertions this merge exists for (D-SCAN6, audit finding F1).
   *
   * `sha256` and `capture.integrityHash` used to be the SAME value, because a page was one file and
   * the "original of record" was a 1568 px JPEG q80 derivative. They now describe different bytes,
   * and getting them the wrong way round is a failure that hides: the server downloads the object at
   * `storagePath` and verifies it against `sha256` (Step 1.3), so sending the original's hash there
   * fails every extraction with `integrity_mismatch` — and sending the derivative's hash as
   * `integrityHash` records a provenance claim about bytes nobody kept.
   */
  it("registers the ARCHIVE's hash and the ORIGINAL's provenance hash, which are not the same bytes", () => {
    const { payload } = buildCapturePayloads({ loadId: "L1", documentIds: ["D1"], pages: [nativePage()] });
    const register = payload.registers[0]!;
    expect(register.sha256).toBe("derived-hash");
    expect(register.capture.integrityHash).toBe("original-hash");
    expect(register.sha256).not.toBe(register.capture.integrityHash);
  });

  it("uploads the DERIVATIVE for reading, and keeps the original as a second artifact", () => {
    const { payload, uploads } = buildCapturePayloads({ loadId: "L1", documentIds: ["D1"], pages: [nativePage()] });
    expect(uploads[0]!.archiveUri).toBe("file:///tmp/bol.jpg");
    expect(uploads[0]!.originalUri).toBe("file:///tmp/bol.original.jpg");
    // Declared to the server, which signs a second upload URL only for a request that asks for one.
    expect(payload.registers[0]!.capture.original).toEqual({ bytes: 3_100_000 });
    expect(payload.registers[0]!.capture.archiveBytes).toBe(300_000);
    // The content type follows the object being uploaded, not the original — the server records it
    // and extraction decodes by it.
    expect(payload.registers[0]!.contentType).toBe("image/jpeg");
  });

  /**
   * The JS fallback picks one image and has nothing to derive from it, so its four image fields all
   * alias that file. Declaring an original there would ask the server to sign a second upload URL for
   * the SAME bytes, and the driver would pay for the page twice.
   *
   * That it is derived from the URIs rather than from a provider flag is the point: a flag would be a
   * second statement of something the page already says, and the day the two disagreed the wrong one
   * would win silently.
   */
  it("declares no original when the provider produced a single artifact", () => {
    const { payload, uploads } = buildCapturePayloads({ loadId: "L1", documentIds: ["D1"], pages: [pageAt(true)] });
    expect(uploads[0]!.originalUri).toBeUndefined();
    expect(payload.registers[0]!.capture.original).toBeUndefined();
    // And the page-level hash is still the right answer for the one file that exists.
    expect(payload.registers[0]!.sha256).toBe("abc123");
  });

  it("keeps both artifacts of every page when a native scan is refused, so neither leaks", () => {
    // `fileUrisOf` deduplicates, so a single-artifact page yields one URI and a two-artifact page two.
    // Before Phase 4b every page yielded exactly one and the difference could not be observed.
    const r = decideCapture({ ok: true, pages: [{ ...nativePage("file:///tmp/x"), quality: { passed: false, checks: [], reasons: ["IMAGE_BLURRED"], score: 0, ocrDegraded: false } }] });
    expect(r.accepted).toBe(false);
    expect(r.discardUris).toEqual(["file:///tmp/x.original.jpg", "file:///tmp/x.jpg"]);
  });

  it("carries the measured values the gate threw away, and the scale they were taken at", () => {
    // Step 5.1. The five below are `na` in `quality` — every image floor is `null` under D-SCAN10 —
    // so if the register does not carry them here, nothing anywhere records them and Step 5.2 has an
    // empty distribution to derive thresholds from.
    const { payload } = buildCapturePayloads({ loadId: "L1", documentIds: ["D1"], pages: [nativePage()], attempt: 2 });
    const metrics = payload.registers[0]!.capture.metrics!;
    expect(metrics.metrics.blurVariance).toBe(812.5);
    expect(metrics.metrics.glareFraction).toBe(0.014);
    expect(metrics.analysisLongEdgePx).toBe(1024);
    expect(metrics.timings).toEqual({ captureMs: 4200, processingMs: 180 });
    expect(metrics.attempt).toBe(2);
  });

  it("records no attempt at all when the caller does not count them", () => {
    // A defaulted 1 would make the re-shoot rate — trigger (a) of the Phase 7 decision — read as zero
    // for ever, which is worse than an absent field because it looks like an answer.
    const { payload } = buildCapturePayloads({ loadId: "L1", documentIds: ["D1"], pages: [nativePage()] });
    expect(payload.registers[0]!.capture.metrics!.attempt).toBeUndefined();
  });

  it("refuses to build when ids and pages disagree in number", () => {
    // Silently zipping the shorter of the two would register page three under page two's id, or drop
    // it — and both failures would only be visible on the server, days later, as a missing page.
    expect(() =>
      buildCapturePayloads({ loadId: "L1", documentIds: ["D1"], pages: [pageAt(true), pageAt(true)] }),
    ).toThrow(/2 page\(s\) but 1 document id\(s\)/);
  });
});

describe("queuedRegisters", () => {
  const register = { id: "D1", kind: "bol" as const, page: 1, sha256: "h", contentType: "image/webp", capture: {} as never };

  it("reads the multi-page shape this build writes", () => {
    const registers = [register, { ...register, id: "D2", page: 2 }];
    expect(queuedRegisters({ registers })).toEqual(registers);
  });

  it("still drains a record queued by a build that predates multi-page", () => {
    // The outbox survives an app update. A driver who scanned offline on Friday and updated over the
    // weekend has a Friday-shaped record holding work that exists nowhere else; refusing it would be
    // the one failure the offline queue is built to prevent.
    expect(queuedRegisters({ register })).toEqual([register]);
  });

  it("prefers the new shape when a record somehow carries both", () => {
    expect(queuedRegisters({ registers: [register], register: { ...register, id: "STALE" } })).toEqual([register]);
  });

  it("returns nothing for a record carrying neither, so the caller can call it malformed", () => {
    expect(queuedRegisters({})).toEqual([]);
    expect(queuedRegisters({ registers: [] })).toEqual([]);
  });
});
