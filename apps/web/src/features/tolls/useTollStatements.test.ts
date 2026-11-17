import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp, defineComponent } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { TollStatementRefused, tollStatementRefusal, useUploadTollStatement, type PutBytes } from "./useTollStatements";

/**
 * The upload's three steps (TOLLS-PER-TRUCK-PLAN.md TL4a): a file that is no statement inside is
 * turned away before anything is asked of the API; otherwise a place is asked for, the bytes go there,
 * and the API is told the provider, name, size and SHA-256 of what was sent — in that order, because
 * the API keeps the statement only by reading those bytes back.
 */
const api = vi.hoisted(() => ({ calls: [] as Array<{ path: string; body: unknown }>, answer: null as null | ((path: string) => unknown) }));
vi.mock("@/lib/api", () => ({
  apiFetch: async (path: string, opts?: { body?: unknown }) => {
    api.calls.push({ path, body: opts?.body });
    return api.answer!(path);
  },
}));

function run(put: PutBytes) {
  let upload!: ReturnType<typeof useUploadTollStatement>;
  const app = createApp(defineComponent({ setup: () => ((upload = useUploadTollStatement(put)), () => null) }));
  app.use(VueQueryPlugin, { queryClient: new QueryClient() });
  app.mount(document.createElement("div"));
  return upload;
}

const CSV = "Tag,Date,Amount\n00812345678,06/01/2026,3.25\n";

beforeEach(() => {
  api.calls.length = 0;
  api.answer = (path) =>
    path === "/api/tolls/statements/upload"
      ? { ok: true, data: { fileId: "f-1", uploadUrl: "https://storage.test/upload/org/f-1" } }
      : { ok: true, data: { statement: { id: "f-1" } } };
});

async function sha(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("uploading a toll statement", () => {
  it("asks for a place, puts the bytes there, then names what was sent", async () => {
    const puts: string[] = [];
    const upload = run(async (url, f) => void puts.push(`${url} ${f.name}`));
    const out = await upload.mutateAsync({ provider: "expresstoll", file: new File([CSV], "june.xlsx") });
    expect(out).toEqual({ id: "f-1" });
    expect(api.calls).toEqual([
      { path: "/api/tolls/statements/upload", body: { provider: "expresstoll", fileName: "june.xlsx", byteSize: CSV.length } },
      { path: "/api/tolls/statements", body: { fileId: "f-1", provider: "expresstoll", fileName: "june.xlsx", byteSize: CSV.length, sha256: await sha(CSV) } },
    ]);
    expect(puts).toEqual(["https://storage.test/upload/org/f-1 june.xlsx"]);
  });

  it("turns a picture named .pdf away before asking the API anything", async () => {
    const upload = run(async () => undefined);
    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])], "june.pdf");
    await expect(upload.mutateAsync({ provider: "ezpass", file: photo })).rejects.toThrow("is not a PDF, spreadsheet or CSV inside");
    expect(api.calls).toEqual([]);
  });

  it("carries the API's refusal code, so a copy already kept reads differently from a failure", async () => {
    api.answer = (path) =>
      path === "/api/tolls/statements/upload"
        ? { ok: true, data: { fileId: "f-1", uploadUrl: "u" } }
        : { ok: false, error: { code: "already_uploaded", message: "This file is already on the list, as a.csv under K-TAG." } };
    const upload = run(async () => undefined);
    const err = await upload.mutateAsync({ provider: "ktag", file: new File([CSV], "a.csv") }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TollStatementRefused);
    expect((err as TollStatementRefused).code).toBe("already_uploaded");
  });

  it("refuses an empty file and one over 25 MB in words", async () => {
    expect(await tollStatementRefusal(new File([], "empty.csv"))).toBe("empty.csv is empty.");
    const big = { name: "big.pdf", size: 25 * 1024 * 1024 + 1, slice: () => new Blob(["%PDF-"]) } as unknown as File;
    expect(await tollStatementRefusal(big)).toBe("big.pdf is larger than 25 MB.");
    expect(await tollStatementRefusal(new File([CSV], "ok.csv"))).toBeNull();
  });
});
