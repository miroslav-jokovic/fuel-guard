import { nextTick, ref, watch, type Ref } from "vue";
import { useEventListener } from "@vueuse/core";
import { replaceEqualDeep, useMutation, useQueryClient } from "@tanstack/vue-query";
import { apiFetch } from "@/lib/api";

/**
 * "Show earlier" for a conversation, a channel's posts and a post's replies (OFFICE-CHAT-PLAN CH6a,
 * Q-CHAT16). The SQL and the API already page back — each page carries `before_seq`, the position to
 * ask above it — so this is only the web holding more than one page.
 *
 * WHERE THE PAGES LIVE: in the same query entry as the newest page, prepended. `chatRealtime.ts`'s
 * `applySync` merges into that entry and needs it gapless by `seq`; a page held beside it would give
 * the merge two places to look. The cost is that every refetch — the 10 s poll, a send, a signal —
 * answers with the newest page only, and would throw the earlier ones away. `keepEarlier` stops that:
 * it is the query's `structuralSharing`, which TanStack applies to EVERY write of the entry, a fetched
 * page and a `setQueryData` alike, against what the entry holds at that instant — so it is right
 * whatever order a refetch and an earlier page land in.
 *
 * A poll refreshes the newest page only. A line further up that somebody edits shows its edit through
 * `/sync` (which updates any line it holds), or on the next open; never wrongly, at worst late.
 */

interface Line {
  id: string;
  seq: number;
}
/** A page of lines under `field` (`messages` for a conversation, `posts` for a channel or replies). */
type Paged<K extends string> = { before_seq: number | null } & { readonly [k in K]: readonly Line[] };

/**
 * The newest page `next`, with the earlier lines `held` already had above it. Only when the two meet:
 * `next` starts at or below the last line `held` knows, so nothing can be missing between them. When
 * more than a page arrived since (`next` starts above everything held), the earlier lines are let go —
 * keeping them would show a hole as if it were the conversation.
 */
export function keepEarlier<K extends string, P extends Paged<K>>(field: K, held: P | undefined, next: P): P {
  const fresh = next[field];
  const top = fresh[0]?.seq;
  const known = held?.[field].at(-1)?.seq;
  // Already the start of the conversation, or nothing to join to.
  if (!held || next.before_seq === null || top === undefined || known === undefined || top > known) return next;
  const older = held[field].filter((l) => l.seq < top);
  if (older.length === 0) return next;
  return { ...next, [field]: [...older, ...fresh], before_seq: held.before_seq };
}

/** The `structuralSharing` for a paged query: keep the earlier pages, then TanStack's own sharing. */
export function keepEarlierSharing<K extends string>(field: K) {
  return (old: unknown, next: unknown): unknown =>
    replaceEqualDeep(old, keepEarlier(field, old as Paged<K> | undefined, next as Paged<K>));
}

/**
 * `held` with `page` — the lines above it — on top. Null when `held` has moved since the page was asked
 * for (a refetch that could not meet the earlier lines replaced it): the page no longer joins anything.
 */
export function prependEarlier<K extends string, P extends Paged<K>>(field: K, held: P, page: Paged<K>, askedBefore: number): P | null {
  if (held.before_seq !== askedBefore) return null;
  const top = held[field][0]?.seq ?? Number.POSITIVE_INFINITY;
  return { ...held, [field]: [...page[field].filter((l) => l.seq < top), ...held[field]], before_seq: page.before_seq };
}

/**
 * Load the page above what `key` holds, from `path(before_seq)`, and put it on top. The page knows
 * nothing of the request: what to ask comes from the cache at the moment of asking.
 */
export function useLoadEarlier<K extends string>(field: K, key: () => readonly unknown[] | null, path: (before: number) => string | null) {
  const qc = useQueryClient();
  const load = useMutation({
    mutationFn: async () => {
      const k = key();
      const before = k ? qc.getQueryData<Paged<K>>(k)?.before_seq : null;
      const url = before ? path(before) : null;
      if (!k || !before || !url) return;
      const res = await apiFetch<Paged<K>>(url);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load the earlier lines.");
      const page = res.data;
      qc.setQueryData<Paged<K>>(k, (held) => (held ? prependEarlier(field, held, page, before) ?? held : held));
    },
  });
  // A different conversation, channel or post starts with no error of the last one's.
  watch(() => JSON.stringify(key()), () => load.reset());
  return load;
}

