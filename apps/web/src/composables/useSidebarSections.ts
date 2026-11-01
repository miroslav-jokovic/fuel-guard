import { ref, watch } from "vue";

/**
 * Which sidebar sections are open (phase 6; reversed by SIDEBAR-REDESIGN-PLAN.md D-SB3).
 *
 * ── The problem this solves ─────────────────────────────────────────────────────────────────────
 * Every section and every item was visible at once, so the nav scrolled, and a scrolling nav is one
 * where you cannot see where you are. Phase 6 made sections collapsible but left them all OPEN by
 * default, which kept the wall for everybody who never clicked a header — measured 2026-11-01, an
 * admin's sidebar was about 2,000 px tall in an ~800 px window. D-SB3 flips the default: only the
 * section holding the page you are on starts open; everything else is a header with a badge total.
 *
 * ── Why it stores explicit ANSWERS rather than a set of changed things ──────────────────────────
 * Phase 6 stored "the sections that differ from the default" (`useDeviationSet`), which was right
 * while the default was a constant. It is not any more: the default is "open if it holds the current
 * page", so it moves every time you navigate, and a set of differences from a moving default changes
 * meaning under the reader's feet. So each section the reader has touched stores what they chose,
 * `true` or `false`, and an untouched section follows the route.
 *
 * Keyed by group KEY, not label, which is also new: this redesign renamed groups' contents and may
 * rename a group, and a stored label would silently stop matching. That is why the storage key
 * changed (`fg.sidebar-collapsed` held labels, and meant the opposite thing); the old one is simply
 * no longer read, which costs a reader one click on a section they had closed.
 *
 * ── One rule still overrides the preference ─────────────────────────────────────────────────────
 * Arriving in a section you had closed reopens it (the `false` is forgotten), so a deep link, a
 * redirect after sign-in or the ⌘K palette can never land you on a page whose own section is shut
 * — the nav would be lying about where you are. Closing it again WHILE you stand there is allowed:
 * you just watched yourself do it, so nothing is hidden from you.
 */
const STORAGE_KEY = "fg.sidebar-sections";

function read(): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, boolean] => typeof e[1] === "boolean"));
  } catch {
    // No storage — Safari private mode throws, and this project's own jsdom has none at all.
    return {};
  }
}

/** Module-level: one sidebar, one set of answers, however many components (drawer, desktop) ask. */
const answers = ref<Record<string, boolean>>(read());

function write(next: Record<string, boolean>) {
  answers.value = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A preference that cannot be stored still applies for this session.
  }
}

export function useSidebarSections(currentSection: () => string | null) {
  // Arriving in a section the reader had closed reopens it — see the header.
  watch(
    currentSection,
    (key) => {
      if (key && answers.value[key] === false) {
        const { [key]: _forgotten, ...rest } = answers.value;
        write(rest);
      }
    },
    { immediate: true },
  );

  const isOpen = (key: string) => answers.value[key] ?? key === currentSection();

  return {
    isOpen,
    toggle: (key: string) => write({ ...answers.value, [key]: !isOpen(key) }),
  };
}

/** Tests only: module state outlives a test, and a fresh read is what a new page load does. */
export function resetSidebarSectionsForTest() {
  answers.value = read();
}
