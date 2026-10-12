import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import QueryState from "./QueryState.vue";

/** D-US5 — the three states every non-table fetch draws, in the table's order. */
const mountState = (props: Record<string, unknown>) =>
  mount(QueryState, { props: { loading: false, ...props }, slots: { default: "<p>The part</p>" } });

describe("QueryState", () => {
  it("says what is loading, as a polite live region, and hides the content", () => {
    const w = mountState({ loading: true, loadingText: "Loading the part…" });
    const status = w.get("[role=status]");
    expect(status.text()).toBe("Loading the part…");
    expect(status.attributes("aria-live")).toBe("polite");
    expect(w.text()).not.toContain("The part");
  });

  it("shows a failure with a retry, never the content, and asks the page to retry", async () => {
    const w = mountState({ error: new Error("timeout"), errorText: "Could not load the part." });
    expect(w.text()).toContain("Could not load the part.");
    expect(w.text()).not.toContain("The part\n");
    await w.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    expect(w.emitted("retry")).toHaveLength(1);
  });

  it("falls back to the error's own message, then to a sentence, never to blank", () => {
    expect(mountState({ error: new Error("Row limit reached") }).text()).toContain("Row limit reached");
    expect(mountState({ error: true }).text()).toContain("Could not load this.");
  });

  it("draws one line with the retry beside it when compact, for a panel or a drawer", () => {
    const w = mountState({ error: true, compact: true, retrying: true });
    expect(w.findComponent({ name: "ErrorState" }).exists()).toBe(false);
    expect(w.get("[role=alert]").text()).toContain("Retrying…");
  });

  it("loading wins over a stale error, as in the table", () => {
    const w = mountState({ loading: true, error: true });
    expect(w.find("[role=alert]").exists()).toBe(false);
  });

  it("renders the content when there is nothing to wait for", () => {
    expect(mountState({}).text()).toBe("The part");
  });
});
