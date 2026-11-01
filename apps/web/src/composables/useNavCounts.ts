import { computed, type ComputedRef } from "vue";
import { moduleEnabled, type ModuleKey } from "@silvicom/shared";
import { useSessionStore } from "@/stores/session";
import type { useModulesQuery } from "@/composables/useModules";
import { useOpens } from "@/composables/useOpens";
import type { NavCounts } from "@/lib/nav";
import { useHazmatReviewCountQuery } from "@/features/hazmat/useHazmatReview";
import { useThreadsQuery } from "@/features/messages/useMessages";
import { useChatInboxQuery } from "@/features/chat/useChat";
import { useChatRealtime } from "@/features/chat/chatRealtime";
import { useChatDesktopAlerts } from "@/features/chat/useChatDesktopAlerts";

/**
 * The live counts beside sidebar entries (`NavCounts`), each asked only when its entry can show, and
 * each from the SAME query its page runs, so the badge and the page are one fetch and cannot disagree.
 *
 * Moved out of `AppShell.vue` when office chat added the third count (OFFICE-CHAT-PLAN CH2) and the
 * shell had no lines left under its budget; it was already three queries' worth of feature knowledge
 * the layout had no reason to hold.
 */
export function useNavCounts(modules: ReturnType<typeof useModulesQuery>): ComputedRef<NavCounts> {
  const session = useSessionStore();
  const opens = useOpens();
  const has = (key: ModuleKey) => moduleEnabled(modules.data.value ?? null, key);

  // Pending hazmat reviews — only when the module and view access are present.
  const reviewCount = useHazmatReviewCountQuery(computed(() => session.canView("hazmat") && has("hazmatguard")));
  // Driver messages unread (Phase 7) — the dispatch inbox's own query.
  const threads = useThreadsQuery(computed(() => session.canView("dispatch") && has("messages")));
  // Office chat unread (CH2) — asked when /chat opens for this caller (the guard's own answer, SP5)
  // and the plan has Messages; the inbox query /chat itself runs.
  const chatOpen = computed(() => opens("/chat") && has("messages"));
  const chat = useChatInboxQuery(chatOpen);
  // ...and kept live by the tab's realtime link (CH3b): a message to me moves the badge at once, on any
  // page, and the poll behind it relaxes to 60 s.
  useChatRealtime(chatOpen);
  // ...and, when the person turned them on in this browser, the desktop alerts that same inbox and
  // Activity owe (CH6d) — on every page, as the badge is.
  useChatDesktopAlerts(chatOpen, computed(() => chat.data.value?.conversations));

  return computed(() => ({
    hazmatReview: reviewCount.data.value ?? 0,
    messagesUnread: threads.data.value?.unread_total ?? 0,
    chatUnread: chat.data.value?.unread_total ?? 0,
  }));
}
