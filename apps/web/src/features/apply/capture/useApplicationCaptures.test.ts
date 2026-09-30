import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import type { CapturedPage, ScanResult } from "@silvicom/capture-engine";
import type { ApplicationCaptureView } from "@silvicom/shared";
import type { CaptureIo } from "./stageCapture";
import type { WebCaptureProvider } from "./webFileProvider";
import { useApplicationCaptures } from "./useApplicationCaptures";

/**
 * The DEFAULT provider, replaced by one that runs the picker it is given and accepts what it returns —
 * so the `onStaged` test below can see which file the composable hands on (the original, AW5). Every
 * other test here injects its own provider and never reaches this.
 */
const ORIGINAL = new File(["the phone's own photograph"], "IMG_0001.jpg", { type: "image/jpeg" });
/** "Upload a photo instead" (§6.6.6) returns a different file, so a test can tell which picker ran. */
const UPLOADED = new File(["a photo already on the phone"], "IMG_0002.jpg", { type: "image/jpeg" });
const pickers = vi.hoisted(() => ({ camera: vi.fn(), file: vi.fn() }));
vi.mock("./webImageIo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./webImageIo")>()),
  pickPhotoFromCamera: async (...args: unknown[]) => {
    pickers.camera(...args);
    return ORIGINAL;
  },
  pickImageFile: async (...args: unknown[]) => {
    pickers.file(...args);
    return UPLOADED;
  },
}));
vi.mock("./webFileProvider", () => ({
  createWebFileProvider: (_config: unknown, options: { pick: () => Promise<File | null> }): WebCaptureProvider => ({
    id: "default",
    version: "0",
    takeBytes: () => new Blob(["x"], { type: "image/webp" }),
    isSupported: async () => ({ supported: true, camera: true, docScanner: false, ocr: false }),
    scan: async () => {
      await options.pick();
      return { ok: true, pages: [page()] };
    },
    cancel: () => {},
  }),
}));

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

/** The bytes every accepted test page stands for — what `use` must send, byte for byte. */
const BYTES = "the encoded licence";
const provider = (result: ScanResult, takeBytes: (uri: string) => Blob | null = () => new Blob([BYTES], { type: "image/webp" })): WebCaptureProvider => ({
  id: "test",
  version: "0",
  takeBytes,
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
 * ⚠ Two stubs, and both shapes are load-bearing.
 *
 * `fetch` REFUSES, exactly as production's CSP refuses `fetch("blob:…")` (no `blob:` in `connect-src`).
 * It used to answer with the bytes — and that stub is how every applicant photograph failing in
 * production until 2026-09-30 passed here: the composable read its own object URL back, and only a
 * browser serving the real header could say no. The bytes now come from `takeBytes`. And `URL` is NOT
 * replaced wholesale — spreading the class into an
 * object literal produces `{}` plus the two added statics, so `new URL(...)` stops existing for
 * everything else in the process, including the fetch machinery this very stub sits in front of.
 * Only the one static the pipeline calls is spied on; jsdom supplies both.
 */
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  pickers.camera.mockClear();
  pickers.file.mockClear();
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

/**
 * Seeing what was sent (X6).
 *
 * A driver who photographed the wrong side of a licence had no way to know: the slot said
 * "Received" and nothing else. What is asserted here is the picture appearing — and, just as much,
 * the two places it must NOT linger, because the rule the revoke already stated is that a phone
 * should not hold four hundred-kilobyte blobs alive because a licence was re-taken four times.
 */
describe("the picture the driver just sent", () => {
  const held = (c: ReturnType<typeof useApplicationCaptures>, slot: string) =>
    c.slots.value.find((s) => s.slot === slot)?.previewUrl ?? null;

  it("shows what was sent, once it is in the bucket", async () => {
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), {
      provider: provider({ ok: true, pages: [page()] } as ScanResult),
      io: spyIo(),
    });
    await captures.capture("cdl_front");

    expect(held(captures, "cdl_front")).toBe("blob:fake");
    // And only for the slot that was photographed.
    expect(held(captures, "cdl_back")).toBeNull();
  });

  it("keeps the bytes alive for exactly as long as they are on the screen", async () => {
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), {
      provider: provider({ ok: true, pages: [page()] } as ScanResult),
      io: spyIo(),
    });
    await captures.capture("cdl_front");
    // Not revoked while it is the thing being displayed — that was the bug the first version of
    // this change would have had, and it shows as an empty box rather than an error.
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:fake");
  });

  it("lets go of the old picture when the slot is re-taken", async () => {
    // One per slot, at most. Retaking REPLACES; the count never grows.
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), {
      provider: provider({ ok: true, pages: [page()] } as ScanResult),
      io: spyIo(),
    });
    await captures.capture("cdl_front");
    await captures.capture("cdl_front");

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    expect(held(captures, "cdl_front")).toBe("blob:fake");
  });

  it("holds nothing when the upload failed, because there is nothing to show", async () => {
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), {
      provider: provider({ ok: true, pages: [page()] } as ScanResult),
      io: spyIo({ upload: async () => { throw new Error("boom"); } }),
    });
    await captures.capture("cdl_front");

    expect(held(captures, "cdl_front")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  it("shows no picture for a capture taken on a previous visit", async () => {
    /**
     * ⚠ True rather than a limitation worked around. The server returns slots and dates, not
     * pictures — re-serving them would mean a signed read URL per slot on an unauthenticated
     * surface on every page load. "Received" with no thumbnail is the honest answer for a
     * photograph this browser never held.
     */
    const already: ApplicationCaptureView[] = [
      { slot: "cdl_front", contentType: "image/webp", bytes: 900, capturedAt: "2026-08-20T10:00:00Z" },
    ];
    const captures = useApplicationCaptures(ref(TOKEN), ref(already), {
      provider: provider({ ok: true, pages: [page()] } as ScanResult),
      io: spyIo(),
    });

    expect(slotState(captures.slots.value, "cdl_front")).toBe("done");
    expect(held(captures, "cdl_front")).toBeNull();
  });
});

