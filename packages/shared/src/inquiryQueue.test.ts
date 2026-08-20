import { describe, it, expect } from "vitest";
import {
  EMPLOYER_RESPONSE_DAYS,
  INVESTIGATION_FILE_DAYS,
  compareInquiryUrgency,
  driverInquiryQueue,
  employerInquiryState,
  type QueueAttempt,
  type QueueEmployment,
} from "./inquiryQueue.js";

const TODAY = "2026-08-20";

const employer = (over: Partial<QueueEmployment> = {}): QueueEmployment => ({
  id: "emp-1",
  employerName: "Old Carrier",
  startedOn: "2024-01-01",
  endedOn: "2025-06-30",
  dotRegulated: true,
  ...over,
});

const attempt = (over: Partial<QueueAttempt> = {}): QueueAttempt => ({
  employmentId: "emp-1",
  contactedOn: "2026-08-01",
  outcome: "awaiting",
  ...over,
});

describe("where one employer's inquiry stands", () => {
  it("is not sent when nobody has written", () => {
    expect(employerInquiryState(employer(), [], TODAY)).toMatchObject({ state: "not_sent", attempts: 0 });
  });

  it("is awaiting while their §391.23(g)(1) thirty days are still running", () => {
    const state = employerInquiryState(employer(), [attempt()], TODAY);
    expect(state.state).toBe("awaiting");
    expect(state.theirDeadline).toBe("2026-08-31");
  });

  it("becomes overdue once their thirty days are up", () => {
    expect(employerInquiryState(employer(), [attempt({ contactedOn: "2026-07-01" })], TODAY).state).toBe("overdue");
  });

  /** A fresh request restarts their clock, because §391.23(g)(1) runs from the request they answer. */
  it("takes the clock from the latest attempt, not the first", () => {
    const state = employerInquiryState(
      employer(),
      [attempt({ contactedOn: "2026-06-01" }), attempt({ contactedOn: "2026-08-15" })],
      TODAY,
    );
    expect(state.state).toBe("awaiting");
    expect(state.attempts).toBe(2);
  });

  it("is answered when any attempt got a reply", () => {
    expect(
      employerInquiryState(employer(), [attempt({ contactedOn: "2026-06-01" }), attempt({ outcome: "responded" })], TODAY).state,
    ).toBe("answered");
  });

  /** §391.23(c)(1) accepts documented good-faith efforts in place of a reply — this is DONE. */
  it("is documented when the non-response was written down", () => {
    expect(employerInquiryState(employer(), [attempt({ outcome: "no_response" })], TODAY).state).toBe("documented");
  });

  it("says a letter never reached them rather than counting the days", () => {
    const state = employerInquiryState(employer(), [attempt({ outcome: "undeliverable" })], TODAY);
    expect(state.state).toBe("undeliverable");
    expect(state.theirDeadline).toBeNull();
  });

  it("ignores attempts belonging to another employer", () => {
    expect(employerInquiryState(employer(), [attempt({ employmentId: "emp-OTHER" })], TODAY).state).toBe("not_sent");
  });
});

describe("one driver's §391.23 position", () => {
  const base = { employment: [employer()], attempts: [] as QueueAttempt[], today: TODAY };

  it("gives a hired driver a deadline thirty days after they started", () => {
    const queue = driverInquiryQueue({ ...base, hireDate: "2026-08-10" });
    expect(queue.fileDeadline).toBe("2026-09-09");
    expect(queue.daysToDeadline).toBe(20);
  });

  it("counts the deadline as passed once it has", () => {
    const queue = driverInquiryQueue({ ...base, hireDate: "2026-06-01" });
    expect(queue.daysToDeadline).toBeLessThan(0);
  });

  /** §391.23(c)(1) counts from "the date the driver's employment begins" — an applicant has none. */
  it("gives an applicant no deadline rather than inventing one", () => {
    const queue = driverInquiryQueue({ ...base, hireDate: null });
    expect(queue.fileDeadline).toBeNull();
    expect(queue.daysToDeadline).toBeNull();
    // They still owe the inquiry; they are simply not late for it.
    expect(queue.outstanding).toHaveLength(1);
  });

  it("counts a documented non-response as complete, not as outstanding forever", () => {
    const queue = driverInquiryQueue({
      ...base,
      attempts: [attempt({ outcome: "no_response" })],
      hireDate: "2026-08-10",
    });
    expect(queue.outstanding).toEqual([]);
    expect(queue.complete).toBe(true);
  });

  it("leaves a non-DOT employer out of the §391.23(a)(2) obligation entirely", () => {
    const queue = driverInquiryQueue({
      ...base,
      employment: [employer({ dotRegulated: false })],
      hireDate: "2026-08-10",
    });
    expect(queue.employers).toEqual([]);
    expect(queue.complete).toBe(true);
  });

  /**
   * The window is measured from the hire date, for `employmentCoverage`'s own reason: measuring a
   * long-serving employee against today would manufacture obligations nobody ever had.
   */
  it("drops an employer who fell outside the three years before the hire", () => {
    const queue = driverInquiryQueue({
      ...base,
      employment: [employer({ startedOn: "2018-01-01", endedOn: "2019-01-01" })],
      hireDate: "2026-08-10",
    });
    expect(queue.employers).toEqual([]);
  });

  it("keeps an employer whose job straddles the window's edge", () => {
    const queue = driverInquiryQueue({
      ...base,
      employment: [employer({ startedOn: "2020-01-01", endedOn: "2024-01-01" })],
      hireDate: "2026-08-10",
    });
    expect(queue.employers).toHaveLength(1);
  });
});

describe("the order a queue should be worked in", () => {
  it("puts the file closest to its deadline first, and the undeadlined last", () => {
    const rows = [
      { daysToDeadline: null },
      { daysToDeadline: 12 },
      { daysToDeadline: -3 },
    ];
    expect([...rows].sort(compareInquiryUrgency).map((r) => r.daysToDeadline)).toEqual([-3, 12, null]);
  });

  it("uses the day counts the regulation names", () => {
    expect(EMPLOYER_RESPONSE_DAYS).toBe(30);
    expect(INVESTIGATION_FILE_DAYS).toBe(30);
  });
});
