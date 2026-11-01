import { computed, ref, watch, type Ref } from "vue";
import type { NavGroup } from "@/lib/nav";
import { MAX_PINNED, pushHistory, recentItems, resolveKeys, togglePin } from "@/lib/sidebarShortcuts";

/**
 * Pinned and Recent's state (D-SB2): two lists of surface keys in `localStorage`, read back through
 * `lib/sidebarShortcuts.ts` against the live sidebar, which is where the reasoning lives.
 *
 * Per DEVICE, like the collapsed sidebar and the colour scheme, and for the same reason: it is chrome
 * state about how this person works at this desk. A dispatcher's night-shift pins are not an org
 * setting, and storing them server-side would need a table, an RLS policy and a retention answer for
 * a list of six strings. If people ask for pins to follow them between machines, that is Q-SB2.
 */
const PINNED_KEY = "fg.sidebar-pinned";
const HISTORY_KEY = "fg.sidebar-recent";

function read(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
function write(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A preference that cannot be stored still applies for this session.
  }
}

/** Module-level, like the sections: the drawer and the desktop sidebar show one set of pins. */
const pinnedKeys = ref<string[]>(read(PINNED_KEY));
const historyKeys = ref<string[]>(read(HISTORY_KEY));

export function useSidebarShortcuts(groups: Ref<NavGroup[]>, currentKey: () => string | null) {
  // Pins and history are filtered by what this caller can reach NOW (see `resolveKeys`), so a stale
  // key in storage is harmless; the reachable ones are what `pinFull` counts, so an unreachable
  // leftover never blocks a new pin.
  const pinned = computed(() => resolveKeys(groups.value, pinnedKeys.value));
  const recent = computed(() => recentItems(groups.value, historyKeys.value, pinnedKeys.value, currentKey()));
  const pinFull = computed(() => pinned.value.length >= MAX_PINNED);

  return {
    pinned,
    recent,
    pinFull,
    isPinned: (key: string) => pinnedKeys.value.includes(key),
    togglePin(key: string) {
      // Drop unreachable leftovers first, so they do not count against the six.
      const live = pinned.value.map((i) => i.key);
      pinnedKeys.value = togglePin(live, key);
      write(PINNED_KEY, pinnedKeys.value);
    },
  };
}

/**
 * Records each sidebar page you land on. Called ONCE, by the shell, rather than by the sidebar: the
 * drawer and the desktop sidebar are two instances, and two watchers would record every visit twice
 * (harmless with `pushHistory`, but a second writer is a second thing to reason about).
 */
export function useRecordSidebarVisits(currentKey: () => string | null) {
  watch(
    currentKey,
    (key) => {
      if (!key) return;
      historyKeys.value = pushHistory(historyKeys.value, key);
      write(HISTORY_KEY, historyKeys.value);
    },
    { immediate: true },
  );
}

/** Tests only: re-read storage, which is what a new page load does. */
export function resetSidebarShortcutsForTest() {
  pinnedKeys.value = read(PINNED_KEY);
  historyKeys.value = read(HISTORY_KEY);
}
