import { ref, type Ref } from "vue";

/**
 * Which release this page is (RELEASE-TRAIN-PLAN R6, D-REL10): the CalVer tag, or the commit when
 * there is none — staging, a local build, or the minutes between a deploy and its tag.
 *
 * Read from `/api/version` on THIS page's own origin, deliberately not through `apiFetch`'s
 * VITE_API_URL. The web service is the Express app that served this bundle, so its answer names the
 * code on screen; a split-off API host can sit at a different commit ("deployed" is a per-service
 * question), and would name code the person is not looking at. The endpoint is public, so a plain
 * fetch also keeps the answer from waiting on a token refresh.
 *
 * Asked once per page load: the bundle cannot change under a running page.
 */
let pending: Promise<string | null> | null = null;

async function read(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string | null; commitShort?: string | null };
    return body.version ?? body.commitShort ?? null;
  } catch {
    return null;
  }
}

export function resetServedRelease(): void {
  pending = null;
}

export function useServedRelease(): Ref<string | null> {
  const release = ref<string | null>(null);
  pending ??= read();
  void pending.then((v) => (release.value = v));
  return release;
}
