import { computed, readonly, ref, shallowRef } from "vue";
import { supabase } from "@/lib/supabase";

/**
 * Office chat's realtime seam (OFFICE-CHAT-PLAN CH3b, D-CHAT10): the ONLY file in the web app that
 * touches Supabase Realtime. Outgrowing Supabase means replacing this file, not the page.
 *
 * WHAT IT HEARS. Migration 0513 announces every change to a conversation on two PRIVATE topics:
 *   chat:user:<me>   my own topic — "a conversation of mine moved" (conversations of ≤ 50 people)
 *   chat:conv:<id>   the open conversation's topic — "it is now at seq N / rev R"
 * Two subscriptions per tab, whatever the number of conversations (plan §3). The payload is a signal,
 * never content (D-CHAT2): whoever hears one asks the API, which authorises THAT request, so the
 * subscribe-time-only check Supabase documents cannot leak a word to somebody removed mid-session.
 *
 * WHAT IT DOES NOT DO. It fetches nothing and knows nothing of the query cache — `useChat.ts` decides
 * what a signal means (invalidate the inbox, sync the open conversation). It never broadcasts: 0513
 * gives the browser no INSERT policy, so a signal cannot be forged from a tab.
 *
 * STATE. `live` only while every channel it wants is SUBSCRIBED. Anything else after the first join is
 * `reconnecting` — the page says so, and the polls drop back from 60 s to their fast pace (D-CHAT2:
 * realtime is the speed, the poll is the guarantee). A channel that comes back calls `onResume`, so
 * whatever was announced while it was away is fetched once rather than waited for (Supabase replays
 * only a short window on rejoin; the sync is what makes it complete).
 *
 * AUTH. `private: true` channels are joined with the socket's token, so `setAuth()` runs first — with no
 * argument it reads the signed-in session through the client's `accessToken` callback — and supabase-js
 * repeats it on every token refresh by itself (`_handleTokenChanged`, supabase-js 2.110). JSON payloads
 * only: binary broadcasts would need ≥ 2.91 on every client (plan §7).
 */

export type ChatLinkState = "off" | "connecting" | "live" | "reconnecting";

/** 0513's payload, exactly. */
export interface ChatSignal {
  thread_id: string;
  seq: number;
  rev: number;
  kind: string;
  op: "message" | "change";
}

type SubscribeStatus = "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";

/** The slice of a Realtime channel this file uses, so a test can stand in for Supabase. */
export interface ChatChannel {
  on(type: "broadcast", filter: { event: string }, callback: (message: { payload?: unknown }) => void): ChatChannel;
  subscribe(callback: (status: SubscribeStatus, err?: Error) => void): ChatChannel;
}

/** The slice of the Supabase client this file uses. */
export interface ChatRealtimeClient {
  channel(topic: string, opts: { config: { private: true } }): ChatChannel;
  removeChannel(channel: ChatChannel): Promise<unknown>;
  realtime: { setAuth(token?: string | null): Promise<void> };
}

export interface ChatTransportHandlers {
  /** A conversation of mine moved — refresh the inbox and badge. */
  onUserSignal(signal: ChatSignal): void;
  /** The open conversation moved — fetch what changed. */
  onConversationSignal(signal: ChatSignal): void;
  /** A channel came back after a drop: catch up on what it may have missed. */
  onResume(openThreadId: string | null): void;
}

/** The event name 0513's `realtime.send(…, 'chat', …)` uses. */
const EVENT = "chat";

export function parseChatSignal(payload: unknown): ChatSignal | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.thread_id !== "string" || typeof p.seq !== "number" || typeof p.rev !== "number") return null;
  return {
    thread_id: p.thread_id,
    seq: p.seq,
    rev: p.rev,
    kind: typeof p.kind === "string" ? p.kind : "",
    op: p.op === "change" ? "change" : "message",
  };
}

interface Slot {
  topic: string;
  channel: ChatChannel;
  status: SubscribeStatus | "joining";
  /** Has this channel ever been SUBSCRIBED — so that its next SUBSCRIBED is a resume, not a first join. */
  joined: boolean;
}