describe("handing on the photograph once it is staged (AW5)", () => {
  it("hands on the ORIGINAL the driver took — not the downscaled upload — and only after the confirm", async () => {
    const io = spyIo();
    const onStaged = vi.fn(() => io.calls.push("onStaged"));
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), { io, onStaged });
    await captures.capture("cdl_back");
    expect(io.calls).toEqual(["start", "upload", "confirm", "onStaged"]);
    expect(onStaged).toHaveBeenCalledWith("cdl_back", ORIGINAL);
  });

  it("hands on the staged bytes when an injected provider has no original", async () => {
    const onStaged = vi.fn();
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), { provider: provider({ ok: true, pages: [page()] }), io: spyIo(), onStaged });
    await captures.capture("cdl_back");
    expect(onStaged).toHaveBeenCalledWith("cdl_back", expect.any(Blob));
    expect(onStaged.mock.calls[0]![1]).not.toBe(ORIGINAL);
  });

  it("says nothing when the photograph never reached the bucket", async () => {
    const onStaged = vi.fn();
    const failing = spyIo({ upload: async () => { throw new Error("offline"); } });
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), { io: failing, onStaged });
    await captures.capture("cdl_back");
    expect(onStaged).not.toHaveBeenCalled();
    const refused = useApplicationCaptures(ref(TOKEN), ref([]), { provider: provider({ ok: false, reason: "IMAGE_BLURRED" }), io: spyIo(), onStaged });
    await refused.capture("cdl_back");
    expect(onStaged).not.toHaveBeenCalled();
  });
});

/**
 * The scanner screen's two presses (§6.6.1, C3b2b): `take` holds the photograph and shows it; only `use`
 * sends it. The property is the one this file opened with, one step further: **a photograph the driver
 * has not accepted never reaches the network either.**
 */
describe("take, look, then send (§6.6.1)", () => {
  const view = (c: ReturnType<typeof useApplicationCaptures>, slot = "cdl_front") =>
    c.slots.value.find((s) => s.slot === slot)!;

  it("holds the photograph and shows it large, and asks the network nothing until Use this", async () => {
    const io = spyIo();
    const onStaged = vi.fn();
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), { provider: provider({ ok: true, pages: [page()] }), io, onStaged });
    await captures.take("cdl_front");
    expect(io.calls).toEqual([]);
    expect(view(captures).state).toBe("review");
    expect(view(captures).pending).toBe(true);
    expect(view(captures).previewUrl).toBe("blob:fake");
    // The barcode is read from what is in the bucket, never from a preview the driver may retake.
    expect(onStaged).not.toHaveBeenCalled();

    await captures.use("cdl_front");
    expect(io.calls).toEqual(["start", "upload", "confirm"]);
    expect(view(captures).state).toBe("done");
    expect(view(captures).pending).toBe(false);
    // Sent, and still the picture on the screen (X6).
    expect(view(captures).previewUrl).toBe("blob:fake");
    expect(onStaged).toHaveBeenCalledTimes(1);
  });

  it("Retake replaces the held photograph and lets go of the old one, still without a request", async () => {
    let n = 0;
    const two: WebCaptureProvider = {
      ...provider({ ok: true, pages: [page()] }),
      scan: async () => {
        const p = page();
        (p.originalOfRecord as { uri: string }).uri = `blob:shot-${++n}`;
        return { ok: true, pages: [p] };
      },
    };
    const io = spyIo();
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), { provider: two, io });
    await captures.take("cdl_front");
    await captures.take("cdl_front");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:shot-1");
    expect(view(captures).previewUrl).toBe("blob:shot-2");
    expect(io.calls).toEqual([]);
  });

  it("a Retake the driver closes leaves the photograph they had on the screen", async () => {
    let result: ScanResult = { ok: true, pages: [page()] };
    const flip: WebCaptureProvider = { ...provider(result), scan: async () => result };
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), { provider: flip, io: spyIo() });
    await captures.take("cdl_front");
    result = { ok: false, reason: "CAPTURE_CANCELLED" };
    await captures.take("cdl_front");
    expect(view(captures).state).toBe("review");
    expect(view(captures).pending).toBe(true);
    expect(view(captures).previewUrl).toBe("blob:fake");
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:fake");
  });

  it("keeps the photograph after a network failure, so Use this works again once the signal is back", async () => {
    let offline = true;
    const io = spyIo();
    io.upload = async () => {
      io.calls.push("upload");
      if (offline) throw new Error("no signal");
    };
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), { provider: provider({ ok: true, pages: [page()] }), io });
    await captures.take("cdl_front");
    await captures.use("cdl_front");
    expect(view(captures).state).toBe("failed");
    expect(view(captures).failure).toBe("network");
    expect(view(captures).pending).toBe(true);
    expect(view(captures).previewUrl).toBe("blob:fake");

    offline = false;
    await captures.use("cdl_front");
    expect(view(captures).state).toBe("done");
    expect(io.calls).toEqual(["start", "upload", "start", "upload", "confirm"]);
  });

  it("lets go of a photograph the server says did not arrive intact, and offers only a retake (D-AW9)", async () => {
    const io = spyIo({
      confirm: async () => {
        throw Object.assign(new Error("That photo did not arrive intact. Take it again."), { code: "capture_not_intact" });
      },
    });
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), { provider: provider({ ok: true, pages: [page()] }), io });
    await captures.take("cdl_front");
    await captures.use("cdl_front");
    expect(view(captures).state).toBe("failed");
    expect(view(captures).failure).toBe("not_intact");
    // Sending the same bytes again would get the same answer, so there is nothing left to send.
    expect(view(captures).pending).toBe(false);
    expect(view(captures).previewUrl).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  it("Use this does nothing when nothing is held", async () => {
    const io = spyIo();
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), { provider: provider({ ok: true, pages: [page()] }), io });
    await captures.use("cdl_front");
    expect(io.calls).toEqual([]);
    expect(view(captures).state).toBe("empty");
  });
});

