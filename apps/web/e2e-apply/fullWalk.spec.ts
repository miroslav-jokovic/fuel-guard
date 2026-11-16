import { expect, test, type Locator } from "@playwright/test";
import { CARRIER, partTwoV2Link, stubApi, TOKEN } from "./stubApi";

/**
 * The whole history form on a phone, from opening the link to "They have your application"
 * (APPLICATION-FIX-PLAN §4, "How we prove U1–U9"): 390×844, English, one ordinary driver.
 *
 * ── WHO WALKS IT ──────────────────────────────────────────────────────────────────────────────
 * A driver who finished the first visit: the link asks their date of birth and gives back what they
 * said then (the stub's unlock releases Part 1's answers, as the API does). They have lived in two
 * homes in three years, had one driving job and some time in school before it, drive a tractor and
 * semi-trailer, and have a clean record. They give the carrier the answers it requires and pass the
 * three it does not.
 *
 * ── WHAT IT MEASURES, AND WHAT IT CANNOT ──────────────────────────────────────────────────────
 * The WORK the form asks of that driver: screens passed, taps, characters typed. Those are exact, so
 * they are pinned, and a change that adds a screen or a box to everybody's application shows up here
 * as a number that has to be changed on purpose.
 *
 * ⚠ Not minutes. A browser driven by a script finishes in seconds; how long a person takes is
 * measured from real applicants (`application_screen_events`, AW14) and from the owner's walk on a
 * real phone, never estimated from these counts.
 *
 * ── AND WHAT IT CHECKS ON THE WAY ─────────────────────────────────────────────────────────────
 * No screen is wider than the phone; every task closes Completed; "Before you send" names only the
 * three optional answers; the answers are saved before the send, which goes once; and nothing the page
 * asked for was unknown to the stub.
 * Each task's own rules (a refusal under its box, a gap, "Not sure") are its own spec's.
 */
test.use({ viewport: { width: 390, height: 844 } });

/** Part 1's answers, as the unlock releases them. */
const FACTS = {
  intake: {
    phone: "+13125550142", address_line1: "1 Main St", address_line2: null, city: "Joliet", state: "IL",
    postal_code: "60431", prior_positive_2y: false, cdl_class: "A",
  },
  licences: [{ position: 0, state_code: "IL", agency: null, licence_number: "IL123", expires_on: "2029-03-01" }],
  asOf: "2026-09-28",
};

