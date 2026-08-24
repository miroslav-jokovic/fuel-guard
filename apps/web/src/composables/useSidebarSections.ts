import { computed, ref } from "vue";

/**
 * Which sidebar sections are collapsed (phase 6).
 *
 * ── The problem this solves ─────────────────────────────────────────────────────────────────────
 * Every section and every item was visible at once — six labelled groups plus the ungrouped top —
 * so the nav scrolled, and a scrolling nav is one where you cannot see where you are. The confusion
 * is structural rather than cosmetic: a list long enough to scroll asks the reader to hold its shape
 * in their head.
 *
 * ── Why this stores what is CLOSED, not what is open ────────────────────────────────────────────
 * The first draft stored open sections, and it was wrong in a way worth recording. Nothing is stored
 * until someone expresses a preference, so the set starts empty — but the sidebar starts fully
 * expanded, which is the opposite. Clicking a section to close it would ADD it to the "open" set and
 * leave it open. The displayed state and the stored state disagreed at exactly the moment the two
 * first had to meet.
 *
 * Storing the closed ones removes the contradiction rather than patching it: empty means nothing is
 * collapsed, which is precisely today's behaviour, and every toggle after that is symmetric.
 *
 * ── One rule overrides the preference ───────────────────────────────────────────────────────────
 * The section containing the CURRENT route is always open, whatever was stored. Otherwise a deep
 * link, a redirect after sign-in, or a notification lands you on a page whose own section is
 * collapsed, and the nav is actively lying about where you are. Remembered state decides what else
 * is open; it never decides to hide the page you are on.
 */
const STORAGE_KEY = "fg.sidebar-collapsed";

function read(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    // No storage — Safari private mode throws, and this project's own jsdom has none at all.
    return new Set();
  }
}

/** Module-level: one sidebar, one set of collapsed sections, however many components ask. */
const collapsed = ref<Set<string>>(read());

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsed.value]));
  } catch {
    // A preference that cannot be stored still applies for this session.
  }
}

export function useSidebarSections(currentSection: () => string | null) {
  const isOpen = (label: string) => label === currentSection() || !collapsed.value.has(label);

  function toggle(label: string) {
    const next = new Set(collapsed.value);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    collapsed.value = next;
    persist();
  }

  return {
    isOpen,
    toggle,
    /** Exposed for tests and for a future "expand all" affordance. */
    collapsedCount: computed(() => collapsed.value.size),
  };
}
