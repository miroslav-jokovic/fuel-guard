import { describe, expect, it, vi } from "vitest";

/**
 * Every upload hook declares the type the file's BYTES are (`lib/fileFormat.ts`), never `file.type` — the
 * browser's guess from the name, which is "" for an iPhone HEIC on desktop Chrome and which a Google Voice
 * `.jfif` would never have been offered under (10/12/2026). One test per hook: the registration request is
 * the declaration, so it is the only call looked at; the mocked API refuses it, ending the mutation there.
 */
const apiFetch = vi.hoisted(() => vi.fn(async () => ({ ok: false, status: 400, error: { code: "stop", message: "stop" } })));
vi.mock("@/lib/api", () => ({ apiFetch, fetchObjectUrl: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: vi.fn() } } }));
vi.mock("@tanstack/vue-query", () => ({
  useQuery: () => ({}),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  keepPreviousData: undefined,
  useMutation: (opts: { mutationFn: (v: unknown) => Promise<unknown> }) => ({ mutateAsync: opts.mutationFn, isPending: { value: false } }),
}));

const { useUploadDocument } = await import("@/composables/useCompliance");
const { useRecordPaperAuthorization } = await import("@/features/recruitment/useAuthorizations");
const { useRecordHiringAct } = await import("@/features/recruitment/useHiringEvidence");
const { useUploadInquiryDocument } = await import("@/features/recruitment/useEmployerInquiries");
const { useAttachAssetPhoto } = await import("@/features/inventory/useAssets");
const { useAttachPartPhoto } = await import("@/features/inventory/useInventory");

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
/** A Google Voice photo: JFIF bytes, a `.jfif` name, and no type from the browser. */
const voicePhoto = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, ...ascii("JFIF"), 0])], "voice.jfif", { type: "" });
const textNamedJpg = () => new File([new Uint8Array(ascii("not a picture at all"))], "photo.jpg", { type: "image/jpeg" });

type Hook = { mutateAsync: (v: unknown) => Promise<unknown> };
const HOOKS: [string, () => Hook, (file: File) => unknown, (body: Record<string, unknown>) => unknown][] = [
  ["a compliance document", useUploadDocument as () => Hook, (file) => ({ subjectType: "driver", subjectId: "d1", kind: "medical_card", file }), (b) => b.contentType],
  ["a paper authorization", useRecordPaperAuthorization as () => Hook, (file) => ({ driverId: "d1", file }), (b) => b.content_type],
  ["a hiring record's scan", useRecordHiringAct as () => Hook, (file) => ({ driverId: "d1", step: "road_test", file }), (b) => b.content_type],
  ["a previous employer's answer", useUploadInquiryDocument as () => Hook, (file) => ({ inquiryId: "i1", file }), (b) => b.content_type],
  ["an asset photo", useAttachAssetPhoto as () => Hook, (file) => ({ id: "a1", file }), (b) => b.contentType],
  ["a part photo", useAttachPartPhoto as () => Hook, (file) => ({ id: "p1", file }), (b) => b.contentType],
];

describe("upload hooks declare what the bytes are", () => {
  it.each(HOOKS)("%s: a Google Voice .jfif typed '' is registered as image/jpeg", async (_, hook, input, declared) => {
    apiFetch.mockClear();
    await hook().mutateAsync(input(voicePhoto())).catch(() => undefined);
    const body = (apiFetch.mock.calls[0] as unknown as [string, { body: Record<string, unknown> }])[1].body;
    expect(declared(body)).toBe("image/jpeg");
  });

  it.each(HOOKS)("%s: a file named .jpg whose bytes are not a picture is refused before anything is sent", async (_, hook, input) => {
    apiFetch.mockClear();
    await expect(hook().mutateAsync(input(textNamedJpg()))).rejects.toThrow();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("a photo's bytes go up under the same type they were registered as", () => {
  it.each([["an asset photo", useAttachAssetPhoto], ["a part photo", useAttachPartPhoto]] as const)("%s", async (_, hook) => {
    apiFetch.mockResolvedValueOnce({ ok: true, status: 200, data: { uploadUrl: "https://storage.test/put", token: "t" } } as never);
    const put = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", put);
    try {
      await (hook as unknown as () => Hook)().mutateAsync({ id: "x1", file: voicePhoto() });
    } finally {
      vi.unstubAllGlobals();
    }
    expect((put.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ "content-type": "image/jpeg" });
  });
});
