import { computed, inject, provide, type InjectionKey, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { CHAT_LINE_LINKS_MAX, type ChatLineLink, type ChatLineLinksResponse, type ChatMessage } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { CHAT_KEY, unwrap } from "./useChat";

/**
 * Load and truck numbers in the lines on screen, as links (CHAT-REDESIGN-PLAN Q-CHATUI6 (a); 0547). The
 * server decides which words are records — the web never guesses — so the log asks once for all its live
 * lines, in requests of at most 200 (`CHAT_LINE_LINKS_MAX`). Keyed by each line's id AND rev: an edit
 * changes the rev, so the edited words are asked about again, and nothing else is.
 *
 * A line with nothing that could be a number is not asked about — that is not guessing at records, only
 * not asking the server about "ok" or "on my way".
 */
const MAYBE = /[0-9]/;

export function useChatLineLinks(messages: Ref<readonly Pick<ChatMessage, "id" | "rev" | "body" | "deleted_at">[]>) {
  const asked = computed(() => messages.value.filter((m) => !m.deleted_at && !!m.body && MAYBE.test(m.body)));
  const key = computed(() => asked.value.map((m) => `${m.id}:${m.rev}`).sort());
  const q = useQuery({
    queryKey: computed(() => [...CHAT_KEY, "links", key.value] as const),
    enabled: computed(() => asked.value.length > 0),
    staleTime: Infinity,
    queryFn: async () => {
      const ids = asked.value.map((m) => m.id);
      const links: ChatLineLink[] = [];
      for (let i = 0; i < ids.length; i += CHAT_LINE_LINKS_MAX) {
        const page = await unwrap(
          apiFetch<ChatLineLinksResponse>("/api/chat/links", { method: "POST", body: { message_ids: ids.slice(i, i + CHAT_LINE_LINKS_MAX) } }),
          "Could not read the links in these messages.",
        );
        links.push(...page.links);
      }
      return links;
    },
  });
  /** Each line's links; a line without any is absent. A failed ask leaves the words as words. */
  const byLine = computed(() => {
    const m = new Map<string, ChatLineLink[]>();
    for (const l of q.data.value ?? []) m.set(l.message_id, [...(m.get(l.message_id) ?? []), l]);
    return m;
  });
  return { byLine, query: q };
}

/**
 * The chat page turns links on for every log under it (`provideChatLineLinks`), as it provides the line
 * acts (`provideChatLineActs`): a log anywhere else — the compliance console's, a test's — draws none and
 * asks nothing.
 */
const LINKS_ON: InjectionKey<true> = Symbol("chat-line-links");
export function provideChatLineLinks(): void {
  provide(LINKS_ON, true);
}
export function useChatLineLinksHere(messages: Ref<readonly Pick<ChatMessage, "id" | "rev" | "body" | "deleted_at">[]>) {
  return inject(LINKS_ON, null) ? useChatLineLinks(messages) : { byLine: computed(() => new Map<string, ChatLineLink[]>()) };
}
