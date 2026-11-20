import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { factsFor, leadFromTenstreet, leadProjectionSchema, tenstreetEnvelope, tenstreetReply, tenstreetSays } from "@silvicom/shared";
import { readTenstreetXml, TENSTREET_MAX_BYTES } from "./tenstreetXml.js";

/**
 * TS2 (TENSTREET-INTAKE-PLAN; Q-APX29 (a)): Tenstreet's three sample posts, read as the receiver will, with the
 * SSN and the EEO answers proved gone before anything is kept. The committed samples are redacted to `xxx-xx-NNNN`
 * (Tenstreet's own guide asks it of any file sent around), so each test plants a full number — an SSA-invalid one,
 * area 000 — and checks it reaches neither the sealed text nor the lead.
 */
const SAMPLES = [1, 2, 3].map((n) => readFileSync(new URL(`../../../../../../docs/tenstreet/samples/receiving_application_data_sample_${n}_xml.txt`, import.meta.url), "utf8"));
const PLANTED = "000-12-3456";
const withSsn = (xml: string) => xml.replace(/(documentType="SSN">)xxx-xx-\d{4}/g, `$1${PLANTED}`);
const read = (xml: string) => {
  const r = readTenstreetXml(xml);
  if (!r.ok) throw new Error(r.reason);
  return r;
};

describe("readTenstreetXml — the SSN and the EEO answers never survive", () => {
  it.each([0, 1, 2])("sample %i: every GovernmentID and the EEO block are removed from the text that is kept", (i) => {
    const xml = withSsn(SAMPLES[i]!);
    expect(xml).toContain(PLANTED);
    const r = read(xml);
    expect(r.cleaned).not.toContain(PLANTED);
    expect(r.cleaned).not.toMatch(/GovernmentID|EqualEmploymentOpportunityData|EeoQuestion|EeoAnswer/);
    expect(r.removed.government_id).toBeGreaterThan(0);
    expect(JSON.stringify(r.root)).not.toContain(PLANTED);
  });

  it("sample 1's seven EEO answers are counted out, and the job's own EEO category in another sample stays", () => {
    expect(SAMPLES[0]).toMatch(/<EeoAnswer>/);
    expect(read(SAMPLES[0]!).removed.eeo).toBe(1);
    expect(read(SAMPLES[1]!).cleaned).toContain("<EeoCategory>");
  });

  it("an SSN anywhere in the document is found, however deep", () => {
    const deep = SAMPLES[2]!.replace("</TenstreetData>", `<A><B><C><GovernmentID documentType="SSN">${PLANTED}</GovernmentID></C></B></A></TenstreetData>`);
    expect(read(deep).cleaned).not.toContain(PLANTED);
  });
});

describe("readTenstreetXml — hostile input (D-TS10)", () => {
  it("refuses a DOCTYPE or an ENTITY, a body that is not XML, another root, and one over the size limit", () => {
    expect(readTenstreetXml(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><TenstreetData>&e;</TenstreetData>`)).toEqual({ ok: false, reason: "doctype" });
    expect(readTenstreetXml("not xml at all <")).toEqual({ ok: false, reason: "not_xml" });
    expect(readTenstreetXml("<Other/>")).toEqual({ ok: false, reason: "not_tenstreet" });
    expect(readTenstreetXml(`<TenstreetData>${"x".repeat(TENSTREET_MAX_BYTES)}</TenstreetData>`)).toEqual({ ok: false, reason: "too_large" });
  });
});

describe("leadFromTenstreet — a post as a lead", () => {
  it("sample 1 becomes a Tenstreet lead with its name, phone, e-mail and the Driver id as its reference", () => {
    const r = leadFromTenstreet(read(SAMPLES[0]!).root);
    if (!r.ok) throw new Error(r.reason);
    expect(r.envelope).toEqual({ mode: "TEST", company_id: "14", driver_id: "6346598" });
    expect(r.lead).toMatchObject({
      channel: "tenstreet", external_ref: "6346598", source: "companysite", campaign_ref: null, opening_id: null, platform_created_at: null,
      full_name: "John Public", phone_e164: "+19181231231", email_lower: "johnqpublic@email.com",
    });
    expect(leadProjectionSchema.safeParse(r.lead).success).toBe(true);
  });

  it("every sample projects to a lead the store accepts, and none carries the SSN, the date of birth outside the facts, or an address", () => {
    for (const xml of SAMPLES) {
      const r = leadFromTenstreet(read(withSsn(xml)).root);
      if (!r.ok) throw new Error(r.reason);
      expect(leadProjectionSchema.safeParse(r.lead).success).toBe(true);
      const outside = JSON.stringify({ ...r.lead, answers: undefined });
      expect(outside).not.toContain(PLANTED);
      expect(outside).not.toMatch(/DateOfBirth|date_of_birth|Address1|PostalCode/);
      expect(JSON.stringify(r.lead)).not.toContain(PLANTED);
    }
  });

  it("the facts reader judges what the projection carries: Class A, its hazmat endorsement, the MVR answers", () => {
    const r = leadFromTenstreet(read(SAMPLES[0]!).root);
    if (!r.ok) throw new Error(r.reason);
    const facts = factsFor("tenstreet", r.lead.answers, "2026-11-20");
    expect(facts.class_a_held).toEqual({ value: true, evidence: "self_reported" });
    expect(facts.hazmat_endorsement).toEqual({ value: true, evidence: "self_reported" });
    expect(facts.dui).toBeDefined();
    expect(facts.date_of_birth).toEqual({ value: "1960-10-10", evidence: "self_reported" });
  });

  it("Tenstreet's own status is kept to be shown, never as our status (D-TS8)", () => {
    const root = read(SAMPLES[0]!).root;
    expect(tenstreetSays(root)).toMatchObject({ status: "New", worklist: "Student", recruiter: "Philip Phillips", app_referrer: "CompanySite" });
    const r = leadFromTenstreet(root);
    expect(r.ok && r.lead.raw).toEqual({ tenstreet: tenstreetSays(root) });
  });

  it("a post with no usable DriverId is no lead; a CompanyId or Mode outside the guide's shape reads as none", () => {
    const root = read(SAMPLES[0]!.replace("<DriverId>6346598</DriverId>", "<DriverId>../x</DriverId>").replace("<Mode>TEST</Mode>", "<Mode>LIVE</Mode>").replace("<CompanyId>14</CompanyId>", "<CompanyId>14a</CompanyId>")).root;
    expect(tenstreetEnvelope(root)).toEqual({ mode: null, company_id: null, driver_id: null });
    expect(leadFromTenstreet(root)).toEqual({ ok: false, reason: "no_driver_id" });
  });
});

describe("tenstreetReply", () => {
  it("is the guide's TenstreetResponse, escaped, cut at 255 characters", () => {
    expect(tenstreetReply("Accepted", "Success", "6346598")).toBe(`<?xml version="1.0" encoding="UTF-8"?>\n<TenstreetResponse>\n\t<DriverId>6346598</DriverId>\n\t<Status>Accepted</Status>\n\t<Description>Success</Description>\n</TenstreetResponse>\n`);
    const r = tenstreetReply("Rejected", `<b>&${"x".repeat(400)}`, null);
    expect(r).toContain("<Description>&lt;b&gt;&amp;");
    expect(/<Description>(.*)<\/Description>/.exec(r)![1]!.length).toBeLessThanOrEqual(255 + 12);
  });
});
