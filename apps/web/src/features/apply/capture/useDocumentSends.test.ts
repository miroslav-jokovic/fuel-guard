import { describe, it, expect, vi, beforeEach } from "vitest";
import { effectScope, ref } from "vue";
import type { CapturedPage } from "@silvicom/capture-engine";
import { APPLICATION_CAPTURE_MAX_BYTES, APPLICATION_CAPTURE_REQUESTED, type ApplicationCaptureView } from "@silvicom/shared";
import type { CaptureIo } from "./stageCapture";
import type { WebCaptureProvider } from "./webFileProvider";
import { useDocumentSends, type DocumentPlace } from "./useDocumentSends";

/**
 * Part 2's "Your documents" (HIRING-WORKFLOW-AUDIT §9 P9): every paper offered, photo or PDF, several
 * training certificates, and the licence Part 1 took never asked for again.
 */

const page = (): CapturedPage =>
  ({ originalOfRecord: { uri: "blob:fake", width: 1600, height: 1200, bytes: 900, mediaType: "image/webp" }, integrityHash: "a1".repeat(32) }) as unknown as CapturedPage;

function harness(already: ApplicationCaptureView[] = [], pick: File | null = null) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const scans = vi.fn();
  const io: CaptureIo = {
    start: async (...args) => {
      calls.push({ fn: "start", args });
      return { captureId: "cap-1", storagePath: "p", uploadUrl: "https://storage.test/u", uploadToken: "t" };
    },
    upload: async (...args) => { calls.push({ fn: "upload", args }); },
    confirm: async (...args) => {
      calls.push({ fn: "confirm", args });
      return { slot: args[2].slot, capturedAt: "2026-11-01T12:00:00Z" };
    },
    digest: async () => "b2".repeat(32),
  };
  const provider: WebCaptureProvider = {
    id: "t", version: "0",
    takeBytes: () => new Blob(["picture"], { type: "image/webp" }),
    isSupported: async () => ({ supported: true, camera: true, docScanner: false, ocr: false }),
    scan: async () => {
      scans();
      return { ok: true, pages: [page()] };
    },
    cancel: () => {},
  };
  const scope = effectScope();
  const sends = scope.run(() => useDocumentSends(ref("tok"), ref(already), { io, provider, pickFile: async () => pick, local: null }))!;
  const confirms = () => calls.filter((c) => c.fn === "confirm").map((c) => c.args[2]);
  return { sends, calls, confirms, scans, scope };
}

const stored = (slot: string, ordinal = 0): ApplicationCaptureView =>
  ({ slot, ordinal, contentType: "image/webp", bytes: 1, capturedAt: "2026-10-30T00:00:00Z" }) as ApplicationCaptureView;
const pdf = (size = 1200) => new File([new Uint8Array(size)], "medical.pdf", { type: "application/pdf" });

beforeEach(() => {
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

describe("the documents list (§9 P9)", () => {
  it("offers every paper on the list, the licence first and marked as Part 1's", () => {
    const { sends } = harness([stored("cdl_front"), stored("cdl_back")]);
    expect(sends.groups.value.map((g) => g.slot)).toEqual(APPLICATION_CAPTURE_REQUESTED);
    const front = sends.groups.value[0]!;
    expect(front).toMatchObject({ fromPartOne: true });
    expect(front.places[0]).toMatchObject({ state: "done" });
    expect(sends.groups.value.find((g) => g.slot === "passport")).toMatchObject({ fromPartOne: false, next: null });
  });

  it("sends a PDF as it is — application/pdf, no gate, at ordinal 0", async () => {
    const { sends, calls, confirms, scans } = harness([], pdf());
    await sends.file({ slot: "medical_card", ordinal: 0 });
    expect(scans).not.toHaveBeenCalled();
    expect(calls.find((c) => c.fn === "start")?.args).toEqual(["tok", "medical_card", "application/pdf"]);
    expect(confirms()).toEqual([{ slot: "medical_card", content_type: "application/pdf", sha256: "b2".repeat(32), ordinal: 0 }]);
    expect(sends.groups.value.find((g) => g.slot === "medical_card")!.places[0]).toMatchObject({ state: "done", contentType: "application/pdf" });
  });

  it("refuses a PDF over the ceiling before a byte is sent", async () => {
    const { sends, calls } = harness([], pdf(APPLICATION_CAPTURE_MAX_BYTES + 1));
    await sends.file({ slot: "training_certificate", ordinal: 0 });
    expect(calls).toEqual([]);
    expect(sends.groups.value.find((g) => g.slot === "training_certificate")!.places[0]).toMatchObject({ state: "failed", failure: "too_large" });
  });

  it("sends a picture file through the same gate as the camera", async () => {
    const { sends, scans, confirms } = harness([], new File(["x"], "twic.jpg", { type: "image/jpeg" }));
    await sends.file({ slot: "twic", ordinal: 0 });
    expect(scans).toHaveBeenCalledTimes(1);
    expect(confirms()[0]).toMatchObject({ slot: "twic", content_type: "image/webp", ordinal: 0 });
  });

  it("offers a second training certificate beside the first and sends it at its own ordinal", async () => {
    const { sends, confirms } = harness([stored("training_certificate")]);
    const group = () => sends.groups.value.find((g) => g.slot === "training_certificate")!;
    expect(group().next).toBe(1);
    await sends.photo({ slot: "training_certificate", ordinal: group().next! } as DocumentPlace);
    expect(confirms()).toEqual([expect.objectContaining({ slot: "training_certificate", ordinal: 1 })]);
    expect(group().places.map((p) => [p.ordinal, p.state])).toEqual([[0, "done"], [1, "done"]]);
    expect(group().next).toBe(2);
  });

  it("stops offering another at five — 0534's limit", () => {
    const { sends } = harness([0, 1, 2, 3, 4].map((o) => stored("training_certificate", o)));
    const group = sends.groups.value.find((g) => g.slot === "training_certificate")!;
    expect(group.places).toHaveLength(5);
    expect(group.next).toBeNull();
  });

  it("never offers a second of a single-document paper", () => {
    const { sends } = harness([stored("passport")]);
    expect(sends.groups.value.find((g) => g.slot === "passport")).toMatchObject({ next: null });
  });
});
