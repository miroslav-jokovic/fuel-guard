import { computed, onMounted, ref, type Ref } from "vue";
import { useEventListener, useResizeObserver } from "@vueuse/core";

/**
 * Where the Ask AI launcher sits, and the drag that moves it (owner, 2026-10-09: "sometimes it is
 * blocking some data we need to see").
 *
 * ── Why the position is measured from the BOTTOM-RIGHT, not the top-left ────────────────────────
 * The launcher's home is the bottom-right corner, and a corner should stay a corner when the window
 * changes size. Stored as distance from the right and bottom edges, a launcher parked in the corner
 * follows it through a resize; stored as `left`/`top`, the same launcher would be stranded mid-screen
 * the moment the window grew, or pushed off it the moment it shrank.
 *
 * ── Why a drag threshold ────────────────────────────────────────────────────────────────────────
 * The launcher is a button first. A hand that wobbles a couple of pixels while clicking must still
 * open the dock, so a press only becomes a drag once it has travelled `DRAG_THRESHOLD` pixels, and
 * the click that a browser fires at the end of a real drag is swallowed (`consumeClick`) — otherwise
 * every move would end by opening the dock over the data the person just uncovered.
 *
 * ── Why it stays right of the sidebar ───────────────────────────────────────────────────────────
 * The sidebar sits on `z-dialog`, above the launcher's `z-chrome` on purpose (see the launcher), so a
 * launcher dragged over it would vanish beneath it. The bound is the left edge of `#main-content`,
 * MEASURED and re-measured whenever that region resizes, never a copy of the sidebar's width: the
 * sidebar collapses, and a width restated here would be wrong in one of its two states.
 *
 * ── Why localStorage ────────────────────────────────────────────────────────────────────────────
 * Same reasoning as `useColorScheme`: where a person likes the button is a preference of this
 * person on this screen, not organisation data, and it must survive a reload without a round trip.
 */
const STORAGE_KEY = "fg.assistant-launcher";
/** The resting gap from the viewport's edges: `right-6 bottom-6`, the launcher's home. */
export const HOME_OFFSET = 24;
/** Never closer to an edge than this, so the glow and focus ring stay on screen. */
export const EDGE_MARGIN = 8;
export const DRAG_THRESHOLD = 4;

export interface LauncherOffset {
  right: number;
  bottom: number;
}

function read(): LauncherOffset {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (parsed && typeof parsed === "object") {
      const { right, bottom } = parsed as Record<string, unknown>;
      if (Number.isFinite(right) && Number.isFinite(bottom)) return { right: right as number, bottom: bottom as number };
    }
  } catch {
    // Unparseable or unreadable (Safari private mode throws) — the corner is the honest default.
  }
  return { right: HOME_OFFSET, bottom: HOME_OFFSET };
}

function write(offset: LauncherOffset) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(offset));
  } catch {
    // A position that cannot be stored still holds for this session.
  }
}

/** The area the launcher may occupy: the window, less whatever chrome on its left sits above it. */
export interface LauncherBounds {
  width: number;
  height: number;
  /** Where the page's content starts — the sidebar's right edge on desktop, 0 when it is a drawer. */
  left?: number;
}

/** Keeps the whole launcher on screen, however small the window became since it was parked. */
export function clampOffset(offset: LauncherOffset, size: number, viewport: LauncherBounds): LauncherOffset {
  const clamp = (v: number, max: number) => Math.round(Math.min(Math.max(v, EDGE_MARGIN), Math.max(EDGE_MARGIN, max)));
  return {
    right: clamp(offset.right, viewport.width - (viewport.left ?? 0) - size - EDGE_MARGIN),
    bottom: clamp(offset.bottom, viewport.height - size - EDGE_MARGIN),
  };
}

export interface DockAnchor {
  x: "left" | "right";
  y: "top" | "bottom";
  /** The launcher's own distance from the `x` and `y` edges — where the dock's corner goes. */
  xPx: number;
  yPx: number;
}

/**
 * The dock grows out of the launcher's corner: right-anchored when the launcher is on the right half
 * of the window, top-anchored when it is on the upper half, so it unfolds over the space the person
 * moved the launcher into rather than back over what they moved it off.
 */