describe("Upload a photo instead (§6.6.6)", () => {
  it("opens the file picker WITHOUT `capture`, and hands on the file it returned", async () => {
    const onStaged = vi.fn();
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), { io: spyIo(), onStaged });
    await captures.take("cdl_back", "file");
    expect(pickers.camera).not.toHaveBeenCalled();
    // One argument: the accept list. A second would be the `capture` attribute, which opens the camera
    // — the very thing a driver pressing this button was refused.
    expect(pickers.file).toHaveBeenCalledWith("image/*");
    expect(captures.slots.value.find((s) => s.slot === "cdl_back")?.source).toBe("file");
    await captures.use("cdl_back");
    expect(onStaged).toHaveBeenCalledWith("cdl_back", UPLOADED);
  });

  it("the camera is the default, and a later camera press does not reuse the uploaded file", async () => {
    const onStaged = vi.fn();
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), { io: spyIo(), onStaged });
    await captures.take("cdl_back", "file");
    await captures.take("cdl_back");
    expect(pickers.camera).toHaveBeenCalledTimes(1);
    await captures.use("cdl_back");
    expect(onStaged).toHaveBeenCalledWith("cdl_back", ORIGINAL);
  });

  /** AW6, §6.7: the selfie is of the person holding the phone, so it opens the FRONT camera. */
  it("opens the front camera for the selfie and the rear one for a document, one press after another", async () => {
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), { io: spyIo(), only: ["selfie", "cdl_front"] });
    await captures.take("selfie");
    await captures.take("cdl_front");
    expect(pickers.camera.mock.calls).toEqual([["user"], ["environment"]]);
  });
});

describe("the bytes that are sent (2026-09-30)", () => {
  /**
   * THE regression. Production's CSP refuses `fetch("blob:…")`, so a photograph read back from its own
   * object URL never reached the upload: zero rows in `application_captures`, from the day the scanner
   * shipped. `fetch` here refuses the same way — and the upload still gets the provider's bytes.
   */
  it("sends the bytes the provider handed over, and never reads the photograph back from its URL", async () => {
    const uploaded: string[] = [];
    const io = spyIo({
      upload: async (_url: string, blob: Blob) => {
        uploaded.push(await blob.text());
      },
    });
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), {
      provider: provider({ ok: true, pages: [page()] }),
      io,
      only: ["cdl_front"],
      local: null,
    });
    await captures.take("cdl_front");
    await captures.use("cdl_front");

    expect(slotState(captures.slots.value, "cdl_front")).toBe("done");
    expect(uploaded).toEqual([BYTES]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a page whose bytes its provider cannot produce, before anything is asked of the network", async () => {
    const io = spyIo();
    const captures = useApplicationCaptures(ref(TOKEN), ref([]), {
      provider: provider({ ok: true, pages: [page()] }, () => null),
      io,
      only: ["cdl_front"],
      local: null,
    });
    await captures.take("cdl_front");
    await captures.use("cdl_front");

    expect(slotState(captures.slots.value, "cdl_front")).toBe("failed");
    expect(io.calls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
