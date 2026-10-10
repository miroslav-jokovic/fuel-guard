import { describe, expect, it } from "vitest";
import { INTAKE_REFUSALS, READ_FAILURES } from "@silvicom/shared";
import type { ApiResult } from "@/lib/api";
import { addFiles } from "./bolFiles";
import { READ_TIMEOUT_MS, POLL_MS, readBol, type BolReadIo, type BolReadStage } from "./bolReadPipeline";

/**
 * Send → prepare → group → read (N2). What must hold: the document is grouped in the order shown, a
 * refused file stops everything before a read is spent and is named with the intake's sentence, bytes the
 * org already holds are not uploaded again, and every failure ends in a sentence rather than a spinner.
 */
const SHA = (name: string) => name.padEnd(64, "0").slice(0, 64);
const file = (name: string, content = name) => new File([content], name, { type: "image/jpeg", lastModified: 1 });

interface Script {
  duplicate?: string[];
  statuses?: Record<string, string[]>;
  refusal?: Record<string, string>;
  read?: { status: string; failureCode?: string }[];
  completeStatus?: number;
  putFails?: boolean;
}

function fakeIo(s: Script = {}) {
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  const puts: string[] = [];
  const polls: Record<string, number> = {};
  let readPoll = 0;
  const ok = <T>(data: T, status = 200): ApiResult<T> => ({ ok: true, status, data });
  const io: BolReadIo = {
    async api<T>(path: string, init?: { method?: string; body?: object }) {
      const method = init?.method ?? "GET";
      calls.push({ method, path, body: init?.body as Record<string, unknown> });
      if (path.endsWith("/sources") && method === "POST") {
        const name = (init!.body as { fileName: string }).fileName;
        const dup = s.duplicate?.includes(name);
        return ok({ sourceId: `src-${name}`, uploadUrl: dup ? null : `https://storage.test/${name}`, duplicate: !!dup }) as ApiResult<T>;
      }
      if (path.endsWith("/complete")) {
        return (s.completeStatus ? { ok: false, status: s.completeStatus, error: { code: "x", message: "Busy." } } : ok({ jobId: "j" }, 202)) as ApiResult<T>;
      }
      const src = /\/sources\/src-(.+)$/.exec(path);
      if (src) {
        const name = src[1]!;
        const seq = s.statuses?.[name] ?? ["ready"];
        const i = Math.min(polls[name] ?? 0, seq.length - 1);
        polls[name] = (polls[name] ?? 0) + 1;
        return ok({ sourceId: `src-${name}`, status: seq[i], refusal: s.refusal?.[name] ?? null, pageCount: 1, readId: null }) as ApiResult<T>;
      }
      if (path.endsWith("/assemblies")) return ok({ assemblyId: "asm-1", pageCount: 2 }, 201) as ApiResult<T>;
      if (path.endsWith("/reads")) return ok({ readId: "read-1" }, 201) as ApiResult<T>;
      if (path.endsWith("/reads/read-1")) {
        const seq = s.read ?? [{ status: "done" }];
        const r = seq[Math.min(readPoll++, seq.length - 1)]!;
        return ok({ id: "read-1", status: r.status, failureCode: r.failureCode ?? null, pages: [], evidence: [], result: null }) as ApiResult<T>;
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
    async put(url) {
      if (s.putFails) throw new Error("network");
      puts.push(url);
    },
    sha256: async (f) => SHA(await f.text()),
    sleep: async () => {},
  };
  return { io, calls, puts };
}
const picked = (...names: string[]) => addFiles([], names.map((n) => file(n)), (() => { let k = 0; return () => `k${++k}`; })()).files;

describe("readBol", () => {
  it("uploads each file, then groups them in the order shown and reads the group", async () => {
    const { io, calls, puts } = fakeIo({ statuses: { "b.jpg": ["normalising", "ready"] } });
    const stages: BolReadStage[] = [];
    const out = await readBol(io, picked("b.jpg", "a.jpg"), (st) => stages.push(st));
    expect(out).toMatchObject({ kind: "done", read: { id: "read-1" } });
    expect(puts).toEqual(["https://storage.test/b.jpg", "https://storage.test/a.jpg"]);
    expect(calls.find((c) => c.path.endsWith("/sources") && c.method === "POST")!.body).toEqual({
      fileName: "b.jpg", mime: "image/jpeg", byteSize: 5, sha256: SHA("b.jpg"),
    });
    expect(calls.find((c) => c.path.endsWith("/complete"))!.body).toEqual({ sha256: SHA("b.jpg"), profile: null });
    expect(calls.find((c) => c.path.endsWith("/assemblies"))!.body).toEqual({ sourceIds: ["src-b.jpg", "src-a.jpg"] });
    expect(calls.find((c) => c.path.endsWith("/reads"))!.body).toEqual({ assemblyId: "asm-1", profile: "shipping_document" });
    expect(stages.at(-1)).toEqual({ kind: "reading" });
    expect(stages).toContainEqual({ kind: "preparing", done: 1, total: 2 });
  });

  it("does not upload bytes the organization already holds, and still groups them", async () => {
    const { io, calls, puts } = fakeIo({ duplicate: ["a.jpg"] });
    await readBol(io, picked("a.jpg", "b.jpg"), () => {});
    expect(puts).toEqual(["https://storage.test/b.jpg"]);
    expect(calls.filter((c) => c.path.endsWith("/complete"))).toHaveLength(1);
    expect(calls.find((c) => c.path.endsWith("/assemblies"))!.body).toEqual({ sourceIds: ["src-a.jpg", "src-b.jpg"] });
  });

  it("sends the same bytes under two names once, and lists them once", async () => {
    const { io, calls, puts } = fakeIo();
    const same = addFiles([], [file("a.jpg", "X"), new File(["X"], "copy.jpg", { type: "image/jpeg", lastModified: 2 })], (() => { let k = 0; return () => `k${++k}`; })()).files;
    await readBol(io, same, () => {});
    expect(puts).toHaveLength(1);
    expect(calls.find((c) => c.path.endsWith("/assemblies"))!.body).toEqual({ sourceIds: ["src-a.jpg"] });
  });

  it("stops before any read when a file is refused, naming it with the intake's sentence", async () => {
    const { io, calls } = fakeIo({ statuses: { "small.jpg": ["refused"] }, refusal: { "small.jpg": "too_small" } });
    const out = await readBol(io, picked("ok.jpg", "small.jpg"), () => {});
    expect(out).toEqual({ kind: "refused", files: [{ name: "small.jpg", reason: INTAKE_REFUSALS.too_small }] });
    expect(calls.some((c) => c.path.endsWith("/assemblies") || c.path.endsWith("/reads"))).toBe(false);
  });

  it("waits for an intake already running (409) instead of failing", async () => {
    const { io } = fakeIo({ completeStatus: 409 });
    expect(await readBol(io, picked("a.jpg"), () => {})).toMatchObject({ kind: "done" });
  });

  it("ends a failed read with its READ_FAILURES sentence", async () => {
    const { io } = fakeIo({ read: [{ status: "queued" }, { status: "reading" }, { status: "failed", failureCode: "no_readable_page" }] });
    expect(await readBol(io, picked("a.jpg"), () => {})).toEqual({ kind: "failed", message: READ_FAILURES.no_readable_page });
  });

  it("says so when an upload breaks, or a read outlasts its wait, rather than spinning", async () => {
    expect(await readBol(fakeIo({ putFails: true }).io, picked("a.jpg"), () => {}))
      .toEqual({ kind: "failed", message: "a.jpg did not finish uploading. Check the connection and press Read again." });
    const slow = fakeIo({ read: [{ status: "reading" }] });
    let slept = 0;
    slow.io.sleep = async () => void slept++;
    expect(await readBol(slow.io, picked("a.jpg"), () => {})).toMatchObject({ kind: "failed", message: expect.stringContaining("longer than it should") });
    expect(slept).toBe(READ_TIMEOUT_MS / POLL_MS);
  });

  it("refuses to start with no page ticked", async () => {
    const { io, calls } = fakeIo();
    expect(await readBol(io, [], () => {})).toEqual({ kind: "failed", message: "Tick at least one page to read." });
    expect(calls).toEqual([]);
  });
});
