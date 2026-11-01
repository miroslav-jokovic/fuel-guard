import { computed, ref, watch, type Ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import type { ChatActivityResponse, ChatConversation, ChatDirectoryEntry } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { useSessionStore } from "@/stores/session";
import { activityAlerts, inboxAlerts, type DesktopAlert, type OnScreen } from "./chatDesktopAlerts";
import { activityKey, CHAT_KEY } from "./useChat";

/**
 * Desktop alerts for office chat (OFFICE-CHAT-PLAN CH6d; Q-CHAT4 (a): while the tab is open; Q-CHAT18 (a)).
 *
 * Web only, no server change: it watches what the tab already fetches. The inbox the sidebar badge runs
 * (`useNavCounts`) is refetched by the realtime link on every signal, so a new direct or group line
 * reaches it within a second, on any page. Mentions and replies come from Activity: its unread count is
 * asked only while alerts are on, and a rise fetches the newest page once. `chatDesktopAlerts.ts` decides
 * what rings; this file only watches, remembers what already rang, and calls the browser.
 *
 * THE PERSON'S CHOICE is per browser (`localStorage`), because the browser's permission is: alerts on
 * the office PC, not on the phone the same person reads at night. Off until they press Turn on — the
 * browser shows its permission prompt only after a press, and a prompt on page load is the pattern
 * every browser now demotes. `choice` is `on`, `off` (they said Not now or turned it off), or null
 * (never asked: the rail offers it).
 *
 * Clicking an alert brings the tab forward and opens the line where it lives.
 */
const STORAGE_KEY = "fg.chat.desktop-alerts";
export type AlertsChoice = "on" | "off" | null;
export type AlertsPermission = "unsupported" | "default" | "granted" | "denied";

function readChoice(): AlertsChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "on" || v === "off" ? v : null;
  } catch {
    return null; // Safari private mode throws on localStorage
  }
}
const permissionNow = (): AlertsPermission =>
  typeof window === "undefined" || !("Notification" in window) ? "unsupported" : (Notification.permission as AlertsPermission);

// One state for the whole tab: the rail's control and the shell's watcher read the same refs.
const choice = ref<AlertsChoice>(readChoice());
const permission = ref<AlertsPermission>(permissionNow());

function store(v: AlertsChoice) {
  choice.value = v;
  try {
    if (v) localStorage.setItem(STORAGE_KEY, v);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* the choice still holds for this tab */ }
}

/** The rail's control: the state, and the two presses. */
export function useChatDesktopAlertsChoice() {
  const on = computed(() => choice.value === "on" && permission.value === "granted");
  /** Must run inside a click: the browser refuses a permission prompt that no press asked for. */
  async function turnOn() {
    if (permission.value === "unsupported") return;
    if (permission.value !== "granted") permission.value = (await Notification.requestPermission()) as AlertsPermission;
    store(permission.value === "granted" ? "on" : "off");
  }
  const turnOff = () => store("off");
  return { choice, permission, on, turnOn, turnOff };
}

async function unwrap<T>(p: ReturnType<typeof apiFetch<T>>): Promise<T | null> {
  const res = await p;
  return res.ok && res.data ? res.data : null;
}

/**
 * The shell's watcher. `inbox` is the badge's query (every kind), so this adds no request of its own
 * for direct and group lines; `enabled` is the badge's own gate (chat open to the caller, plan has it).
 */
export function useChatDesktopAlerts(enabled: Ref<boolean>, inbox: Ref<ChatConversation[] | undefined>) {
  const session = useSessionStore();
  const route = useRoute();
  const router = useRouter();
  const { on } = useChatDesktopAlertsChoice();
  const live = computed(() => enabled.value && on.value);

  // Names for the `<@id>` tokens in an alert's text: the people list /chat already caches.
  const people = useQuery({
    queryKey: [...CHAT_KEY, "people"],
    enabled: live,
    queryFn: async () => (await unwrap(apiFetch<{ people: ChatDirectoryEntry[] }>("/api/chat/people")))?.people ?? [],
    staleTime: 5 * 60_000,
  });
  const nameOf = (id: string) => people.data.value?.find((p) => p.user_id.toLowerCase() === id)?.name ?? null;

  const screen = (): OnScreen => {
    const q = route.query;
    const open = route.path === "/chat" ? (typeof q.c === "string" ? q.c : typeof q.ch === "string" ? q.ch : null) : null;
    return { visible: document.visibilityState === "visible", threadId: open };
  };

  const rung = new Set<string>();
  function ring(alerts: DesktopAlert[]) {
    for (const a of alerts) {
      if (rung.has(a.messageId)) continue;
      rung.add(a.messageId);
      try {
        const n = new Notification(a.title, { body: a.body, tag: `chat:${a.threadId}` });
        n.onclick = () => {
          window.focus();
          void router.push({ path: "/chat", query: a.query });
          n.close();
        };
      } catch { /* a browser that grants but cannot construct (some mobile ones) simply does not ring */ }
    }
  }

  // ── direct and group lines, from the badge's inbox ──
  let lastInbox: ChatConversation[] | null = null;
  watch(
    () => (live.value ? inbox.value : undefined),
    (next) => {
      if (!next) { lastInbox = null; return; } // off, or not loaded: the next snapshot is a baseline again
      ring(inboxAlerts(lastInbox, next, session.userId ?? "", screen(), nameOf));
      lastInbox = next;
    },
    { immediate: true },
  );

  // ── mentions and replies, from Activity: the count while on; the page only when it rises ──
  const unread = useQuery({
    queryKey: [...activityKey, "unread"],
    enabled: live,
    queryFn: async () => (await unwrap(apiFetch<{ unread: number }>("/api/chat/activity/unread")))?.unread ?? 0,
    refetchInterval: 60_000,
  });
  let seen: Set<string> | null = null;
  watch(
    () => (live.value ? unread.data.value : undefined),
    async (count, before) => {
      if (count === undefined) { seen = null; return; }
      const firstLook = seen === null;
      if (!firstLook && (before === undefined || count <= before)) return;
      const page = await unwrap(apiFetch<ChatActivityResponse>("/api/chat/activity?limit=20"));
      if (!page) return;
      if (firstLook) { seen = new Set(page.items.map((i) => i.message_id)); return; } // a baseline, not news
      const mutedOf = (id: string) => inbox.value?.find((c) => c.thread_id === id)?.muted;
      ring(activityAlerts(page.items, seen!, mutedOf, screen(), nameOf));
      for (const i of page.items) seen!.add(i.message_id);
    },
    { immediate: true },
  );
}
