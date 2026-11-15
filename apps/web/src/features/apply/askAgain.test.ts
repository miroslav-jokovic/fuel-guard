import { describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import type { AskAgainView } from "@silvicom/shared";

import { askAgainFieldPath, askAgainIssue, useAskAgain } from "./askAgain";
import AskAgainScreen from "./AskAgainScreen.vue";
import { emptyDraft } from "./draft";
import { APPLY_COPY } from "./strings";

/**
 * The office asked the driver one question again (F5, 0607) — the driver's page.
 *
 * What must hold: the questions stand in for the wait screen only while one is open and the driver is
 * not in their application; "Open my answer" lands on the screen that asks that answer, only once the
 * form can be shown; leaving the task returns to the questions; an answer can be sent only after it
 * was opened, and only after everything typed is on the server; a question the office took back in
 * the meantime is not an error.
 */
const q = (over: Partial<AskAgainView> = {}): AskAgainView => ({
  id: "q1", path: ["experience"], question: "How many years on a flatbed?", askedAt: "2026-11-13T10:00:00Z", answeredAt: null, withdrawnAt: null, ...over,
});

function page(opts: { questions?: AskAgainView[]; awaiting?: boolean; ready?: boolean; refuse?: unknown } = {}) {
  const questions = ref(opts.questions ?? [q()]);
  const awaitingReview = ref(opts.awaiting ?? true);
  const formReady = ref(opts.ready ?? true);
  const atList = ref(true);
  const order: string[] = [];
  const showIssue = vi.fn(async (_issue: unknown) => { atList.value = false; });
  const flush = vi.fn(async () => { order.push("flush"); });
  const refetch = vi.fn(async () => { order.push("refetch"); });
  // One script per page: what the server answers "Send my answer" with.
  const post = vi.fn((_token: string, _id: string) => {
    order.push("post");
    return opts.refuse === undefined ? Promise.resolve({ question: q() }) : Promise.reject(opts.refuse);
  });
  const scope = effectScope();
  const ask = scope.run(() => useAskAgain({
    token: ref("tok"), questions: () => questions.value, draft: emptyDraft(), awaitingReview, formReady, atList, showIssue, flush, refetch, sendAnswer: post,
  }))!;
  return { ask, questions, awaitingReview, formReady, atList, showIssue, flush, refetch, order, post };
}
const settle = async () => { await nextTick(); await flushPromises(); await nextTick(); };

describe("where a question's answer is", () => {
  it("is the form's own path for a plain answer, and the contract's key for a carrier question", () => {
    expect(askAgainFieldPath(["experience"], emptyDraft())).toEqual(["experience"]);
    expect(askAgainFieldPath(["questionnaire", "position"], emptyDraft())).toEqual(["questionnaire_answers", "position"]);
  });

  it("⚠ finds a job by its key, wherever it now stands in the list", () => {
    const draft = emptyDraft();
    draft.employers = [
      { ...draft.employers[0]!, key: "a", employer_name: "First" },
      { ...draft.employers[0]!, key: "b", employer_name: "Second" },
    ];
    const issue = askAgainIssue({ path: ["employers", "b", "ended_on"] }, draft);
    expect(issue.path).toEqual(["employers", 1, "ended_on"]);
    expect(issue.section).toBe("employment");
    expect(issue.fieldId).toBe("apply-employers-1-ended_on");
  });

  it("⚠ opens a question about the job itself at the job's first question", () => {
    const draft = emptyDraft();
    draft.employers = [{ ...draft.employers[0]!, key: "a" }, { ...draft.employers[0]!, key: "b" }];
    expect(askAgainIssue({ path: ["employers", "b"] }, draft)).toMatchObject({
      path: ["employers", 1, "employer_name"], section: "employment", fieldId: "apply-employers-1-employer_name",
    });
  });

  it("⚠ names a job by its company, and its answer by the company and the answer", () => {
    const draft = emptyDraft();
    draft.employers = [{ ...draft.employers[0]!, key: "a", employer_name: "Newer Freight" }, { ...draft.employers[0]!, key: "b", employer_name: "Old Carrier" }];
    expect(askAgainIssue({ path: ["employers", "b"] }, draft).label).toBe("Old Carrier");
    expect(askAgainIssue({ path: ["employers", "b", "ended_on"] }, draft).label).toMatch(/^Old Carrier · /);
    // Behind the gate the draft is empty: the plain noun, and no name that was never loaded.
    expect(askAgainIssue({ path: ["employers", "b"] }, emptyDraft()).label).not.toContain("Old Carrier");
  });

  it("still names the screen for a job the driver has since removed", () => {
    expect(askAgainIssue({ path: ["employers", "gone", "ended_on"] }, emptyDraft()).section).toBe("employment");
  });
});

describe("the questions in place of the wait screen", () => {
  it("are on show while one is open, and not once the application is no longer waiting", () => {
    const p = page();
    expect(p.ask.asking.value).toBe(true);
    p.awaitingReview.value = false;
    expect(p.ask.asking.value).toBe(false);
    expect(page({ questions: [] }).ask.asking.value).toBe(false);
  });

  it("⚠ opens the answer's own screen, and stops being the wait screen while the driver is there", async () => {
    const p = page();
    p.ask.answer(q());
    expect(p.ask.asking.value).toBe(false);
    expect(p.ask.answering.value?.id).toBe("q1");
    await settle();
    expect(p.showIssue).toHaveBeenCalledTimes(1);
    expect(p.showIssue.mock.calls[0]![0]).toMatchObject({ path: ["experience"], section: "employment" });
  });

  it("⚠ waits for the form before opening it — the date-of-birth gate comes first", async () => {
    const p = page({ ready: false });
    p.ask.answer(q());
    await settle();
    expect(p.showIssue).not.toHaveBeenCalled();
    p.formReady.value = true;
    await settle();
    expect(p.showIssue).toHaveBeenCalledTimes(1);
  });

  it("comes back to the questions when the driver closes or leaves the task", async () => {
    const p = page();
    p.ask.answer(q());
    await settle();
    p.atList.value = true;
    await settle();
    expect(p.ask.answering.value).toBeNull();
    expect(p.ask.asking.value).toBe(true);
    expect(p.ask.opened.value).toEqual(["q1"]);
  });

  it("comes back on Done, from whatever screen the driver went to", async () => {
    const p = page();
    p.ask.answer(q());
    await settle();
    p.ask.back();
    expect(p.ask.asking.value).toBe(true);
  });
});

describe("sending the answer", () => {
  it("⚠ puts everything typed on the server first, then tells the office, then reads the link again", async () => {
    const p = page();
    await p.ask.send(q());
    expect(p.order).toEqual(["flush", "post", "refetch"]);
    expect(p.post).toHaveBeenCalledWith("tok", "q1");
    expect(p.ask.failed.value).toBeNull();
  });

  it("says it did not send, and keeps the question, when the signal drops", async () => {
    const p = page({ refuse: { message: "Failed to fetch" } });
    await p.ask.send(q());
    expect(p.ask.failed.value).toBe(APPLY_COPY.askAgain.failed);
    expect(p.refetch).not.toHaveBeenCalled();
    expect(p.ask.sending.value).toBeNull();
  });

  it("⚠ treats a question the office took back meanwhile as out of date, not as a failure", async () => {
    const p = page({ refuse: { code: "question_not_open" } });
    await p.ask.send(q());
    expect(p.ask.failed.value).toBeNull();
    expect(p.refetch).toHaveBeenCalledTimes(1);
  });
});

describe("the screen", () => {
  const show = (opened: string[] = [], sending: string | null = null) =>
    mount(AskAgainScreen, { props: { carrier: "Silvicom Inc", questions: [q()], labels: { q1: "Driving experience" }, opened, sending, failed: null } });

  it("prints the office's words and which answer they are about", () => {
    const w = show();
    expect(w.text()).toContain("Silvicom Inc has a question for you");
    expect(w.text()).toContain("How many years on a flatbed?");
    expect(w.text()).toContain("About: Driving experience");
  });

  it("⚠ offers Send only for an answer the driver has opened", async () => {
    expect(show().findAll("button").map((b) => b.text())).toEqual([APPLY_COPY.askAgain.open]);
    const w = show(["q1"]);
    expect(w.findAll("button").map((b) => b.text())).toEqual([APPLY_COPY.askAgain.openAgain, APPLY_COPY.askAgain.send]);
    await w.findAll("button")[1]!.trigger("click");
    expect((w.emitted("send")![0]![0] as AskAgainView).id).toBe("q1");
  });

  it("holds both buttons while an answer is being sent", () => {
    const w = show(["q1"], "q1");
    expect(w.findAll("button").every((b) => b.attributes("disabled") !== undefined)).toBe(true);
    expect(w.text()).toContain(APPLY_COPY.askAgain.sending);
  });

  it("says how many when there are several", () => {
    const w = mount(AskAgainScreen, { props: { carrier: "Silvicom Inc", questions: [q(), q({ id: "q2" })], labels: {}, opened: [], sending: null, failed: null } });
    expect(w.text()).toContain("has 2 questions for you");
  });
});
