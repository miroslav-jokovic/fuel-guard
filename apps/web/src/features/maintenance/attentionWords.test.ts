import { describe, expect, it } from "vitest";
import { attentionAnchor, attentionSentence } from "./attentionWords";

/** The one sentence per worklist group (§4.3, D-MX4) — plain words, the product's date, singular and plural right. */
describe("attentionSentence", () => {
  it.each([
    [{ kind: "defect", count: 1, oldestDetectedAt: null }, "A defect found on an inspection is not fixed"],
    [{ kind: "defect", count: 3, oldestDetectedAt: null }, "3 defects found on inspections are not fixed"],
    [{ kind: "work_order", count: 1, oldestOpenedAt: "2026-10-20T00:00:00Z" }, "In the shop since 10/20/2026"],
    [{ kind: "work_order", count: 2, oldestOpenedAt: null }, "2 work orders open in the shop"],
    [{ kind: "annual", expiresOn: "2026-11-10", daysRemaining: 13 }, "Annual inspection due in 13 days (11/10/2026)"],
    [{ kind: "annual", expiresOn: "2026-10-27", daysRemaining: -1 }, "Annual inspection 1 day overdue (10/27/2026)"],
    [{ kind: "annual", expiresOn: "2026-10-28", daysRemaining: 0 }, "Annual inspection due today"],
    [{ kind: "pm", name: "Oil Change", pmKind: "oil", verdict: "due", dueOn: null, milesLeft: 1133 }, "Oil Change due in 1,133 mi"],
    [{ kind: "pm", name: "Oil Change", pmKind: "oil", verdict: "overdue", dueOn: null, milesLeft: -5062 }, "Oil Change 5,062 mi overdue"],
    [{ kind: "pm", name: "PM Reefer", pmKind: "other", verdict: "overdue", dueOn: "2026-09-01", milesLeft: null }, "PM Reefer overdue since 09/01/2026"],
    [{ kind: "pm", name: null, pmKind: "other", verdict: "due", dueOn: "2026-11-01", milesLeft: null }, "Service due 11/01/2026"],
    [{ kind: "short", shortBy: 1, lastCheckedAt: null }, "Missing 1 piece of equipment"],
    [{ kind: "open_check", openedAt: "2026-10-19T14:00:00Z" }, "A check started 10/19/2026 was never closed"],
  ] as const)("%o", (reason, sentence) => {
    expect(attentionSentence(reason)).toBe(sentence);
  });

  it("points each reason at the section that answers it", () => {
    expect(attentionAnchor({ kind: "defect", count: 1, oldestDetectedAt: null })).toBe("section-repairs");
    expect(attentionAnchor({ kind: "pm", name: null, pmKind: "oil", verdict: "due", dueOn: null, milesLeft: 1 })).toBe("section-due");
    expect(attentionAnchor({ kind: "annual", expiresOn: "2026-11-10", daysRemaining: 1 })).toBe("section-annual");
    expect(attentionAnchor({ kind: "short", shortBy: 1, lastCheckedAt: null })).toBe("section-equipment");
  });
});
