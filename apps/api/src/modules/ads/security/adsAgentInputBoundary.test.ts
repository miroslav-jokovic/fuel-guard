import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AD_AGENT_MODELS, leadOutcomeSchema, type AdClaudeAgent, type LeadQualityCounts } from "@silvicom/shared";
import type { ForcedToolRequest } from "../../../lib/anthropic.js";
import { leadEvidence } from "../plan/evidencePack.js";
import { EVAL_WORKERS, loadFixtures, type EvalWorker } from "../workers/agentFixtures.js";

/**
 * Q-APX2 (owner, 2026-11-14, ruled (a)): Fable 5.2 keeps requests for 30 days, accepted on one condition — no
 * ads agent is ever sent a lead's name, phone or e-mail. This file is that condition, held as a test so it
 * stays true as agents are added (ADS-PLATFORM-V2-PLAN §Q-APX2).
 *
 * ── WHY IT IS STRUCTURAL, AND WHAT IT THEREFORE CANNOT SEE ─────────────────────────────────────────────
 * A phone number and an e-mail address have a shape; a NAME does not. No check of a request's text can tell
 * "Maria Lopez" the applicant from "Maria Lopez Trucking" the carrier. So the rule is held where it can be
 * held exactly, in three places:
 *   1. every agent's real request, built by its own builder over every fixture, names no contact field and
 *      holds nothing shaped like a phone or an e-mail;
 *   2. the code that builds agent inputs (workers, compose, generations, plan) cannot reach a lead: it
 *      imports nothing from lead intake and names neither the lead contract nor a contact column;
 *   3. the only lead data that code may read — the two interfaces recruiting implements — carries counts,
 *      stages and ids, and no contact field.
 * There is deliberately NO runtime refusal at the rail: it could only match shapes, so it would stop an ad
 * for the carrier's own office number while letting a name through — a guard that fails in both directions.
 */

/** The lead's contact columns (0553) and the keys a platform form answers under; `answers` and `raw` are the lead whole. */
const CONTACT_KEY = /^(full_name|first_name|last_name|phone|phone_e164|phone_number|email|email_lower|street_address|date_of_birth|ssn|answers|raw)$/i;
const EMAIL = /[^\s@"<>]+@[^\s@"<>]+\.[a-z]{2,}/i;
const PHONE = /\+[1-9]\d{7,14}\b|\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/;

