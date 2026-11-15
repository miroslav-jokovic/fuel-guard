import { describe, expect, it, vi } from "vitest";
import { useTaskHub } from "./useTaskHub";

/** Part 2's navigation (C3c2a): the list first, a task on open, back to the list only when it passes. */
const wizard = (passes: boolean) => ({ goTo: vi.fn(), check: vi.fn(() => passes), setIssues: vi.fn() });

describe("useTaskHub", () => {
  it("opens on the list", () => {
    const hub = useTaskHub(wizard(true));
    expect(hub.showList.value).toBe(true);
    expect(hub.inTask.value).toBe(false);
  });

  it("Save and continue returns to the list only when the task passes", () => {
    const failing = wizard(false);
    const hub = useTaskHub(failing);
    hub.open("employment");
    expect(failing.goTo).toHaveBeenCalledWith("employment", false);
    hub.finish();
    expect(hub.inTask.value).toBe(true);

    const passing = useTaskHub(wizard(true));
    passing.open("employment");
    passing.finish();
    expect(passing.showList.value).toBe(true);
  });

  it("Back to your application is never gated, and clears what the task was showing", () => {
    const w = wizard(false);
    const hub = useTaskHub(w);
    hub.open("employment");
    hub.leave();
    expect(hub.showList.value).toBe(true);
    expect(w.check).not.toHaveBeenCalled();
    expect(w.setIssues).toHaveBeenCalledWith([]);
  });
});
