import { computed, inject, onBeforeUnmount, onScopeDispose, provide, shallowRef, watch, type InjectionKey, type Ref } from "vue";
import { SCREEN_EVENTS_MAX, type ApplicationScreenEvent, type ApplyScreen } from "@silvicom/shared";
import { publicFetch } from "./useApplication";

/**
 * Which screen the applicant is looking at, reported to the server (AW14, C3d3a) — how §6.8 measures
 * "Part 1 median ≤ 8 min, p75 ≤ 12" and "Part 2 median ≤ 25 min", and where drivers stop.
 *
 * ── WHAT IS MEASURED IS TIME ON A SCREEN, NOT TIME SINCE THE LINK OPENED (owner, 2026-09-28) ──────
 * A driver who starts on Monday and finishes on Wednesday has not taken two days over Part 1. So a
 * visit ends when the screen changes AND when the phone is put away (`visibilitychange` → hidden), and
 * a new visit starts when it comes back. The sum of a link's `part1.*` visits is the time spent on
 * Part 1; the gaps between them are the driver's life.
 *
 * ── WHICH SCREEN: THE DEEPEST ONE SHOWING ───────────────────────────────────────────────────────
 * The phase chain (`ApplyPhaseRouter.vue`) names each branch; the flows inside some branches name
 * their own screens (Part 1's, each permission, the handbook, Part 2's hub and sections). Each calls
 * `useApplyScreen` in setup, which runs parent before child, so the LAST registration still mounted is
 * the deepest screen on the page. That is read, not restated: no list here mirrors the chain.
 *
 * ── THE RATE BUDGET: BATCHED, AND ON A BUCKET OF ITS OWN ─────────────────────────────────────────
 * A request per screen change would spend the intake's 20 a minute, which autosave is built to use 12
 * of. So visits are kept here and reported together: every `REPORT_EVERY_MS` while something changed,
 * when the phone is put away, and when the page closes — and the api counts these against their own
 * per-link bucket (`screenEventsLimiter`). A visit is reported open while it is showing, so a phone
 * that dies on a screen still leaves that screen behind, and closed once it is left; the server keeps
 * one row per visit (`applicationScreenEvents.ts`).
 *
 * ⚠ `keepalive` on every report, because the two that matter most are sent as the page is being put
 * away or closed, and a plain fetch is cancelled with the page. Not `sendBeacon`: it cannot send an
 * `application/json` body in every browser, and a text body would need a second parser on the api.
 *
 * ⚠ Kept in memory only. A visit is telemetry, not an answer; a tab killed before its report loses a
 * minute of it, and writing it to the phone (C3d1's stores) would put a second kind of thing in a
 * database that exists to keep the driver's answers.
 */

/** How often the page reports while something changed. */
export const REPORT_EVERY_MS = 60_000;

interface Registration {
  name: () => ApplyScreen | null;
}

interface ScreenTracker {
  register(r: Registration): () => void;
}

const KEY: InjectionKey<ScreenTracker> = Symbol("applyScreenEvents");

interface Visit extends ApplicationScreenEvent {
  /** Changed since it was last reported (a new visit, or one that has since closed). */
  dirty: boolean;
}

export function provideScreenEvents(token: Ref<string>): { current: Ref<ApplyScreen | null> } {
  const registrations = shallowRef<Registration[]>([]);
  const current = computed<ApplyScreen | null>(() => {
    const list = registrations.value;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const name = list[i]!.name();
      if (name) return name;
    }
    return null;
  });

  const visits = new Map<string, Visit>();
  let open: Visit | null = null;
  let stopped = false;

  const now = (): string => new Date().toISOString();

  function close(): void {
    if (!open) return;
    open.left_at = now();
    open.dirty = true;
    open = null;
  }

  function enter(screen: ApplyScreen): void {
    open = { id: crypto.randomUUID(), screen, entered_at: now(), left_at: null, dirty: true };
    visits.set(open.id, open);
  }

  const visible = (): boolean => typeof document === "undefined" || document.visibilityState !== "hidden";

  async function report(): Promise<void> {
    if (stopped || !token.value) return;
    const batch = [...visits.values()].filter((v) => v.dirty).slice(0, SCREEN_EVENTS_MAX);
    if (batch.length === 0) return;
    // What is sent is a copy: a visit that closes while the report is in flight stays dirty. Two reports
    // may overlap (the page put away while the minute's report is out) — deliberately not guarded,
    // because the server keeps one row per visit and the report as the page goes is the one that counts.
    const sent = batch.map((v) => ({ id: v.id, screen: v.screen, entered_at: v.entered_at, left_at: v.left_at }));
    try {
      await publicFetch(`/${encodeURIComponent(token.value)}/screen-events`, {
        method: "POST",
        keepalive: true,
        body: JSON.stringify({ sent_at: now(), events: sent }),
      });
      for (const s of sent) {
        const v = visits.get(s.id);
        if (!v || v.left_at !== s.left_at) continue;
        v.dirty = false;
        // A closed visit the server holds is done with.
        if (v.left_at !== null) visits.delete(v.id);
      }
    } catch (e) {
      // A dead link stops reporting; anything else (no signal, a 429) is kept for the next report.
      if ((e as { code?: string }).code === "invalid_link") stopped = true;
    }
  }

  watch(current, (screen) => {
    close();
    if (screen && visible()) enter(screen);
  });

  const onVisibility = (): void => {
    if (visible()) {
      if (!open && current.value) enter(current.value);
      return;
    }
    close();
    void report();
  };
  const onPageHide = (): void => {
    close();
    void report();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide);
  const timer = setInterval(() => void report(), REPORT_EVERY_MS);

  onScopeDispose(() => {
    clearInterval(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide);
    close();
    void report();
  });

  provide(KEY, {
    register(r) {
      registrations.value = [...registrations.value, r];
      return () => {
        registrations.value = registrations.value.filter((x) => x !== r);
      };
    },
  });
  return { current };
}

/**
 * This component is a screen, named `name` (null while it is not one — a flow still loading). Called
 * in setup; a component outside the applicant's page (a test mounting it alone) reports nothing.
 */
export function useApplyScreen(name: () => ApplyScreen | null): void {
  const tracker = inject(KEY, null);
  if (!tracker) return;
  const unregister = tracker.register({ name });
  onBeforeUnmount(unregister);
}
