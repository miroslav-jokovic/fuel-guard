import { normalisePhone } from "../../smsConsentContract.js";
import { normaliseEmail, normaliseName, type LeadProjection } from "./leadContract.js";
import { tenstreetDate, type TenstreetProjection } from "./facts/tenstreet.js";

/**
 * A Tenstreet post, as a lead (TENSTREET-INTAKE-PLAN TS2; ADS-PLATFORM-V2-PLAN Q-APX29 (a), ruled 2026-11-20). Pure:
 * the api parses the XML into `TsNode`s (`recruiting/tenstreet/tenstreetXml.ts`, which also removes the SSN and the
 * EEO block before anything is kept) and this turns the tree into what `ingest_lead` stores. Field names are the
 * guide's (rev 11/2014) and its three samples (`docs/tenstreet/samples/`).
 *
 * ── WHAT THE LEAD GETS, AND WHAT IT NEVER DOES ───────────────────────────────────────────────────
 *   channel        `tenstreet`; external_ref = `DriverId` (0553's unique (org, channel, external_ref) is the dedupe)
 *   source         `AppReferrer` as a token (`CompanySite` → `companysite`), else null
 *   name/phone/email  `PersonName` Given + Family; `PrimaryPhone`, else `SecondaryPhone`; `InternetEmailAddress`
 *   answers        ONE key, `projection`: the `TenstreetProjection` the facts reader judges (`facts/tenstreet.ts`)
 *   raw            Tenstreet's own words about where the applicant stands — status, worklist, recruiter, referrer,
 *                  the application date as sent — shown, never obeyed (D-TS8)
 * Never: the SSN or the EEO answers (removed before this runs, D-TS4/D-TS5), the date of birth outside the
 * projection the age verdict reads (D-TS6), the address history, the criminal-record answers, notes or documents.
 *
 * ── WHAT IS NOT GUESSED ──────────────────────────────────────────────────────────────────────────
 *   · `platform_created_at` is null: `LastApplicationDate` ("2011-04-08 14:36:02") carries no zone and the guide
 *     names none, so the lead's arrival is when WE received it. The date as sent is kept in `raw`.
 *   · `opening_id` is null: nothing in a post names one of our openings; the lead is matched once a recruiter or a
 *     later mapping says which (no verdicts until then — `recordLeadVerdicts` needs an opening).
 *   · A licence is never `documented`: `DqfData/DqfDocument/DqfStatus` reads "missing" in the samples and the guide
 *     lists no other value, so "received" is not known by its word. Everything stays `self_reported`.
 */

/** One element, as the api's parser hands it over: name, attributes, its own text, its child elements. */
export interface TsNode {
  name: string;
  attrs: Record<string, string>;
  text: string;
  children: TsNode[];
}

const kid = (n: TsNode | undefined, name: string): TsNode | undefined => n?.children.find((c) => c.name === name);
const kids = (n: TsNode | undefined, name: string): TsNode[] => n?.children.filter((c) => c.name === name) ?? [];
const txt = (n: TsNode | undefined): string | null => {
  const v = (n?.text ?? "").trim();
  return v.length > 0 ? v : null;
};
const at = (n: TsNode | undefined, ...path: string[]): TsNode | undefined => path.reduce<TsNode | undefined>((cur, p) => kid(cur, p), n);
const yn = (n: TsNode | undefined): "y" | "n" | null => {
  const v = (txt(n) ?? "").toLowerCase();
  return v === "y" || v === "yes" ? "y" : v === "n" || v === "no" ? "n" : null;
};

export type TenstreetMode = "TEST" | "PROD";

export interface TenstreetEnvelope {
  mode: TenstreetMode | null;
  company_id: string | null;
  driver_id: string | null;
}

/** What Tenstreet says about where the applicant stands (D-TS8: shown, never obeyed). */
export interface TenstreetSays {
  status: string | null;
  worklist: string | null;
  recruiter: string | null;
  app_referrer: string | null;
  app_source: string | null;
  last_application_date: string | null;
}

/** The three fields a reply and a refusal need, read before anything else. */
export function tenstreetEnvelope(root: TsNode): TenstreetEnvelope {
  const mode = (txt(kid(root, "Mode")) ?? "").toUpperCase();
  const company = txt(kid(root, "CompanyId"));
  const driver = txt(kid(root, "DriverId"));
  return {
    mode: mode === "TEST" || mode === "PROD" ? mode : null,
    company_id: company && /^\d{1,20}$/.test(company) ? company : null,
    driver_id: driver && /^[A-Za-z0-9_-]{1,64}$/.test(driver) ? driver : null,
  };
}

const sayCap = (v: string | null): string | null => (v === null ? null : v.slice(0, 200));

