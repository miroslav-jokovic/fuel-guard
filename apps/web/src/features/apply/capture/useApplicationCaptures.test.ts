import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import type { CaptureProvider, CapturedPage, ScanResult } from "@fuelguard/capture-engine";
import type { ApplicationCaptureView } from "@fuelguard/shared";
import type { CaptureIo } from "./stageCapture";
import { useApplicationCaptures } from "./useApplicationCaptures";

/**
 * The capture screen's state machine (A8).
 *
 * The property this file exists for is A7's, one layer up: **a photograph the gate refused never
 * reaches the network.** A7 proved the provider returns no page for a rejected capture; this proves
 * the screen above it does not go looking for one anyway. The rest — the order of the three calls,
 * what a cancelled picker looks like, what a resumed session shows — follows from the same rule that
 * the driver is never told a slot is filled when it is not.
 */

const TOKEN = "token-1";

const page = (): CapturedPage =>
  ({
    originalOfRecord: { uri: "blob:fake", width: 1600, height: 1200, bytes: 900, mediaType: "image/webp" },
    integrityHash: "a1".repeat(32),
  }) as unknown as CapturedPage;

const provider = (result: ScanResult): CaptureProvider => ({
  id: "test",
  version: "0",
  isSupported: async () => ({ supported: true, camera: true, docScanner: false, ocr: false }),
  scan: async () => result,
  cancel: () => {},
});

function spyIo(over: Partial<CaptureIo> = {}): CaptureIo & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    start: over.start ?? (async () => {
      calls.push("start");
      return { captureId: "cap-1", storagePath: "p", uploadUrl: "https://storage.test/u", uploadToken: "t" };
    }),
    upload: over.upload ?? (async () => { calls.push("upload"); }),
    confirm: over.confirm ?? (async () => {
      calls.push("confirm");
      return { slot: "cdl_front" as const, capturedAt: "2026-08-21T12:00:00Z" };
    }),
    // Never reached from this composable: the gate already hashed these exact bytes, so the page's
    // own digest is passed through rather than recomputed over a canvas re-encode.
    digest: over.digest ?? (async () => { calls.push("digest"); return "unused"; }),
  } as CaptureIo & { calls: string[] };
}

/**
 * ⚠ Two stubs, and both shapes are load-bearing — this file failed in CI while passing locally
 * because of them (Node 22 there, Node 26 here).
 *
 * The fetch stub returns a bare `{ blob() }` rather than a real `Response`: the composable only ever
 * calls `.blob()`, and constructing a `Response` around a jsdom `Blob` is a different piece of
 * machinery on every Node line. And `URL` is NOT replaced wholesale — spreading the class into an
 * object literal produces `{}` plus the two added statics, so `new URL(...)` stops existing for
 * everything else in the process, including the fetch machinery this very stub sits in front of.
 * Only the one static the pipeline calls is spied on; jsdom supplies both.
 */
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob(["x"], { type: "image/webp" }) })));
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const slotState = (slots: { slot: string; state: string }[], slot: string): string | undefined =>
  slots.find((s) => s.slot === slot)?.state;

describe("a photograph the gate refused", () => {
  it("never reaches the network — no upload URL is even asked for", async () => {
    const io = spyIo();
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), {
      provider: provider({ ok: false, reason: "IMAGE_BLURRED" }),
      io,
    });
    await captures.capture("cdl_front");
    // The whole argument for a client-side gate: a driver re-shooting in a car park pays nothing.
    expect(io.calls).toEqual([]);
    expect(slotState(captures.slots.value, "cdl_front")).toBe("rejected");
    expect(captures.slots.value.find((s) => s.slot === "cdl_front")?.reason).toBe("IMAGE_BLURRED");
  });

  it("shows a cancelled picker as nothing having happened, not as a failure", async () => {
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), {
      provider: provider({ ok: false, reason: "CAPTURE_CANCELLED" }),
      io: spyIo(),
    });
    await captures.capture("medical_card");
    // Closing the camera is not an error, and painting one would tell a driver they did something
    // wrong when they changed their mind.
    expect(slotState(captures.slots.value, "medical_card")).toBe("empty");
  });
});

describe("a photograph the gate accepted", () => {
  it("asks for a key, PUTs the bytes, and only then records the slot", async () => {
    const io = spyIo();
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), {
      provider: provider({ ok: true, pages: [page()] }),
      io,
    });
    await captures.capture("cdl_front");
    // The order IS the design: the row is written last, so a failed upload leaves no slot claiming
    // to be filled (D-APP10).
    expect(io.calls).toEqual(["start", "upload", "confirm"]);
    expect(slotState(captures.slots.value, "cdl_front")).toBe("done");
    expect(captures.slots.value.find((s) => s.slot === "cdl_front")?.capturedAt).toBe("2026-08-21T12:00:00Z");
  });

  it("does not mark the slot done when the upload fails", async () => {
    const io: CaptureIo & { calls: string[] } = spyIo();
    io.upload = async () => { io.calls.push("upload"); throw new Error("no signal"); };
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), {
      provider: provider({ ok: true, pages: [page()] }),
      io,
    });
    await captures.capture("cdl_front");
    expect(slotState(captures.slots.value, "cdl_front")).toBe("failed");
    // Asserted as a PREFIX rather than as "confirm is absent": a bug that made the composable give
    // up before it ever asked for a key would satisfy the weaker assertion, which is exactly how
    // this file passed locally and failed in CI once.
    expect(io.calls).toEqual(["start", "upload"]);
  });

  it("refuses to upload a format the staging surface does not accept", async () => {
    const io = spyIo();
    const odd = page();
    (odd.originalOfRecord as { mediaType?: string }).mediaType = "image/gif";
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), {
      provider: provider({ ok: true, pages: [odd] }),
      io,
    });
    await captures.capture("cdl_front");
    // Checked rather than cast: the day a fourth encoder appears, the slot fails visibly instead of
    // the server refusing a content type the client swore was fine.
    expect(io.calls).toEqual([]);
    expect(slotState(captures.slots.value, "cdl_front")).toBe("failed");
  });
});

describe("coming back to a session that already photographed something", () => {
  it("shows the server's slots as done without asking for them again", () => {
    const already: ApplicationCaptureView[] = [
      { slot: "cdl_front", contentType: "image/webp", bytes: 1, capturedAt: "2026-08-20T09:00:00Z" },
    ];
    const captures = useApplicationCaptures(ref(TOKEN), ref(already), {
      provider: provider({ ok: false, reason: "PROVIDER_ERROR" }),
      io: spyIo(),
    });
    expect(slotState(captures.slots.value, "cdl_front")).toBe("done");
    expect(slotState(captures.slots.value, "cdl_back")).toBe("empty");
  });

  /** Every requested slot is a label the driver can read — a slot with no label is a blank row. */
  it("labels every slot it asks for", () => {
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), {
      provider: provider({ ok: false, reason: "PROVIDER_ERROR" }),
      io: spyIo(),
    });
    expect(captures.slots.value.length).toBeGreaterThan(0);
    for (const slot of captures.slots.value) expect(slot.label).toBeTruthy();
    // The signature mark belongs to the signing ceremony, not to a camera.
    expect(captures.slots.value.some((s) => s.slot === "signature_mark")).toBe(false);
  });
});