export function dockAnchor(offset: LauncherOffset, size: number, viewport: LauncherBounds): DockAnchor {
  const left = viewport.width - offset.right - size;
  const top = viewport.height - offset.bottom - size;
  const onRight = left + size / 2 > viewport.width / 2;
  const onBottom = top + size / 2 > viewport.height / 2;
  return {
    x: onRight ? "right" : "left",
    y: onBottom ? "bottom" : "top",
    xPx: onRight ? offset.right : left,
    yPx: onBottom ? offset.bottom : top,
  };
}

export function useLauncherPosition(target: Ref<HTMLElement | null>, size: number) {
  const content = ref<HTMLElement | null>(null);
  const bounds = ref<LauncherBounds>({ width: 0, height: 0, left: 0 });

  /**
   * The bounds are measured, all three together, never cached from one moment:
   *  - width/height WITHOUT the scrollbar, because `right` on a fixed element is measured from inside
   *    it. vueuse's `useWindowSize` reads that only on mount and on `resize`, and the scrollbar
   *    arrives later, when the page's data makes it tall — no `resize` fires, and the launcher sat
   *    15px past the sidebar's edge (measured in Chromium 2026-10-09).
   *  - left is `#main-content`'s left edge (see the header).
   * So: on window resize, whenever the content region resizes (the sidebar collapsing, the scrollbar
   * appearing — both change its width), and at every press, the moment the numbers matter most.
   */
  function measure() {
    const root = document.documentElement;
    bounds.value = {
      // jsdom lays nothing out and reports 0; the window's own size is the honest fallback there.
      width: root.clientWidth || window.innerWidth,
      height: root.clientHeight || window.innerHeight,
      left: content.value?.getBoundingClientRect().left ?? 0,
    };
  }
  measure();
  onMounted(() => {
    content.value = document.getElementById("main-content");
    measure();
  });
  useEventListener(window, "resize", measure, { passive: true });
  useResizeObserver(content, measure);

  const stored = ref<LauncherOffset>(read());
  /** What is rendered: the stored position, re-clamped against the CURRENT bounds on every resize. */
  const offset = computed(() => clampOffset(stored.value, size, bounds.value));

  const dragging = ref(false);
  let press: { x: number; y: number; from: LauncherOffset; pointerId: number } | null = null;
  let swallowClick = false;

  useEventListener(target, "pointerdown", (e: PointerEvent) => {
    // The primary button only: a right-click opens the context menu and must not pick the launcher up.
    if (e.button !== 0) return;
    // A drag whose release fired no click (it ended off the button) must not eat the next real one.
    swallowClick = false;
    measure();
    press = { x: e.clientX, y: e.clientY, from: offset.value, pointerId: e.pointerId };
    // Both at the press, not once the threshold is crossed: until then the browser still owns the
    // gesture, and a quick drag was turned into a native drag of something else on the page and
    // cancelled (measured in Chromium 2026-10-09 — `dragstart` on an <a>, then `pointercancel`,
    // with capture alone not enough to stop it). Cancelling `pointerdown` suppresses the mouse
    // events that start a native drag or a text selection; `click` still fires, so the button
    // still works. jsdom has no capture, hence the `?.`.
    e.preventDefault();
    target.value?.setPointerCapture?.(e.pointerId);
  });

  /**
   * Move and release are heard on `window` as well as through the capture: a captured event still
   * bubbles there, and a browser that refuses capture must not leave the launcher stuck mid-drag.
   */
  useEventListener(window, "pointermove", (e: PointerEvent) => {
    if (!press || e.pointerId !== press.pointerId) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!dragging.value) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      dragging.value = true;
    }
    e.preventDefault();
    stored.value = clampOffset({ right: press.from.right - dx, bottom: press.from.bottom - dy }, size, bounds.value);
  });

  function release(e: PointerEvent) {
    if (!press || e.pointerId !== press.pointerId) return;
    press = null;
    if (!dragging.value) return;
    dragging.value = false;
    swallowClick = true;
    write(stored.value);
  }
  useEventListener(window, "pointerup", release);
  useEventListener(window, "pointercancel", release);

  return {
    offset,
    dragging,
    anchor: computed(() => dockAnchor(offset.value, size, bounds.value)),
    /** True exactly once after a drag ends — the click the browser fires on release is not a click. */
    consumeClick() {
      const was = swallowClick;
      swallowClick = false;
      return was;
    },
  };
}
