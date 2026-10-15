import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { answerConfirm } from "@silvicom/ui/testing";

/**
 * A job card's "are you sure?" is the product's dialog, not the browser's (D-US7). The card's prop is
 * one sentence-pair — question, then what is kept — so the question is the title and the rest the
 * message, and the button's verb is the label of the button that was pressed.
 */
const post = vi.hoisted(() => vi.fn(async (_url: string, _opts: unknown) => ({ ok: true, status: 200, data: {}, error: null })));
vi.mock("@/lib/api", () => ({ apiFetch: post }));
const read = vi.hoisted(() => ({ failed: false, loading: false, retry: vi.fn() }));
vi.mock("./useJob", () => ({
  useJob: () => ({
    isRunning: ref(false), failed: ref(false), progressPct: ref(null), progressLabel: ref(null),
    freshnessLabel: ref("never run"), refresh: vi.fn(), markRunning: vi.fn(), lastDone: ref(null),
    isLoading: ref(read.loading), readFailed: ref(read.failed), retrying: ref(false), retry: read.retry,
  }),
}));

import JobActionCard from "./JobActionCard.vue";

const card = () =>
  mount(JobActionCard, {
    props: {
      title: "Re-score alerts", description: "d", kind: "rescore", endpoint: "/api/rescore", actionLabel: "Re-score 30 days",
      confirm: "Re-score the last 30 days with the current rules? Existing false flags will clear; your notes are kept.",
      secondaryLabel: "Re-score all history", secondaryBody: { full: true },
      secondaryConfirm: "Re-score EVERY transaction? Slower.",
    },
  });
const press = async (w: ReturnType<typeof card>, label: string) => {
  await w.findAll("button").find((b) => b.text() === label)!.trigger("click");
  await flushPromises();
};

beforeEach(() => {
  setActivePinia(createPinia());
  post.mockClear();
  Object.assign(read, { failed: false, loading: false });
  read.retry.mockClear();
});

describe("a job card's confirmation (D-US7)", () => {
  it("asks the card's question with the pressed button's verb, and starts nothing on a no", async () => {
    const asked = answerConfirm(false);
    await press(card(), "Re-score 30 days");
    expect(asked).toHaveBeenCalledWith({
      title: "Re-score the last 30 days with the current rules?",
      message: "Existing false flags will clear; your notes are kept.",
      confirmLabel: "Re-score 30 days",
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("starts the job on a yes, and the secondary button asks with its own words", async () => {
    const asked = answerConfirm(true);
    const w = card();
    await press(w, "Re-score all history");
    expect(asked).toHaveBeenCalledWith(expect.objectContaining({ title: "Re-score EVERY transaction?", confirmLabel: "Re-score all history" }));
    expect(post).toHaveBeenCalledWith("/api/rescore", { method: "POST", body: { full: true } });
  });
});

/**
 * F5 (US6b): the last run is an answer, so it waits for its read. Before, a failed read was answered
 * as `{ latest: null }` and every card on Data & Sync said "never run" — jobs that run every night.
 */
describe("a job card's last run", () => {
  it("says it could not load the last run, not \"never run\", and Retry asks again", async () => {
    read.failed = true;
    const w = card();
    expect(w.text()).toContain("Could not load the last run.");
    expect(w.text()).not.toContain("never run");
    await press(w, "Retry");
    expect(read.retry).toHaveBeenCalledTimes(1);
  });

  it("says nothing about the last run while it is still being read", () => {
    read.loading = true;
    expect(card().text()).not.toContain("never run");
  });
});
