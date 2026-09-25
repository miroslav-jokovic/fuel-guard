/**
 * The two things every PDF viewer on the applicant's link does the same way: load pdfjs, and fetch a
 * document's bytes once (C1, AF6).
 *
 * Moved out of `PacketPageView.vue` when AF6 gave the link a second viewer (`PermissionDocumentView`),
 * which is the point at which a copy would start: the dynamic import, the worker URL and the fetch's
 * credentials are the three lines most likely to be written slightly differently the second time.
 * `PacketPageView.vue`'s header keeps the WHY for each; this is the one implementation.
 */

let workerConfigured = false;

/**
 * pdfjs, imported when a viewer opens and not before: an applicant on screen three of eight should
 * not download a PDF engine to fill in their address history.
 */
export async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  if (!workerConfigured) {
    // Vite resolves `?url` to the emitted asset; the worker keeps rasterising off the main thread.
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    workerConfigured = true;
  }
  return pdfjs;
}

/**
 * One document, fetched ONCE. ⚠ `credentials: "omit"`: the link carries no cookie and must not start
 * doing so; the token in the path is the whole credential. The LOADING TASK is returned because it
 * owns the worker, and `task.destroy()` is what releases it.
 */
export async function loadPdfDocument(src: string) {
  const pdfjs = await loadPdfjs();
  const res = await fetch(src, { credentials: "omit" });
  if (!res.ok) throw new Error(`document ${res.status}`);
  const bytes = await res.arrayBuffer();
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  return { task: loading, doc: await loading.promise };
}

export type LoadedPdf = Awaited<ReturnType<typeof loadPdfDocument>>;