export function tenstreetSays(root: TsNode): TenstreetSays {
  const app = kid(root, "ApplicationData");
  return {
    status: sayCap(txt(kid(app, "Status"))), worklist: sayCap(txt(kid(app, "Worklist"))), recruiter: sayCap(txt(kid(app, "RecruiterAssigned"))),
    app_referrer: sayCap(txt(kid(app, "AppReferrer"))), app_source: sayCap(txt(kid(app, "AppSource"))), last_application_date: sayCap(txt(kid(app, "LastApplicationDate"))),
  };
}

/** The facts reader's input (`facts/tenstreet.ts`), read from the post. */
export function tenstreetFactsInput(root: TsNode): TenstreetProjection {
  const app = kid(root, "ApplicationData");
  const licences = kids(kid(app, "Licenses"), "License").map((l) => ({
    current: yn(kid(l, "CurrentLicense")),
    cdl: yn(kid(l, "CommercialDriversLicense")),
    class: (txt(kid(l, "LicenseClass")) ?? "").slice(0, 4) || null,
    original_issue_date: tenstreetDate(txt(kid(l, "OriginalIssueDate"))),
    endorsements: kids(kid(l, "Endorsements"), "Endorsement").map((e) => (txt(e) ?? "").slice(0, 40)).filter((e) => e.length > 0),
    documented: false,
  }));
  const accidentsNode = kid(app, "Accidents");
  const accidents = kids(accidentsNode, "Accident").map((a) => ({
    date: tenstreetDate(txt(kid(a, "Date"))), dot_reportable: yn(kid(a, "DOTReportable")), preventable: yn(kid(a, "Preventable")), in_commercial_vehicle: yn(kid(a, "InCommercialVehicle")),
  }));
  const mvr: TenstreetProjection["mvr"] = {};
  for (const r of kids(kid(app, "MotorVehicleRecords"), "MotorVehicleRecord")) {
    const type = (r.attrs.Type ?? "").trim();
    if (!/^[A-Za-z]{1,60}$/.test(type)) continue;
    const a = (r.attrs.Answer ?? "").trim().toLowerCase();
    mvr[type] = { answer: a === "y" ? "y" : a === "n" ? "n" : null, date: tenstreetDate(r.attrs.Date) };
  }
  const custom: Record<string, string> = {};
  for (const q of kids(kid(app, "CustomQuestions"), "CustomQuestion")) {
    const id = txt(kid(q, "QuestionId"));
    if (id && /^[A-Za-z0-9_.-]{1,80}$/.test(id)) custom[id] = (txt(kid(q, "Answer")) ?? "").slice(0, 2000);
  }
  return {
    date_of_birth: tenstreetDate(txt(at(root, "PersonalData", "DateOfBirth"))),
    licences, accidents_asked: accidentsNode !== undefined, accidents, mvr, custom,
  };
}

const sourceToken = (v: string | null): string | null => {
  const t = (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 62);
  return /^[a-z][a-z0-9_]{1,62}$/.test(t) ? t : null;
};

export type TenstreetLead = { ok: true; envelope: TenstreetEnvelope & { driver_id: string }; lead: LeadProjection } | { ok: false; reason: "no_driver_id" };

export function leadFromTenstreet(root: TsNode): TenstreetLead {
  const envelope = tenstreetEnvelope(root);
  if (!envelope.driver_id) return { ok: false, reason: "no_driver_id" };
  const person = at(root, "PersonalData", "PersonName");
  const contact = at(root, "PersonalData", "ContactData");
  const says = tenstreetSays(root);
  const name = [txt(kid(person, "GivenName")), txt(kid(person, "FamilyName"))].filter(Boolean).join(" ");
  return {
    ok: true,
    envelope: { ...envelope, driver_id: envelope.driver_id },
    lead: {
      channel: "tenstreet",
      external_ref: envelope.driver_id,
      source: sourceToken(says.app_referrer),
      campaign_ref: null,
      opening_id: null,
      platform_created_at: null,
      raw: { tenstreet: says },
      answers: { projection: JSON.stringify(tenstreetFactsInput(root)) },
      full_name: normaliseName(name),
      phone_e164: normalisePhone(txt(kid(contact, "PrimaryPhone"))) ?? normalisePhone(txt(kid(contact, "SecondaryPhone"))),
      email_lower: normaliseEmail(txt(kid(contact, "InternetEmailAddress"))),
    },
  };
}

// ── the reply ────────────────────────────────────────────────────────────────────────────────────
const esc = (v: string) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");

/**
 * The reply Tenstreet reads (`receiving_documents_from_tenstreet_response_sample_xml.txt`): `TenstreetResponse` with
 * the `DriverId`, `Status` Accepted or Rejected, and a `Description`. Ours never carries a person's data — only a
 * fixed sentence — and is cut at 255 characters.
 */
export function tenstreetReply(status: "Accepted" | "Rejected", description: string, driverId: string | null): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<TenstreetResponse>\n\t<DriverId>${esc(driverId ?? "")}</DriverId>\n\t<Status>${status}</Status>\n\t<Description>${esc(description.slice(0, 255))}</Description>\n</TenstreetResponse>\n`;
}
