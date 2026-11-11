import { describe, it, expect } from "vitest";
import type { DriverApplication } from "@silvicom/shared";
import { pdfPageCount, pdfPageTexts } from "../../../../testing/pdfText.js";
import { renderPacketDocument } from "../packetDocument.js";
import { addendumSections } from "./packetAddendum.js";

/**
 * F2 (APPLICATION-FIX-PLAN §3: P1, P6, P7, P8): the answers the carrier's paper has no place for, on a sheet
 * appended to the packet. What each one says is pinned here; that every catalogued fact reaches the sheet
 * is `applicantFactsPacket.test.ts`'s.
 */
const TEMPLATE_PAGES = 31;

const EMPLOYER = {
  key: "11111111-1111-4111-8111-111111111111",
  employer_name: "Acme Freight",
  usdot_number: "1234567",
  address_line1: "1 Dock Rd",
  city: "Joliet",
  state: "IL",
  phone: "(555) 011-9999",
  email: "hr@acme.test",
  position_held: "Driver",
  started_on: "2020-01-01",
  ended_on: "2024-03-31",
  operated_cmv: true,
  dot_regulated: false,
  reason_for_leaving: "Wanted regional runs.",
  subject_to_fmcsr: true,
  safety_sensitive: null,
};

const APP = {
  first_name: "Susan",
  last_name: "Godfrey",
  date_of_birth: "1980-04-01",
  email: "susan@example.test",
  phone: "(555) 011-1234",
  addresses: [
    { line1: "1301 Armitage Ave", city: "Melrose Park", state: "IL", postal_code: "60160", from: "2024-01", to: null },
    { line1: "9 Elm St", city: "Gary", state: "IN", postal_code: "46401", from: "2021-03", to: "2023-12" },
  ],
  experience: "",
  employers: [EMPLOYER],
  declares_no_employment: false,
  employment_gaps: [{ from: "2019-06-01", to: "2019-12-31", explanation: "Caring for family." }],
  certified: true,
  signed_name: "Susan Godfrey",
} as unknown as DriverApplication;

const answers = (a: DriverApplication) =>
  Object.fromEntries(addendumSections(a).flatMap((s) => s.entries.map((e) => [`${s.heading} | ${e.question}`, e.answer])));

describe("the addendum's answers", () => {
  it("prints each employer's (b)(10) answers under its name and dates, and a blank one as not answered", () => {
    const got = answers(APP);
    const job = "Acme Freight, 01/01/2020 to 03/31/2024";
    expect(got[`${job} | Reason for leaving`]).toBe("Wanted regional runs.");
    expect(got[`${job} | USDOT number`]).toBe("1234567");
    expect(got[`${job} | E-mail for the previous-employer inquiry`]).toBe("hr@acme.test");
    expect(got[`${job} | Did you drive a commercial motor vehicle in this job?`]).toBe("Yes");
    expect(got[`${job} | Was this employer regulated by the DOT?`]).toBe("No");
    expect(got[`${job} | Were you subject to the Federal Motor Carrier Safety Regulations in this job?`]).toBe("Yes");
    // ⚠ Never an invented "No": an unanswered yes/no is said to be unanswered.
    expect(got[`${job} | Was the job a safety-sensitive function subject to DOT drug and alcohol testing?`]).toBe("Not answered.");
  });

  it("names each address beside its months, and the current one as running to the present", () => {
    const got = answers(APP);
    const heading = "Addresses for the past three years: the dates at each";
    expect(got[`${heading} | 1301 Armitage Ave, Melrose Park, IL, 60160`]).toBe("01/2024 to present");
    expect(got[`${heading} | 9 Elm St, Gary, IN, 46401`]).toBe("03/2021 to 12/2023");
  });

  it("prints the applicant's e-mail, an unanswered experience as not answered, and each stretch without work", () => {
    const got = answers(APP);
    expect(got["Applicant | E-mail"]).toBe("susan@example.test");
    expect(got["Applicant | The nature and extent of the applicant's experience"]).toBe("Not answered.");
    expect(got["Time without an employer | 06/01/2019 to 12/31/2019"]).toBe("Caring for family.");
  });

  it("prints no employer for an applicant who declared none, whatever rows a draft still holds", () => {
    const none = { ...APP, declares_no_employment: true } as DriverApplication;
    expect(addendumSections(none).some((s) => s.heading?.startsWith("Acme Freight"))).toBe(false);
  });
});

describe("the addendum in the packet", () => {
  const render = (application: DriverApplication) =>
    renderPacketDocument({ marks: [], application, certifiedAt: "2026-09-12T10:00:00Z", signedName: "Susan Godfrey" });

  it("is appended after the carrier's pages, never among them, and continues their page numbers", async () => {
    const pages = await pdfPageTexts(await render(APP));
    expect(pages.length).toBe(TEMPLATE_PAGES + 1);
    expect(pages.slice(0, TEMPLATE_PAGES).some((p) => p.includes("APPLICATION ADDENDUM"))).toBe(false);
    const sheet = pages.at(-1)!;
    expect(sheet).toContain("APPLICATION ADDENDUM");
    expect(sheet).toContain("Attached to and part of the application of Susan Godfrey");
    expect(sheet).toMatch(/Reason for leaving\s*Wanted regional runs\./);
    expect(sheet).toContain(String(TEMPLATE_PAGES + 1));
  });

  it("heads an employer again on the page its answers continue onto", async () => {
    const employers = Array.from({ length: 9 }, (_, i) => ({ ...EMPLOYER, key: `1111111${i}-1111-4111-8111-111111111111`, employer_name: `Carrier ${i}` }));
    const pdf = await render({ ...APP, employers } as DriverApplication);
    expect(await pdfPageCount(pdf)).toBeGreaterThan(TEMPLATE_PAGES + 1);
    const sheets = (await pdfPageTexts(pdf)).slice(TEMPLATE_PAGES);
    for (const page of sheets.slice(1)) {
      expect(page).toContain("APPLICATION ADDENDUM (CONTINUED)");
      // Every page of employers opens on an employer's name, never on a headless question.
      const body = page.slice(page.indexOf("Page 11: attach sheet if more space is needed.") + 46).trim();
      expect(body).toMatch(/^(Carrier \d|Time without an employer)/);
    }
  });
});
