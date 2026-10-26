import { onBeforeUnmount, onMounted } from "vue";

/**
 * The page's keys (CHAT-REDESIGN-PLAN CR2, D-CHATUI16): `/` puts the caret in the rail's search; J and K
 * open the next and the previous item in the rail, top to bottom, the way Linear walks a list. They act
 * only where nothing is being typed — not in a field, not inside a dialog or an open menu — and never
 * with a modifier held, so the browser's own keys (⌘K, ⌘/) stay its own. Up from an empty composer into
 * the log, and the arrows along it, are the log's (`ChatMessageList`), not the page's.
 */
export type ChatShortcut = "search" | "next" | "previous";

type KeyLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "defaultPrevented" | "target">;

/** Which shortcut a key press is, or null when it is typing, a modifier chord, or not one of ours. */
export function chatShortcutOf(e: KeyLike): ChatShortcut | null {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return null;
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest("input, textarea, select, [contenteditable], [role='dialog'], [role='menu']")) return null;
  switch (e.key) {
    case "/": return "search";
    case "j": return "next";
    case "k": return "previous";
    default: return null;
  }
}

/** Listen for the page's keys while the page is mounted, and hand each one to `act`. */
export function useChatShortcuts(act: (shortcut: ChatShortcut) => void) {
  const onKey = (e: KeyboardEvent) => {
    const shortcut = chatShortcutOf(e);
    if (!shortcut) return;
    e.preventDefault();
    act(shortcut);
  };
  onMounted(() => window.addEventListener("keydown", onKey));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
}
