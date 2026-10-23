import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {}, DEV_BYPASS: false }));

import { createChatTransport, parseChatSignal, type ChatChannel, type ChatRealtimeClient } from "./transport";

/**
 * The realtime seam (CH3b, D-CHAT10) against a stand-in for Supabase: which private topics it joins,
 * what it reports as live or reconnecting, that a rejoin after a drop asks for a catch-up, and that a
 * channel it has let go can no longer move its state.
 */
type Status = Parameters<Parameters<ChatChannel["subscribe"]>[0]>[0];

function fakeClient() {
  const channels: Array<{
    topic: string;
    opts: unknown;
    emit: (payload: unknown) => void;
    status: (s: Status) => void;
    removed: boolean;
  }> = [];
  const order: string[] = [];
  const client: ChatRealtimeClient = {
    realtime: {
      setAuth: vi.fn(async () => {
        order.push("setAuth");
      }),
    },
    channel(topic, opts) {
      order.push(`join ${topic}`);
      const entry = { topic, opts, emit: (_: unknown) => {}, status: (_: Status) => {}, removed: false };
      channels.push(entry);
      const ch: ChatChannel = {
        on(_type, filter, cb) {
          expect(filter).toEqual({ event: "chat" });
          entry.emit = (payload) => cb({ payload });
          return ch;
        },
        subscribe(cb) {
          entry.status = (s) => cb(s);
          return ch;
        },
      };
      (entry as unknown as { ch: ChatChannel }).ch = ch;
      return ch;
    },
    removeChannel: vi.fn(async (ch: ChatChannel) => {
      const e = channels.find((c) => (c as unknown as { ch: ChatChannel }).ch === ch);
      if (e) e.removed = true;
      return "ok";
    }),
  };
  const find = (topic: string) => channels.filter((c) => c.topic === topic).at(-1)!;
  return { client, channels, order, find };
}

const ME = "11111111-1111-4111-8111-111111111111";
const T1 = "22222222-2222-4222-8222-222222222222";
const T2 = "33333333-3333-4333-8333-333333333333";
const signal = (thread_id: string, rev = 5) => ({ thread_id, seq: 3, rev, kind: "direct", op: "message" });

function handlers() {
  return { onUserSignal: vi.fn(), onConversationSignal: vi.fn(), onResume: vi.fn() };
}

describe("chat transport", () => {
  it("sets the session's token before joining, and joins my topic as a private channel", async () => {
    const f = fakeClient();
    const t = createChatTransport(f.client, handlers());
    await t.start(ME);
    expect(f.order).toEqual(["setAuth", `join chat:user:${ME}`]);
    expect(f.find(`chat:user:${ME}`).opts).toEqual({ config: { private: true } });
  });

  it("is live only while every channel it wants is subscribed", async () => {
    const f = fakeClient();
    const t = createChatTransport(f.client, handlers());
    await t.start(ME);
    expect(t.state.value).toBe("connecting");
    f.find(`chat:user:${ME}`).status("SUBSCRIBED");
    expect(t.state.value).toBe("live");
    t.openConversation(T1);
    expect(t.state.value).toBe("connecting");
    f.find(`chat:conv:${T1}`).status("SUBSCRIBED");
    expect(t.state.value).toBe("live");
  });

  it("reports a dropped channel as reconnecting, and asks for a catch-up when it comes back", async () => {
    const f = fakeClient();
    const h = handlers();
    const t = createChatTransport(f.client, h);
    await t.start(ME);
    t.openConversation(T1);
    f.find(`chat:user:${ME}`).status("SUBSCRIBED");
    f.find(`chat:conv:${T1}`).status("SUBSCRIBED");
    expect(h.onResume).not.toHaveBeenCalled(); // a first join is not a resume

    f.find(`chat:conv:${T1}`).status("CHANNEL_ERROR");
    expect(t.state.value).toBe("reconnecting");
    f.find(`chat:conv:${T1}`).status("SUBSCRIBED");
    expect(t.state.value).toBe("live");
    expect(h.onResume).toHaveBeenCalledWith(T1);
  });

  it("reports a channel that never came up as reconnecting, not as connecting forever", async () => {
    const f = fakeClient();
    const t = createChatTransport(f.client, handlers());
    await t.start(ME);
    f.find(`chat:user:${ME}`).status("TIMED_OUT");
    expect(t.state.value).toBe("reconnecting");
  });

  it("hands each topic's signals to its own handler, and ignores a payload that is not a signal", async () => {
    const f = fakeClient();
    const h = handlers();
    const t = createChatTransport(f.client, h);
    await t.start(ME);
    t.openConversation(T1);
    f.find(`chat:user:${ME}`).emit(signal(T2));
    f.find(`chat:conv:${T1}`).emit(signal(T1));
    f.find(`chat:conv:${T1}`).emit({ body: "a message body must never be read off the wire" });
    expect(h.onUserSignal).toHaveBeenCalledWith(expect.objectContaining({ thread_id: T2 }));
    expect(h.onConversationSignal).toHaveBeenCalledTimes(1);
    expect(h.onConversationSignal).toHaveBeenCalledWith(expect.objectContaining({ thread_id: T1, rev: 5 }));
  });

  it("follows one conversation at a time, and a replaced channel can no longer move the state", async () => {
    const f = fakeClient();
    const t = createChatTransport(f.client, handlers());
    await t.start(ME);
    f.find(`chat:user:${ME}`).status("SUBSCRIBED");
    t.openConversation(T1);
    const old = f.find(`chat:conv:${T1}`);
    t.openConversation(T2);
    expect(old.removed).toBe(true);
    f.find(`chat:conv:${T2}`).status("SUBSCRIBED");
    old.status("CLOSED"); // the removal's own echo
    expect(t.state.value).toBe("live");
    t.openConversation(null);
    expect(f.find(`chat:conv:${T2}`).removed).toBe(true);
    expect(t.state.value).toBe("live");
  });

  it("joins a conversation opened before the user's topic, once it exists", async () => {
    const f = fakeClient();
    const t = createChatTransport(f.client, handlers());
    t.openConversation(T1);
    expect(f.channels).toHaveLength(0);
    await t.start(ME);
    expect(f.channels.map((c) => c.topic)).toEqual([`chat:user:${ME}`, `chat:conv:${T1}`]);
  });

  it("lets everything go on stop, and a start that stop overtook joins nothing", async () => {
    const f = fakeClient();
    const t = createChatTransport(f.client, handlers());
    const starting = t.start(ME);
    t.stop();
    await starting;
    expect(f.channels).toHaveLength(0);
    expect(t.state.value).toBe("off");

    await t.start(ME);
    t.stop();
    expect(f.channels.every((c) => c.removed)).toBe(true);
    expect(t.state.value).toBe("off");
  });
});

describe("parseChatSignal", () => {
  it("reads 0513's payload and nothing else", () => {
    expect(parseChatSignal({ thread_id: T1, seq: 4, rev: 9, kind: "group", op: "change" })).toEqual({
      thread_id: T1, seq: 4, rev: 9, kind: "group", op: "change",
    });
    expect(parseChatSignal({ thread_id: T1, seq: "4", rev: 9 })).toBeNull();
    expect(parseChatSignal(null)).toBeNull();
  });
});
