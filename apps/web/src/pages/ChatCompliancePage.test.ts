import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";

/**
 * Settings → Chat compliance (CHA2) — the page's own decisions: nothing searches until a reason is
 * complete, a search carries that reason, a step-up refusal becomes the password prompt and the same
 * search runs again on confirmation, and opening a conversation from a result opens it with the reason.
 */
const state = vi.hoisted(() => ({
  conversations: vi.fn(),
  messages: vi.fn(),
  thread: vi.fn(),
  stepUpConfirm: null as null | (() => void),
}));

vi.mock("@/features/chat/compliance/useChatCompliance", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/features/chat/compliance/useChatCompliance")>();
  const { ref } = await import("vue");
  return {
    ...real,
    searchConversations: state.conversations,
    searchMessages: state.messages,
    openThread: state.thread,
    useCompliancePeopleQuery: () => ({ data: ref([{ user_id: "22222222-2222-4222-8222-222222222222", name: "Ben", role: "dispatcher", suspended: false }]) }),
    useComplianceAccessLogQuery: () => ({ data: ref({ rows: [], before_seq: null }), isPending: ref(false), isError: ref(false), isFetching: ref(false), refetch: vi.fn() }),
  };
});
// The prompt itself talks to the API; here it is a button that confirms.
vi.mock("@/components/StepUpPrompt.vue", () => ({
  default: {
    props: ["reason"],
    emits: ["confirmed", "cancel"],
    template: `<div data-test="step-up">{{ reason }}<button data-test="confirm" @click="$emit('confirmed')">Confirm</button></div>`,
  },
}));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));

import ChatCompliancePage from "./ChatCompliancePage.vue";

const T = "33333333-3333-4333-8333-333333333333";
const REASON_TEXT = "Grievance HR-14, night shift messages";
const conversation = {
  thread_id: T, kind: "group", subject: "Night dispatch", load_id: null, created_at: "2026-10-23T14:00:00Z", archived_at: null,
  last_message_at: "2026-10-23T15:00:00Z", message_count: 2,
  members: [{ user_id: "22222222-2222-4222-8222-222222222222", name: "Ben", role: "dispatcher", member_role: "member", joined_at: "2026-10-23T14:00:00Z", left_at: null }],
};
const stepUpRefusal = () => Object.assign(new Error("Confirm your password to continue."), { code: "step_up_required" });

async function render(path = "/settings/chat-compliance") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/settings/chat-compliance", component: { template: "<div/>" }, meta: { title: "Chat compliance" } }],
  });
  await router.push(path);
  await router.isReady();
  const w = mount(ChatCompliancePage, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return { w, router };
}

async function giveReason(w: Awaited<ReturnType<typeof render>>["w"]) {
  await w.find('select[aria-label="Kind of matter"]').setValue("hr");
  await w.find('textarea[aria-label="Reason"]').setValue(REASON_TEXT);
  await flushPromises();
}
const searchButton = (w: Awaited<ReturnType<typeof render>>["w"]) =>
  w.findAll("button").find((b) => b.text() === "Search conversations")!;

beforeEach(() => {
  setActivePinia(createPinia());
  state.conversations.mockReset().mockResolvedValue({ conversations: [conversation], next: null });
  state.messages.mockReset().mockResolvedValue({ messages: [], next: null });
  state.thread.mockReset().mockResolvedValue({
    conversation: { ...conversation, created_by: null, last_seq: 2, members: conversation.members },
    messages: [{ id: "00000000-0000-4000-8000-000000000001", thread_id: T, seq: 1, sender_user_id: null, sender_name: "Ben", body: "Night shift starts at 9.", created_at: "2026-10-23T15:00:00Z", edited_at: null, deleted_at: null, versions: [] }],
    before_seq: null,
  });
});

describe("ChatCompliancePage", () => {
  it("searches nothing until the reason is complete", async () => {
    const { w } = await render();
    expect(searchButton(w).attributes("disabled")).toBeDefined();
    await w.find('select[aria-label="Kind of matter"]').setValue("hr");
    await w.find('textarea[aria-label="Reason"]').setValue("short");
    await flushPromises();
    expect(searchButton(w).attributes("disabled")).toBeDefined();
    expect(w.text()).toContain("5 more characters");
    expect(state.conversations).not.toHaveBeenCalled();
  });

  it("sends the reason with the search and shows the conversations found", async () => {
    const { w } = await render();
    await giveReason(w);
    expect(searchButton(w).attributes("disabled")).toBeUndefined();
    await searchButton(w).trigger("submit");
    await flushPromises();
    expect(state.conversations).toHaveBeenCalledWith(expect.objectContaining({ reason: { category: "hr", text: REASON_TEXT } }));
    expect(w.text()).toContain("Night dispatch");
  });

  it("turns a step-up refusal into the password prompt and runs the same search once confirmed", async () => {
    state.conversations.mockRejectedValueOnce(stepUpRefusal());
    const { w } = await render();
    await giveReason(w);
    await searchButton(w).trigger("submit");
    await flushPromises();
    expect(w.find('[data-test="step-up"]').exists()).toBe(true);
    expect(w.text()).toContain("Confirm your password to continue.");
    expect(state.conversations).toHaveBeenCalledTimes(1);
    await w.find('[data-test="confirm"]').trigger("click");
    await flushPromises();
    expect(state.conversations).toHaveBeenCalledTimes(2);
    expect(w.find('[data-test="step-up"]').exists()).toBe(false);
    expect(w.text()).toContain("Night dispatch");
  });

  it("opens a conversation from a result, with the reason, and shows its lines", async () => {
    const { w } = await render();
    await giveReason(w);
    await searchButton(w).trigger("submit");
    await flushPromises();
    await w.findAll("button").find((b) => b.text() === "Open")!.trigger("click");
    await flushPromises();
    expect(state.thread).toHaveBeenCalledWith(T, { reason: { category: "hr", text: REASON_TEXT }, before_seq: undefined });
    expect(document.body.textContent).toContain("Night shift starts at 9.");
    w.unmount();
  });

  it("keeps the tab in the URL", async () => {
    const { w, router } = await render("/settings/chat-compliance?tab=access");
    expect(w.text()).toContain("Nobody has looked yet.");
    expect(router.currentRoute.value.query.tab).toBe("access");
  });
});
