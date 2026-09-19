import { fetchObjectUrl } from "@/lib/api";

/**
 * The two things anybody does with a PDF this API renders: open it, or keep it.
 *
 * ── WHY IT IS NOT AN `<a href>` ───────────────────────────────────────────────────────────────
 * These routes sit behind `requireAuth`, so a plain navigation carries no Authorization header and
 * answers 401. The bytes have to be fetched with the session token and handed to the browser as a
 * blob. The alternative shape in this repo — an endpoint returning a SIGNED STORAGE URL — is right
 * when the bytes are already an object in a bucket, and is not available for a document rendered on
 * demand and deliberately never stored, which both callers here are.
 *
 * ── WHY IT LIVES IN `lib/` ────────────────────────────────────────────────────────────────────
 * It was `features/maintenance/inspectionDocuments.ts` and had three callers, all inside maintenance.
 * The application preview (F6) is the fourth and is in `features/apply`, and `lint:boundaries` forbids
 * one feature importing another's internals — correctly. The choice was a copy of these twelve lines
 * or a promotion; a copy is a workaround with a delay fuse, so this is the promotion. What stayed in
 * `inspectionDocuments.ts` is the part that is actually about inspections: which path, and what the
 * saved file is called.
 *
 * The object URL is revoked on a DELAY in both verbs rather than immediately: a new tab has to have
 * loaded it, and a download has to have started, before the URL stops meaning anything.
 */

const REVOKE_AFTER_MS = 60_000;

/**
 * The identity of a document this API renders on demand — a path to fetch and a name to save it as.
 *
 * ⚠ There is deliberately no id, no hash and no captured date on this type, and that absence is the
 * point: a rendered document is composed from the current rows each time it is asked for and is
 * never stored, so it has no `documents` row and nothing §390.32(c) can be shown about it. A viewer
 * handed one of these must not print evidence it does not have (B8).
 */
export type RenderedDocument = { path: string; filename: string };

/** Open the PDF in a new tab. Throws with the API's own sentence when it cannot be fetched. */
export async function openPdf(path: string): Promise<void> {
  const url = await fetchObjectUrl(path);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/**
 * Hand an object URL to the browser as a download.
 *
 * Split out of `downloadPdf` for B8: a viewer that is already SHOWING the bytes saves exactly those
 * bytes, rather than fetching a second copy of a document that is composed fresh on every request
 * and could differ from the one on screen. The URL's lifetime stays with whoever created it — this
 * function does not revoke, because the viewer still needs it in the frame.
 */
export function saveObjectUrl(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Save the PDF under `filename` without opening it. Throws with the API's own sentence on failure. */
export async function downloadPdf(path: string, filename: string): Promise<void> {
  const url = await fetchObjectUrl(path);
  saveObjectUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