test("an ordinary driver fills the history form on a phone and sends it: 38 screens, 68 taps, 112 characters", async ({ page }) => {
  const count = { screens: 0, taps: 0, typed: 0 };
  const widest = { px: 0, at: "" };
  const tap = async (target: Locator) => {
    count.taps += 1;
    await target.click();
  };
  /** One tap to put the cursor in the box, then the characters. */
  const type = async (target: Locator, text: string) => {
    count.taps += 1;
    count.typed += text.length;
    await target.fill(text);
  };
  /** Leaving a screen — measured first, so a screen too wide for the phone is named. */
  const leave = async () => {
    const px = await page.evaluate(() => document.documentElement.scrollWidth);
    if (px > widest.px) Object.assign(widest, { px, at: (await page.locator("main").innerText()).slice(0, 80) });
    count.screens += 1;
  };
  const next = async () => {
    await leave();
    const save = page.getByRole("button", { name: "Save and continue", exact: true });
    await tap((await save.count()) ? save : page.getByRole("button", { name: "Continue", exact: true }));
  };
  /** A one-question Yes/No, the regulation's or the carrier's: the tap is the answer and moves on (U3). */
  const pick = async (name: string) => {
    await leave();
    await tap(page.getByRole("radio", { name, exact: true }));
  };
  const open = (task: RegExp) => tap(page.getByRole("button", { name: task }));
  const completed = (task: string) => expect(page.getByRole("button", { name: `Open ${task}, Completed` })).toBeVisible();

  const stub = await stubApi(page, partTwoV2Link({
    draft: { locked: true, payload: { first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01" }, furthestSection: null, updatedAt: "2026-08-21T09:00:00.000Z", revision: 1 },
  }), { released: { partOne: FACTS } });
  await page.goto(`/apply/${TOKEN}`);

  // The link asks who is reading, once.
  await type(page.locator("input").first(), "04011980");
  await next();
  await expect(page.getByText("Do these in any order.")).toBeVisible();
  // "Your license" is Part 1's, so it is done before the driver touches it.
  await completed("Your license");

  // ── About you: 10 screens ────────────────────────────────────────────────────────────────────
  await open(/About you/);
  await next();                                                      // the name, already there
  await next();                                                      // other names: none
  await type(page.getByLabel("Email"), "susan@example.test");
  await next();
  await next();                                                      // the Social Security number: at signing
  await type(page.locator("#apply-questionnaire_answers-position"), "Company driver");
  await next();
  await tap(page.locator("#apply-questionnaire_answers-applying_as"));
  await tap(page.getByRole("option", { name: "Company driver" }));
  await next();
  await tap(page.getByRole("button", { name: "A friend or a driver" }));
  await next();
  await pick("Yes");                                                 // can legally work
  await pick("Yes");                                                 // has proof of age
  await expect(page.locator("[data-part-one-facts]")).toContainText("(312) 555-0142");
  await next();                                                      // Part 1's answers, shown
  await completed("About you");

  // ── Where you have lived: the home on record, and the one before ─────────────────────────────
  await open(/Where you have lived/);
  await expect(page.locator("[data-current-home]")).toContainText("1 Main St");
  await type(page.getByLabel("When did you move in?"), "072025");
  await next();
  await type(page.getByLabel("City"), "Gary");
  await tap(page.locator("#apply-addresses-1-state"));
  await type(page.locator("#apply-addresses-1-state"), "Indi");
  await tap(page.getByRole("option", { name: /Indiana/ }));
  await next();
  await type(page.locator("#apply-addresses-1-from"), "062023");
  await expect(page.locator("[data-address-coverage]")).toContainText("All 3 years are covered.");
  await next();
  await completed("Where you have lived");

  // ── Where you have worked: one job, the time before it, one kind of truck ────────────────────
  await open(/Where you have worked/);
  await pick("Yes");
  await next();
  await type(page.getByLabel("What was the company's name?"), "Midwest Freight");
  await next();
  await next();                                                      // where it was: the office completes it
  await type(page.getByLabel("When did you start?"), "06012025");
  await next();
  await pick("Yes");                                                 // drove a truck there
  await pick("Yes");                                                 // a DOT job
  await tap(page.getByRole("button", { name: "Better pay or miles" }));
  await next();
  await pick("No");                                                  // no other job
  await next();                                                      // "No job from…"
  await tap(page.getByRole("button", { name: "School or training" }));
  await next();
  await tap(page.getByRole("checkbox", { name: /semi/i }).first());
  await next();
  await type(page.getByLabel("When did you start driving it?"), "062025");
  await type(page.getByLabel("About how many miles?"), "100,000");
  await next();
  await next();                                                      // anything else about your driving: optional
  await pick("Yes");                                                 // may we contact your previous employers
  await completed("Where you have worked");

  // ── Your driving record: clean, four taps ────────────────────────────────────────────────────
  await open(/Your driving record/);
  for (let question = 0; question < 4; question += 1) await pick("No");
  await completed("Your driving record");

  // ── The carrier's own questions: the one it requires, and three it does not ──────────────────
  await open(/The carrier's own questions/);
  await tap(page.getByRole("button", { name: "Add one" }));
  await type(page.locator("#q-education-0-school"), "Joliet High");
  await type(page.locator("#q-education-0-years_completed"), "4");
  await tap(page.locator("#q-education-0-graduated"));
  await type(page.locator("#q-education-0-graduated_when"), "1998");
  await next();
  await next();                                                      // military service: passed
  await next();                                                      // other training: passed
  await next();                                                      // references: passed
  await completed("The carrier's own questions");

  // ── Before you send ──────────────────────────────────────────────────────────────────────────
  await open(/Before you send/);
  await expect(page.getByText("3 answers missing")).toBeVisible();
  await expect(page.getByText("These are optional. You can send without them.")).toBeVisible();
  await expect(page.getByText("Midwest Freight")).toBeVisible();
  // The phone as "About you" printed it, not as it is stored.
  await expect(page.getByText("(312) 555-0142").first()).toBeVisible();
  await expect(page.getByText("+13125550142")).toHaveCount(0);
  await leave();
  await tap(page.getByRole("button", { name: `Send it to ${CARRIER}` }));
  await expect(page.getByText("They have your application")).toBeVisible();

  expect(stub.callsTo("POST", /\/review$/)).toHaveLength(1);
  /**
   * ⚠ The answers reached the server BEFORE the hand-over. The hand-over carries none ("the answers are
   * already saved"), and a save goes out up to five seconds after the last keystroke — so a driver who
   * pressed Send inside that window used to hand over an application the server did not hold yet. This
   * walk found it: a script is always inside the window. `useApplicationDraft.settle` is the fix.
   */
  const order = stub.state.calls.map((c) => `${c.method} ${c.path.split("/").pop()}`);
  expect(order.lastIndexOf("PUT draft"), "no answers were saved before the hand-over").toBeGreaterThan(-1);
  expect(order.lastIndexOf("PUT draft")).toBeLessThan(order.indexOf("POST review"));
  expect(widest.px, `a screen is wider than the phone: "${widest.at}"`).toBeLessThanOrEqual(390);
  // The work, exactly. Change these only with the form: each is a screen, a tap or a keystroke asked of every driver.
  // 68 taps since the carrier's three Yes/No questions move on at the tap (71 while each needed Continue).
  expect(count).toEqual({ screens: 38, taps: 68, typed: 112 });

  const saved = stub.callsTo("PUT", /\/draft$/).at(-1)!.body as { payload: Record<string, unknown> };
  expect(saved.payload).toMatchObject({
    email: "susan@example.test",
    addresses: [{ line1: "1 Main St", from: "2025-07" }, { city: "Gary", state: "IN", from: "2023-06", to: "2025-07" }],
    employers: [{ employer_name: "Midwest Freight", started_on: "2025-06-01", operated_cmv: true, dot_regulated: true, reason_for_leaving: "Better pay or miles" }],
    employment_gaps: [{ explanation: "School or training" }],
    equipment_experience: [{ equipment_class: "tractor_semi_trailer" }],
    declares_no_accidents: true, declares_no_violations: true, licence_ever_denied: false, licence_suspended: false,
  });
  expect(stub.state.unstubbed).toEqual([]);
});
