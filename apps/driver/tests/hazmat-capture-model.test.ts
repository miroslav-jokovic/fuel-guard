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

function pageAt(passed: boolean, reasons: CapturedPage["quality"]["reasons"] = [], uri = "file:///tmp/bol.webp"): CapturedPage {
  const img = { uri, width: 1568, height: 2000, bytes: 300000, mediaType: "image/webp" as const };
  return {
    originalOfRecord: img, perspectiveCorrected: img, enhancedColor: img, enhancedGray: img,
    quality: { passed, checks: [], reasons, score: passed ? 1 : 0, ocrDegraded: false },
    ocr: { engine: "test", recognizedChars: 0, recognizedWords: 0, textCoverageFraction: 0, medianCharHeightPx: 0, smallTextBandCoverage: 0, numberTokens: [], available: false },
    metadata: { providerId: "p", providerVersion: "0.1.0", configVersion: "capture-2026.08.0" },
    integrityHash: "abc123", provenance: { captureMode: "expo_camera", osEnhanced: false },
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

describe("buildCapturePayloads", () => {
  it("shapes one register per page, numbered from 1, with matching local uris", () => {
    const pages = [pageAt(true, [], "file:///tmp/p1.webp"), pageAt(true, [], "file:///tmp/p2.webp"), pageAt(true, [], "file:///tmp/p3.webp")];
    const { payload, localUris } = buildCapturePayloads({ loadId: "L1", documentIds: ["D1", "D2", "D3"], pages });

    expect(payload.create.id).toBe("L1");
    expect(payload.registers).toHaveLength(3);
    expect(payload.registers.map((r) => r.page)).toEqual([1, 2, 3]);
    expect(payload.registers.map((r) => r.id)).toEqual(["D1", "D2", "D3"]);
    // Index alignment between registers and fileUris is what the handler relies on to pair a page
    // with its bytes; a mismatch would upload page one's image under page three's storage path.
    expect(localUris).toEqual(["file:///tmp/p1.webp", "file:///tmp/p2.webp", "file:///tmp/p3.webp"]);
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