/** Every contact field or contact-shaped value in `text`: keys when it is JSON, shapes always. */
export function contactFindings(text: string): string[] {
  const found: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (CONTACT_KEY.test(k)) found.push(`key ${path}.${k}`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  try { walk(JSON.parse(text), "$"); } catch { /* prose: only the shapes below apply */ }
  const email = EMAIL.exec(text);
  if (email) found.push(`e-mail ${email[0]}`);
  const phone = PHONE.exec(text);
  if (phone) found.push(`phone ${phone[0]}`);
  return found;
}

const requestTexts = (req: ForcedToolRequest<unknown>): string[] => [
  req.system,
  ...(typeof req.user === "string" ? [req.user] : req.user.flatMap((p) => (p.type === "text" ? [p.text] : []))),
];

/** Typed over the agent list: an agent added to `AD_AGENT_MODELS` without a line here does not compile. */
const EVAL_OF: Record<AdClaudeAgent, keyof typeof EVAL_WORKERS> = {
  copywriter: "copywriter", art_director: "artDirector", checker: "checker", analyst: "analyst",
  craft_judge: "craftJudge", finished_ad_judge: "finishedAdJudge", strategist: "strategist",
  researcher: "researcher", swipe_reader: "swipeReader",
};

describe("Q-APX2 — the detector is not vacuous", () => {
  it("finds a lead's contact fields by key, wherever they sit in a sheet", () => {
    const sheet = JSON.stringify({ evidence: [{ id: "lead_outcome:x", lead: { full_name: "A B", phone_e164: "x", answers: { city: "Joliet" } } }] });
    expect(contactFindings(sheet)).toEqual(["key $.evidence[0].lead.full_name", "key $.evidence[0].lead.phone_e164", "key $.evidence[0].lead.answers"]);
  });

  it("finds an e-mail address and a phone number by shape, in JSON and in prose", () => {
    expect(contactFindings("Call the driver at (815) 555-0142 before noon.")).toEqual(["phone (815) 555-0142"]);
    expect(contactFindings(JSON.stringify({ note: "reach him at +18155550142" }))).toEqual(["phone +18155550142"]);
    expect(contactFindings(JSON.stringify({ note: "driver.one@example.com asked" }))).toEqual(["e-mail driver.one@example.com"]);
  });

  it("does not mistake the figures an agent is legitimately sent for a phone: money, counts, dates, miles", () => {
    expect(contactFindings(JSON.stringify({ day: "2026-11-03", spend: "$1,234.56", impressions: "42,100", text: "The opening pays $0.68 per mile and states 2500 miles over 14 days." }))).toEqual([]);
  });
});

describe("Q-APX2 — no ads agent is sent a lead's name, phone or e-mail", () => {
  it("every Claude agent has its request builder under this test", () => {
    expect(Object.keys(EVAL_OF).sort()).toEqual(Object.keys(AD_AGENT_MODELS).sort());
    expect([...new Set(Object.values(EVAL_OF))].sort()).toEqual(Object.keys(EVAL_WORKERS).sort());
  });

  it.each(Object.entries(EVAL_OF))("%s: every request it builds, over every fixture, carries no contact field or contact-shaped value", async (_agent, key) => {
    const worker = EVAL_WORKERS[key] as unknown as EvalWorker<unknown, unknown>;
    const fixtures = loadFixtures(worker);
    expect(fixtures.length).toBeGreaterThan(0);
    const leaks: string[] = [];
    for (const { fixture } of fixtures) {
      const req = await worker.request(fixture);
      for (const text of requestTexts(req)) for (const f of contactFindings(text)) leaks.push(`${worker.name(fixture)}: ${f}`);
    }
    expect(leaks).toEqual([]);
  }, 60_000);
});

describe("Q-APX2 — the code that builds agent inputs cannot reach a lead", () => {
  const ADS = new URL("..", import.meta.url).pathname;
  // `research` (V2r): the page fetch and the swipe file's read step, which build the Researcher's and the Swipe
  // reader's inputs. A competitor's page may print its own recruiting line or address; that is the page's
  // carrier's, not a lead's, and Q-APX2 is about leads — this check is that no lead can reach the input.
  const BUILDERS = ["workers", "compose", "generations", "plan", "research"];
  const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const at = join(dir, e.name);
    if (e.isDirectory()) return e.name === "fixtures" ? [] : sources(at);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [at] : [];
  });
  /** Lead intake's files, the lead as ads receives it, the table, and its three contact columns. */
  const REACHES_A_LEAD = /from "(?:\.\.\/)+leads\/|\bPlatformLead\b|\bplatformLeadSchema\b|\bLeadSink\b|\brecruiting_leads\b|\bfull_name\b|\bphone_e164\b|\bemail_lower\b/;

  it("no worker, compose, generation or plan file imports lead intake or names the lead contract or a contact column", () => {
    const files = BUILDERS.flatMap((d) => sources(join(ADS, d)));
    // Not vacuous: the walk found the builders, the Strategist and the evidence pack among them.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith("strategist/strategist.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("plan/evidencePack.ts"))).toBe(true);
    const offenders = files.flatMap((f) => {
      const hit = REACHES_A_LEAD.exec(readFileSync(f, "utf8"));
      return hit ? [`${f.slice(ADS.length)}: ${hit[0]}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("the same search does find lead intake, so it would find a builder that reached for it", () => {
    const intake = sources(join(ADS, "leads")).filter((f) => REACHES_A_LEAD.test(readFileSync(f, "utf8")));
    expect(intake.length).toBeGreaterThan(0);
  });
});

describe("Q-APX2 — what recruiting hands across carries no contact field", () => {
  it("a lead's outcome is its id, its campaign, its platform's id and when it reached each stage — nothing else", () => {
    expect(Object.keys(leadOutcomeSchema.shape).sort()).toEqual(["arrived_at", "campaign_id", "lead_id", "platform_lead_ref", "provider", "reached"]);
    // `.strict()`: a row with a name on it does not parse, so a field added on recruiting's side cannot ride along.
    const row = { lead_id: "70000000-0000-4000-8000-000000000001", campaign_id: "c", provider: "meta", platform_lead_ref: "1", arrived_at: "2026-11-15T00:00:00Z", reached: {} };
    expect(leadOutcomeSchema.safeParse(row).success).toBe(true);
    expect(leadOutcomeSchema.safeParse({ ...row, full_name: "A B" }).success).toBe(false);
  });

  it("lead quality is counts per campaign, and every sentence the evidence pack makes of them is free of contact data", () => {
    // Complete by type: a field added to `LeadQualityCounts` must be given here, and is then read below.
    const counts: Required<LeadQualityCounts> = {
      campaign_id: "120210000000000001", leads: 58, attempted: 44, wrong_number: 9, reached: 25, not_qualified: 21, median_first_attempt_minutes: 37,
      closed: { out_of_area: 11, not_interested: 4, unreachable: 3, wrong_number: 2, duplicate: 1, spam: 1 },
    };
    for (const [k, v] of Object.entries(counts)) if (k !== "campaign_id" && k !== "closed") expect(typeof v, k).toBe("number");
    const items = leadEvidence([counts]);
    expect(items.length).toBe(9);
    expect(items.flatMap((i) => contactFindings(JSON.stringify(i)))).toEqual([]);
  });
});
