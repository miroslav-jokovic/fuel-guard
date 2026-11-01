import { describe, expect, it } from "vitest";
import type { ApplicationCaptureView } from "@silvicom/shared";
import { emptyDraft, type ApplicationDraft } from "./draft";
import { hubTasks, taskStatus } from "./taskHub";
import { CARRIER_ANSWERS } from "@/testing/carrierAnswers";

/**
 * Part 2's statuses (§6.4, C3c2a), read off the draft by the rules that already judge it. Pinned: the
 * four statuses mean what the header says; "Before you send" opens exactly when every REQUIRED task
 * passes; the two optional tasks never hold it shut; and on a v2 link a task that parses but that
 * filing would refuse (an unexplained gap, C3c1) is In progress, not Completed.
 */
const AS_OF = "2026-09-26";

const complete = (): ApplicationDraft => ({
  ...emptyDraft(),
  // §9 P8: the carrier's seven required answers — a complete application gives them.
  questionnaire: { ...CARRIER_ANSWERS },
  experience: "Eight years, dry van and reefer.",
  first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
  email: "s@example.test", phone: "555-0111",
  addresses: [{ line1: "1 Road", line2: "", city: "Joliet", state: "IL", postal_code: "60432", from: "2020-01", to: "" }],
  cdl_number: "PA334554", cdl_state: "PA", cdl_expires_at: "2029-01-01",
  employers: [{
    key: "40000000-0000-4000-8000-00000000000a", employer_name: "Old Carrier", usdot_number: "123456",
    address_line1: "12 Depot Rd", city: "Joliet", state: "IL", phone: "555-0100", email: "", position_held: "Driver",
    started_on: "2023-01-01", ended_on: "", operated_cmv: true, dot_regulated: true,
    reason_for_leaving: "Still there", subject_to_fmcsr: true, safety_sensitive: true,
  }],
  declares_no_accidents: true, declares_no_violations: true,
  // (b)(9) answered — `emptyDraft` leaves it unanswered since C3c2c1, so a complete draft says No itself.
  licence_ever_denied: false,
});
const NONE: ApplicationCaptureView[] = [];
const status = (tasks: ReturnType<typeof hubTasks>, section: string) => tasks.find((t) => t.section === section)!.status;

describe("each task's status", () => {
  it("reads Not started when nothing on it would be filed — a blank row from an accidental Add included", () => {
    expect(taskStatus("employment", emptyDraft(), AS_OF, NONE)).toBe("not_started");
    expect(taskStatus("addresses", emptyDraft(), AS_OF, NONE)).toBe("not_started");
  });

  it("reads In progress once something is typed and the screen would not let them past", () => {
    const d = emptyDraft();
    d.first_name = "Susan";
    expect(taskStatus("identity", d, AS_OF, NONE)).toBe("in_progress");
  });

  it("reads Completed when the screen would let them past", () => {
    expect(taskStatus("identity", complete(), AS_OF, NONE)).toBe("completed");
    expect(taskStatus("employment", complete(), AS_OF, NONE)).toBe("completed");
  });

  it("on a v2 link, holds a task that parses but that filing would refuse at In progress", () => {
    const d = complete();
    d.employers[0]!.started_on = "2025-01-01";
    // Parses; but the months before 2025 are an unexplained gap, which a v2 filing refuses (C3c1).
    expect(taskStatus("employment", d, null, NONE)).toBe("completed");
    expect(taskStatus("employment", d, AS_OF, NONE)).toBe("in_progress");
  });

  it("counts the documents from what is on file — one paper sent is the task done (§9 P9)", () => {
    const cap = (slot: string): ApplicationCaptureView => ({ slot, contentType: "image/webp", bytes: 1, capturedAt: "2026-09-20T00:00:00Z" }) as ApplicationCaptureView;
    expect(taskStatus("documents", emptyDraft(), AS_OF, [])).toBe("not_started");
    // The licence came with Part 1: it is shown on the list, and is not this task's doing.
    expect(taskStatus("documents", emptyDraft(), AS_OF, [cap("cdl_front"), cap("cdl_back")])).toBe("not_started");
    expect(taskStatus("documents", emptyDraft(), AS_OF, [cap("cdl_front"), cap("twic")])).toBe("completed");
  });
});

describe("Before you send", () => {
  it("cannot start while a required task does not pass", () => {
    const d = complete();
    d.declares_no_accidents = false;
    expect(status(hubTasks(d, AS_OF, NONE), "review")).toBe("cannot_start");
  });

  it("opens when every required task passes, with the optional one untouched", () => {
    const tasks = hubTasks(complete(), AS_OF, NONE);
    expect(status(tasks, "questions")).toBe("completed");
    expect(status(tasks, "documents")).toBe("not_started");
    expect(status(tasks, "review")).toBe("not_started");
  });

  /** §9 P8 (AF-2): the carrier's questions held "Before you send" open untouched; seven are required now. */
  it("stays shut while a required carrier question is unanswered, and counts the task's answers", () => {
    const d = complete();
    const { education: _gone, ...rest } = d.questionnaire;
    d.questionnaire = rest;
    const tasks = hubTasks(d, AS_OF, NONE);
    expect(status(tasks, "questions")).toBe("in_progress");
    expect(status(tasks, "review")).toBe("cannot_start");
    expect(tasks.find((t) => t.section === "questions")!.answered).toEqual({ answered: 0, total: 4 });
  });

  it("lists every task in §6.4's order and ends with Before you send", () => {
    const tasks = hubTasks(complete(), AS_OF, NONE);
    expect(tasks.map((t) => t.section)).toEqual([
      "identity", "addresses", "licence", "employment", "safety", "questions", "documents", "review",
    ]);
    expect(tasks.filter((t) => t.optional).map((t) => t.section)).toEqual(["documents"]);
  });
});
