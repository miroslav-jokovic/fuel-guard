import { onMounted, onUnmounted, ref } from "vue";

/**
 * New-deploy detection. The build bakes a version id into the bundle (__APP_VERSION__, vite.config.ts)
 * and ships the same id as /version.json next to the bundle. A running tab polls that file (and
 * re-checks whenever the tab regains focus): a different id means a newer build is live behind this
 * tab → show the refresh banner instead of letting the user keep working on stale code.
 *
 * Failure modes covered:
 *  - `vite:preloadError` (a lazy route chunk 404s because its hash was replaced by the deploy): the tab
 *    is already broken, so reload ONCE automatically (sessionStorage-guarded against loops); if that
 *    single auto-reload already happened, fall back to the banner.
 *  - version.json unreachable (offline, mid-deploy): ignored — never nag on a network blip.
 */

declare const __APP_VERSION__: string | undefined;

const CURRENT_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
const POLL_MS = 5 * 60_000;
const RELOAD_GUARD_KEY = "fg-chunk-reload-at";

export function useAppUpdate() {
  const updateAvailable = ref(false);

  async function check(): Promise<void> {
    if (import.meta.env.DEV || updateAvailable.value) return;
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { version?: string };
      if (body.version && body.version !== CURRENT_VERSION) updateAvailable.value = true;
    } catch {
      /* offline / mid-deploy — check again next tick */
    }
  }

  function refresh(): void {
    window.location.reload();
  }

  function onPreloadError(e: Event): void {
    e.preventDefault(); // suppress Vite's throw — we handle the recovery
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
    if (Date.now() - last > 60_000) {
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
      window.location.reload(); // stale chunk after a deploy — a fresh load fixes it
    } else {
      updateAvailable.value = true; // already tried once this minute — let the user decide
    }
  }

  function onVisible(): void {
    if (document.visibilityState === "visible") void check();
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    timer = setInterval(() => void check(), POLL_MS);
    window.addEventListener("vite:preloadError", onPreloadError);
    document.addEventListener("visibilitychange", onVisible);
    void check();
  });
  onUnmounted(() => {
    if (timer) clearInterval(timer);
    window.removeEventListener("vite:preloadError", onPreloadError);
    document.removeEventListener("visibilitychange", onVisible);
  });

  return { updateAvailable, refresh };
}
