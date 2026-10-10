import {
  INTAKE_REFUSALS,
  READ_FAILURES,
  type CreateAssemblyResponse,
  type CreateSourceResponse,
  type ReadResponse,
  type SourceStatusResponse,
} from "@silvicom/shared";
import type { ApiResult } from "@/lib/api";
import type { BolFile } from "./bolFiles";

/**
 * Send a BOL's photos and read them as ONE document (DOCUMENT-READER-PLAN §7A N2; the routes are
 * `apps/api/src/modules/document-reading/routes/documents.ts`):
 *
 *   for each file   hash → register (`POST /sources`) → PUT the bytes to Storage → `…/complete`
 *   then            poll each source until `ready` — a REFUSED file stops here, named, with the intake's
 *                   own sentence, so the dispatcher unticks or retakes it before anything is read
 *   then            `POST /assemblies { sourceIds }` in the order shown → `POST /reads { assemblyId }`
 *                   → poll the read until `done` or `failed` (its READ_FAILURES sentence)
 *
 * The bytes go to Storage directly on the signed URL and never through the API. A file this org already
 * holds (`duplicate`) is neither uploaded nor rendered again. `complete` answering 409 means the same
 * file's intake is already running — from a second tab, or a retry — and is waited for like any other.
 *
 * Everything outside the browser is injected (`BolReadIo`) so each branch is tested without a network.
 */

export interface BolReadIo {
  api<T>(path: string, init?: { method?: string; body?: object }): Promise<ApiResult<T>>;
  put(url: string, file: File, mime: string): Promise<void>;
  sha256(file: File): Promise<string>;
  sleep(ms: number): Promise<void>;
}

export type BolReadStage =
  | { kind: "uploading"; done: number; total: number }
  | { kind: "preparing"; done: number; total: number }
  | { kind: "reading" };

export type BolReadOutcome =
  | { kind: "done"; read: ReadResponse }
  | { kind: "refused"; files: { name: string; reason: string }[] }
  | { kind: "failed"; message: string };

/** How often, and for how long, to ask. A read's target is p95 ≤ 30 s for two pages (plan §2 Queue). */
export const POLL_MS = 1500;
export const SOURCE_TIMEOUT_MS = 120_000;
export const READ_TIMEOUT_MS = 180_000;

const BASE = "/api/documents";
class Stop extends Error {}
const stop = (message: string): never => { throw new Stop(message); };
const must = <T>(res: ApiResult<T>, what: string): T =>
  res.ok && res.data !== undefined ? res.data : stop(res.error?.message ?? `${what} did not answer.`);

async function sendFile(io: BolReadIo, f: BolFile, sha256: string): Promise<string> {
  const reg = must(await io.api<CreateSourceResponse>(`${BASE}/sources`, {
    method: "POST", body: { fileName: f.file.name.slice(0, 255), mime: f.mime, byteSize: f.file.size, sha256 },
  }), "The upload");
  if (reg.duplicate) return reg.sourceId;
  if (!reg.uploadUrl) stop("The upload could not be started.");
  try {
    await io.put(reg.uploadUrl!, f.file, f.mime);
  } catch {
    stop(`${f.file.name} did not finish uploading. Check the connection and press Read again.`);
  }
  const done = await io.api(`${BASE}/sources/${reg.sourceId}/complete`, { method: "POST", body: { sha256, profile: null } });
  if (!done.ok && done.status !== 409) stop(done.error?.message ?? "The file could not be prepared.");
  return reg.sourceId;
}

/** Poll every source until none is still on its way; the files refused, by name, or [] when all are ready. */
async function waitForSources(io: BolReadIo, sent: { id: string; name: string }[], onStage: (s: BolReadStage) => void) {
  const pending = new Map(sent.map((s) => [s.id, s.name]));
  const refused: { name: string; reason: string }[] = [];
  const total = sent.length;
  for (let waited = 0; pending.size > 0; waited += POLL_MS) {
    for (const [id, name] of [...pending]) {
      const st = must(await io.api<SourceStatusResponse>(`${BASE}/sources/${id}`), "The file's status");
      if (st.status === "ready") pending.delete(id);
      else if (st.status === "refused") {
        pending.delete(id);
        refused.push({ name, reason: st.refusal ? INTAKE_REFUSALS[st.refusal] : INTAKE_REFUSALS.decode_failed });
      } else if (st.status === "failed") stop(`${name} could not be prepared. Press Read again.`);
    }
    onStage({ kind: "preparing", done: total - pending.size, total });
    if (pending.size === 0) break;
    if (waited >= SOURCE_TIMEOUT_MS) stop("Preparing the files is taking longer than it should. Press Read again in a minute.");
    await io.sleep(POLL_MS);
  }
  return refused;
}

async function waitForRead(io: BolReadIo, readId: string): Promise<BolReadOutcome> {
  for (let waited = 0; ; waited += POLL_MS) {
    const read = must(await io.api<ReadResponse>(`${BASE}/reads/${readId}`), "The read");
    if (read.status === "done") return { kind: "done", read };
    if (read.status === "failed") {
      return { kind: "failed", message: read.failureCode ? READ_FAILURES[read.failureCode] : "The read did not finish." };
    }
    if (waited >= READ_TIMEOUT_MS) stop("The read is taking longer than it should. It will keep going; check back in a minute.");
    await io.sleep(POLL_MS);
  }
}

export async function readBol(io: BolReadIo, files: readonly BolFile[], onStage: (s: BolReadStage) => void): Promise<BolReadOutcome> {
  if (files.length === 0) return { kind: "failed", message: "Tick at least one page to read." };
  try {
    const sent: { id: string; name: string }[] = [];
    // The same bytes under two names (a photo saved twice) are one page: sent once, listed once. Without
    // this the second would register while the first is still rendering and race it for the same source.
    const bySha = new Map<string, string>();
    for (const f of files) {
      onStage({ kind: "uploading", done: sent.length, total: files.length });
      const sha256 = await io.sha256(f.file);
      if (bySha.has(sha256)) continue;
      const id = await sendFile(io, f, sha256);
      bySha.set(sha256, id);
      sent.push({ id, name: f.file.name });
    }
    const refused = await waitForSources(io, sent, onStage);
    if (refused.length > 0) return { kind: "refused", files: refused };

    onStage({ kind: "reading" });
    // A file the org already held under another name comes back as the same source; list it once.
    const sourceIds = [...new Set(sent.map((s) => s.id))];
    const assembly = must(await io.api<CreateAssemblyResponse>(`${BASE}/assemblies`, { method: "POST", body: { sourceIds } }), "Grouping the pages");
    const read = must(await io.api<{ readId: string }>(`${BASE}/reads`, {
      method: "POST", body: { assemblyId: assembly.assemblyId, profile: "shipping_document" },
    }), "Starting the read");
    return await waitForRead(io, read.readId);
  } catch (e) {
    if (e instanceof Stop) return { kind: "failed", message: e.message };
    throw e;
  }
}