export function createChatTransport(client: ChatRealtimeClient, handlers: ChatTransportHandlers) {
  const state = ref<ChatLinkState>("off");
  let user: Slot | null = null;
  let conv: Slot | null = null;
  let userId: string | null = null;
  // The conversation the page has open. One opened before `start` resolved is joined once the user's
  // topic exists, and it survives a restart for another user.
  let pendingConv: string | null = null;
  // Bumped by every start/stop/open, so an answer from a setAuth or a channel that has since been
  // replaced is ignored instead of resurrecting it.
  let generation = 0;

  function recompute() {
    const slots = [user, conv].filter((s): s is Slot => s !== null);
    if (slots.length === 0) state.value = "off";
    else if (slots.every((s) => s.status === "SUBSCRIBED")) state.value = "live";
    // A channel that errored, timed out or closed is down, whether it had ever joined or not; one still
    // on its first join (a conversation just opened) is only connecting.
    else if (slots.some((s) => s.status !== "SUBSCRIBED" && s.status !== "joining")) state.value = "reconnecting";
    else state.value = "connecting";
  }

  function join(topic: string, onSignal: (s: ChatSignal) => void): Slot {
    const slot: Slot = { topic, channel: null as unknown as ChatChannel, status: "joining", joined: false };
    slot.channel = client
      .channel(topic, { config: { private: true } })
      .on("broadcast", { event: EVENT }, (message) => {
        const signal = parseChatSignal(message.payload);
        if (signal) onSignal(signal);
      })
      .subscribe((status) => {
        const resumed = status === "SUBSCRIBED" && slot.joined && slot.status !== "SUBSCRIBED";
        slot.status = status;
        if (status === "SUBSCRIBED") slot.joined = true;
        recompute();
        if (resumed) handlers.onResume(pendingConv);
      });
    return slot;
  }

  function leave(slot: Slot | null) {
    if (slot) void client.removeChannel(slot.channel);
  }

  /** Join my own topic. Idempotent for the same user; a different user replaces the subscription. */
  async function start(id: string) {
    if (userId === id && user) return;
    stop();
    userId = id;
    const mine = ++generation;
    state.value = "connecting";
    try {
      await client.realtime.setAuth();
    } catch {
      // No token yet: the join is refused and reported as reconnecting; the poll carries on.
    }
    if (mine !== generation) return;
    user = join(`chat:user:${id}`, handlers.onUserSignal);
    if (pendingConv) openConversation(pendingConv);
    recompute();
  }

  /** Follow one open conversation; `null` for none. Replaces the previous one. */
  function openConversation(threadId: string | null) {
    pendingConv = threadId;
    if (conv?.topic === `chat:conv:${threadId}`) return;
    const previous = conv;
    conv = null;
    leave(previous);
    if (threadId && user) conv = join(`chat:conv:${threadId}`, handlers.onConversationSignal);
    recompute();
  }

  function stop() {
    generation++;
    const slots = [user, conv];
    user = null;
    conv = null;
    userId = null;
    for (const s of slots) leave(s);
    recompute();
  }

  return { state: readonly(state), start, openConversation, stop };
}

export type ChatTransport = ReturnType<typeof createChatTransport>;

// ── The tab's one transport ──────────────────────────────────────────────────────────────────────
// One websocket per tab carries both channels (plan §3), so the shell (the badge) and the chat page
// (the open conversation) share one instance rather than each opening their own.
const shared = shallowRef<ChatTransport | null>(null);

/** The tab's link state, for the poll intervals and the page's "Reconnecting…". */
export const chatLinkState = computed<ChatLinkState>(() => shared.value?.state.value ?? "off");

/**
 * The tab's transport, created on first use with the handlers given then. The cast is the one place the
 * real client meets `ChatRealtimeClient`: supabase-js's `on()` is a dozen overloads the slice above
 * does not restate.
 */
export function sharedChatTransport(handlers: () => ChatTransportHandlers): ChatTransport {
  shared.value ??= createChatTransport(supabase as unknown as ChatRealtimeClient, handlers());
  return shared.value;
}