/** What `useChatScroll` watches: the list's ends, and enough about the newest line to decide. */
export interface ChatScrollSource {
  /** The thread, or the post for a thread: another one opens at its newest line. */
  view: string;
  first: string | undefined;
  last: string | undefined;
  /** How many lines the list holds, so a new newest line says how many came with it. */
  count: number;
  /** The newest line is the reader's own — a send, pending or confirmed — which is always followed. */
  lastOwn: boolean;
  /**
   * How many files the newest line shows (CH7). A sent line keeps its key from "Sending 2 files…" to the
   * confirmed line, which then draws its thumbnails and cards: the same end, a few hundred pixels taller.
   * Unwatched, a reader at the bottom was left looking at the top of their own photo.
   */
  lastFiles?: number;
}

/** Within this of the bottom the reader is "at the bottom": a new line is followed, not counted. */
export const NEAR_BOTTOM_PX = 100;

/**
 * Keep a list of lines at its newest line when one arrives, or when another list opens. When lines
 * arrive ABOVE (an earlier page) the line the person was reading stays where it was; when neither end
 * moved (an edit, a poll that brought nothing) the list does not move either — somebody reading two
 * pages up is not pulled down by a refresh.
 *
 * Nor by a new line (CHAT-REDESIGN-PLAN D-CHATUI17): when the reader is more than `NEAR_BOTTOM_PX` up
 * the log and somebody else's line arrives, the log stays where they are reading and `unseen` counts
 * the lines that came — the caller draws it as "N new messages" with the way down, `jump`. Their own
 * line is followed wherever they are: they sent it, they want to see it land. Reaching the bottom by
 * hand reads the count away. One owner of the scroll position, as before: the pill is this watcher's
 * other answer, not a second scroller.
 *
 * Runs before the DOM updates (the watcher's default flush), so the old height is still there to
 * measure; `scrollTop`, not `scrollTo()`, because jsdom builds it on every element.
 */
export function useChatScroll(scroller: Ref<HTMLElement | null>, source: () => ChatScrollSource) {
  const unseen = ref(0);
  const nearBottom = () => {
    const el = scroller.value;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
  };
  /** To the newest line, and nothing is unseen. */
  function jump() {
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
    unseen.value = 0;
  }
  watch(
    source,
    async (now, old) => {
      const sameView = old !== undefined && now.view === old.view;
      const sameEnd = sameView && now.last === old.last;
      if (sameEnd && now.first === old.first) {
        // The newest line grew under a reader at the bottom (its files drew): keep them at the bottom.
        // Measured now, before the DOM has the files — the reader's place as it was.
        if ((now.lastFiles ?? 0) !== (old.lastFiles ?? 0) && nearBottom()) {
          await nextTick();
          jump();
        }
        return;
      }
      if (sameEnd) {
        // An earlier page landed above: the line being read stays where it was.
        const fromBottom = scroller.value ? scroller.value.scrollHeight - scroller.value.scrollTop : 0;
        await nextTick();
        const el = scroller.value;
        if (el) el.scrollTop = el.scrollHeight - fromBottom;
        return;
      }
      if (sameView && !now.lastOwn && !nearBottom()) {
        // Somebody's line, with the reader up the log: count it, leave them where they are. When the
        // page above landed in the same tick the count cannot say how many were new; one is certain.
        unseen.value += now.first === old.first ? Math.max(1, now.count - old.count) : 1;
        return;
      }
      await nextTick();
      jump();
    },
    { immediate: true },
  );
  useEventListener(scroller, "scroll", () => {
    if (unseen.value > 0 && nearBottom()) unseen.value = 0;
  });
  return { unseen, jump };
}

/** The key a merged line renders under, server or pending — what `useChatScroll` compares. */
export const lineKey = (l: { kind: "server"; message: { id: string } } | { kind: "local"; line: { message_id: string } }) =>
  l.kind === "server" ? l.message.id : l.line.message_id;
