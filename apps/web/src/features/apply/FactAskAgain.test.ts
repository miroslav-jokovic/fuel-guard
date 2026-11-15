import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import type { AskAgainView } from "@silvicom/shared";

const hooks = vi.hoisted(() => ({ list: [] as unknown[], ask: vi.fn(), withdraw: vi.fn() }));
vi.mock("./useAskAgainOffice", async () => {
  const { ref: r } = await import("vue");
  return {
    useAskAgainListQuery: () => ({ data: r(hooks.list) }),
    useAskApplicantAgain: () => ({ mutateAsync: hooks.ask, isPending: r(false) }),
    useWithdrawAskAgain: () => ({ mutateAsync: hooks.withdraw, isPending: r(false) }),
  };
});
const FactAskAgain = (await import("./FactAskAgain.vue")).default;

/**
 * "Ask the applicant" under one answer of the office's facts card (F5, 0607).
 *
 * What must hold: it is offered only while the application waits for the office, only to a reader who
 * may act, and only for an answer the applicant can still change; the row is named by its key; a
 * question already waiting is shown in place of the offer and can be taken back; an answered one is
 * reported; a refusal from the server is said, and the words are kept.
 */
const q = (over: Partial<AskAgainView> = {}): AskAgainView => ({
  id: "q1", path: ["experience"], question: "How many years on a flatbed?", askedAt: "2026-11-13T10:00:00Z", answeredAt: null, withdrawnAt: null, ...over,
});
const PAYLOAD = { accidents: [{ key: "acc-1", nature: "Rear-ended" }, { key: "acc-2", nature: "Backed into a dock" }] };
const show = (over: Record<string, unknown> = {}) =>
  mount(FactAskAgain, {
    props: { invitationId: "inv", path: ["experience"], label: "Driving experience", state: "awaiting_review", payload: PAYLOAD, canAsk: true, ...over } as never,
  });
const button = (w: ReturnType<typeof show>, text: string) => w.findAll("button").find((b) => b.text() === text);

beforeEach(() => {
  hooks.list = [];
  hooks.ask.mockReset();
  hooks.withdraw.mockReset();
  void ref;
});

describe("when it is offered", () => {
  it("offers to ask while the application waits for the office", () => {
    expect(button(show(), "Ask the applicant")).toBeDefined();
  });

  it("⚠ offers nothing before the applicant has sent it, after approval, or once filed", () => {
    for (const state of ["filling", "approved", "certified"]) expect(show({ state }).find("[data-ask-again]").exists()).toBe(false);
  });

  it("⚠ offers nothing to a reader who may not act on the application", () => {
    expect(show({ canAsk: false }).find("[data-ask-again]").exists()).toBe(false);
  });

  it("⚠ offers nothing for an answer the applicant can no longer change on their link", () => {
    expect(show({ path: ["cdl_number"], label: "License number" }).find("[data-ask-again]").exists()).toBe(false);
  });
});

describe("asking", () => {
  it("sends the office's words, trimmed, and closes the box", async () => {
    hooks.ask.mockResolvedValue(q());
    const w = show();
    await button(w, "Ask the applicant")!.trigger("click");
    expect(button(w, "Send the question")!.attributes("disabled")).toBeDefined();
    await w.find("[data-ask-words]").setValue("  How many years on a flatbed?  ");
    await button(w, "Send the question")!.trigger("click");
    await flushPromises();
    expect(hooks.ask).toHaveBeenCalledWith({ path: ["experience"], question: "How many years on a flatbed?" });
    expect(w.find("[data-ask-words]").exists()).toBe(false);
  });

  it("⚠ names a row by its key, not its place", async () => {
    hooks.ask.mockResolvedValue(q());
    const w = show({ path: ["accidents", 1, "nature"], label: "Accident 2 · What happened" });
    await button(w, "Ask the applicant")!.trigger("click");
    await w.find("[data-ask-words]").setValue("Which dock?");
    await button(w, "Send the question")!.trigger("click");
    await flushPromises();
    expect(hooks.ask).toHaveBeenCalledWith({ path: ["accidents", "acc-2", "nature"], question: "Which dock?" });
  });

  it("says the server's refusal and keeps what was written", async () => {
    hooks.ask.mockImplementation(() => Promise.reject(new Error("There are already 5 questions waiting for this applicant.")));
    const w = show();
    await button(w, "Ask the applicant")!.trigger("click");
    await w.find("[data-ask-words]").setValue("One more?");
    await button(w, "Send the question")!.trigger("click");
    await flushPromises();
    expect(w.find("[role='alert']").text()).toContain("already 5 questions");
    expect((w.find("[data-ask-words]").element as HTMLTextAreaElement).value).toBe("One more?");
  });
});

describe("a question already asked", () => {
  it("⚠ shows the one waiting on THIS answer in place of the offer, and takes it back", async () => {
    // The other row's question comes FIRST: a card that showed "the first open question" would show it here.
    hooks.list = [q({ id: "q2", path: ["accidents", "acc-1", "nature"], question: "Another row's" }), q()];
    hooks.withdraw.mockResolvedValue(q({ withdrawnAt: "x" }));
    const w = show();
    expect(w.find("[data-ask-waiting]").text()).toContain("You asked: How many years on a flatbed?");
    expect(w.text()).not.toContain("Another row's");
    expect(button(w, "Ask the applicant")).toBeUndefined();
    await button(w, "Take it back")!.trigger("click");
    expect(hooks.withdraw).toHaveBeenCalledWith("q1");
  });

  it("reports an answered question, and offers to ask again", () => {
    hooks.list = [q({ answeredAt: "2026-11-14T15:00:00Z" })];
    const w = show();
    expect(w.find("[data-ask-answered]").text()).toContain("The applicant answered your question");
    expect(button(w, "Ask the applicant")).toBeDefined();
  });

  it("still shows a waiting question to a reader who may not act, without the take-back", () => {
    hooks.list = [q()];
    const w = show({ canAsk: false });
    expect(w.find("[data-ask-waiting]").exists()).toBe(true);
    expect(button(w, "Take it back")).toBeUndefined();
  });

  it("offers nothing new for a question taken back, beyond the way to ask", () => {
    hooks.list = [q({ withdrawnAt: "2026-11-14T15:00:00Z" })];
    const w = show();
    expect(w.find("[data-ask-waiting]").exists()).toBe(false);
    expect(w.find("[data-ask-answered]").exists()).toBe(false);
    expect(button(w, "Ask the applicant")).toBeDefined();
  });
});
