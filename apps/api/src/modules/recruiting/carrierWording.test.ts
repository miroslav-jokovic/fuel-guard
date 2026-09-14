import { describe, it, expect } from "vitest";
import { isDraftDisclosure, DISCLOSURES, ESIGN_CONSENT_CLAUSES } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { isWordingError, loadCarrierWording, outstandingWording, publishWording } from "./carrierWording.js";
import { pspDisclosure } from "./pspDisclosure.js";

/**
 * Publishing the carrier's own wording (0338).
 *
 * ⚠ The assertion that matters most is the one about a FAILED read. Every refusal in the applicant's
 * path is `isDraftDisclosure(doc.version)`, so a loader that returned something published-looking
 * when it could not reach the table would open the signing gate on placeholder text. It has to fail
 * closed, and it has to be shown to.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ACTOR = "cccccccc-dddd-4eee-8fff-000000000000";

const published = (over: Record<string, unknown> = {}) => ({
  instrument: "fcra_disclosure",
  version: "v1",
  title: "Consumer report disclosure",
  body: "We may obtain consumer reports about you for employment purposes.",
  clauses: null,
  intent: "I authorize the preparation of consumer reports about me.",
  published_at: "2026-09-11T10:00:00Z",
  published_by: ACTOR,
  ...over,
});

const seed = (rows: Array<Record<string, unknown>> = [], over: Record<string, unknown> = {}) =>
  createSupabaseRecorder({
    tables: { org_disclosures: rows, audit_logs: [] },
    ...over,
  });

describe("reading what a carrier has published", () => {
  it("uses the carrier's text where it exists", async () => {
    const rec = seed([published()]);
    const wording = await loadCarrierWording(rec.client, ORG);
    expect(wording.disclosures.fcra_disclosure.version).toBe("v1");
    expect(isDraftDisclosure(wording.disclosures.fcra_disclosure.version)).toBe(false);
  });

  /**
   * ⚠ **This assertion turned over on 2026-09-14 (D-WORD1) and the turn is the change.** It used to
   * read "leaves every unpublished instrument a draft, so its refusal stays put" — correct while
   * the base was the engineer's placeholders and the only way to a usable instrument was a carrier
   * publishing one. The base is now `defaultWording()`: FMCSA's forms, the statute, the carrier's
   * own packet. An unpublished instrument is no longer an unusable one.
   */
  it("⚠ leaves every unpublished instrument on the SHIPPED wording, which is not a draft", async () => {
    const rec = seed([published()]);
    const wording = await loadCarrierWording(rec.client, ORG);
    expect(isDraftDisclosure(wording.disclosures.psp.version)).toBe(false);
    expect(isDraftDisclosure(wording.esignConsent.version)).toBe(false);
    // And it is really FMCSA's form behind it, not our placeholder wearing a new version string.
    expect(wording.disclosures.psp.body).toContain("Pre-Employment Screening Program (PSP)");
  });

  /**
   * ⚠ **Fails safe, and "safe" has a new meaning.** A database blip on the applicant's page load
   * must not take the form down. It used to degrade to the placeholders — `v0-draft`, nothing may
   * be signed — because the shipped text was a guess and a locked door was the only safe direction.
   * It now degrades to the shipped catalogue, which is the right words. The carrier's OVERRIDE is
   * what is lost, and losing an override to a blip is recoverable; serving text nobody approved was
   * not.
   */
  it("⚠ degrades to the shipped catalogue when the table cannot be read", async () => {
    const rec = createSupabaseRecorder({
      tables: { org_disclosures: { data: null, error: { message: "db is down" } } },
    });
    const wording = await loadCarrierWording(rec.client, ORG);
    for (const purpose of ["fcra_disclosure", "psp", "previous_employer", "clearinghouse", "drug_alcohol"] as const) {
      expect(isDraftDisclosure(wording.disclosures[purpose].version)).toBe(false);
    }
    expect(isDraftDisclosure(wording.esignConsent.version)).toBe(false);
  });

  it("scopes the read to the carrier asking", async () => {
    const rec = seed([published()]);
    await loadCarrierWording(rec.client, ORG);
    // ⚠ `organizations` is exempt because it is filtered on `id` — the tenant's own primary key,
    // which is tighter than an `org_id` column and which the recorder cannot recognise as scoping.
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  it("owes nothing for a carrier that has published nothing", async () => {
    // The number `/settings/application-wording` used to lead with, before the page was deleted:
    // six outstanding on day one. It is zero now, which is why the page had nothing left to do.
    expect(await outstandingWording(seed([]).client, ORG)).toEqual([]);
    expect(await outstandingWording(seed([published()]).client, ORG)).toEqual([]);
  });
});

describe("publishing", () => {
  it("assigns the first version and records the act", async () => {
    const rec = seed([], { rpc: {} });
    const result = await publishWording(
      rec.client, ORG,
      { instrument: "fcra_disclosure", title: "Consumer reports", intent: "I authorize it.", body: "The carrier's wording." },
      { actorId: ACTOR },
    );
    expect(isWordingError(result)).toBe(false);
    if (isWordingError(result)) return;
    expect(result.version).toBe("v1");

    const row = rec.writtenRows("org_disclosures")[0] as Record<string, unknown>;
    expect(row.version).toBe("v1");
    expect(row.published_by).toBe(ACTOR);
    expect(row.clauses).toBeNull();

    const audit = rec.writtenRows("audit_logs")[0] as Record<string, unknown>;
    expect(audit.action).toBe("disclosure_published");
    // ⚠ The instrument and version, never the text. An audit row is not a second copy of a legal
    // instrument — `org_disclosures` is, and it is append-only.
    expect(JSON.stringify(audit)).not.toContain("The carrier's wording.");
  });

  it("⚠ never takes a version from the request", async () => {
    // `driver_authorizations` stores the text AND the version; if a carrier could name the version,
    // two signatures could name one version and mean different things.
    const rec = seed([], { rpc: {} });
    await publishWording(
      rec.client, ORG,
      { instrument: "fcra_disclosure", title: "t", intent: "i", body: "b", version: "v99" } as never,
      { actorId: ACTOR },
    );
    expect((rec.writtenRows("org_disclosures")[0] as Record<string, unknown>).version).toBe("v1");
  });

  it("stores the consent as clauses rather than a body", async () => {
    const rec = seed([], { rpc: {} });
    const clauses = Object.fromEntries(ESIGN_CONSENT_CLAUSES.map((c) => [c, `our ${c}`]));
    await publishWording(
      rec.client, ORG,
      { instrument: "esign_consent", title: "Signing electronically", intent: "I agree.", clauses },
      { actorId: ACTOR },
    );
    const row = rec.writtenRows("org_disclosures")[0] as Record<string, unknown>;
    expect(Object.keys(row.clauses as object)).toHaveLength(ESIGN_CONSENT_CLAUSES.length);
    // ⚠ And the composed text is stored beside them. Composed at PUBLISH time, not at read time: a
    // rendering change must never alter what an already-signed instrument said.
    for (const c of ESIGN_CONSENT_CLAUSES) expect(row.body as string).toContain(`our ${c}`);
  });

  it("tells the office somebody else got there first, rather than failing opaquely", async () => {
    // The unique index on (org_id, instrument, version). Two recruiters pressing Publish at the same
    // moment both compute the same next integer; one of them loses, and has to see what is live.
    const rec = createSupabaseRecorder({
      tables: {
        // The COUNT read succeeds and the insert fails — which is the shape of the real race. The
        // fixture branches on `q.write`, because by the time it is called the whole chain is recorded.
        org_disclosures: (q) =>
          q.write
            ? { data: null, error: { message: 'duplicate key value violates unique constraint "uq_org_disclosures_version"' } }
            : { data: [], error: null },
        audit_logs: [],
      },
    });
    const result = await publishWording(
      rec.client, ORG,
      { instrument: "fcra_disclosure", title: "t", intent: "i", body: "b" },
      { actorId: ACTOR },
    );
    expect(isWordingError(result) && result.code).toBe("publish_raced");
  });
});

/**
 * ⚠ The one instrument a carrier does not get to word (2026-09-13).
 *
 * Every other publish in this file proves the carrier's own text wins. This proves the exception,
 * and the exception is not ours: FMCSA publishes the PSP disclosure and requires it "in whole,
 * exactly as provided", so a report pulled behind an edited consent breaches the account-holder
 * agreement the API token is issued under. An office that shortened it would lose their PSP access
 * without anybody telling them — so the refusal happens here, at the publish, and names what went.
 */
describe("publishing the PSP disclosure", () => {
  const mandated = pspDisclosure("Silvicom Inc");

  it("accepts FMCSA's own language, with the carrier's name filled in", async () => {
    const rec = seed([], { rpc: {} });
    const result = await publishWording(
      rec.client, ORG,
      { instrument: "psp", title: mandated.title, intent: mandated.intent, body: mandated.body },
      { actorId: ACTOR },
    );
    expect(isWordingError(result)).toBe(false);
    expect(rec.writtenRows("org_disclosures")).toHaveLength(1);
  });

  it("refuses a shortened one, names the paragraph, and writes nothing", async () => {
    const rec = seed([], { rpc: {} });
    const short = mandated.body.split("\n\n").filter((p) => !p.startsWith("Any crash")).join("\n\n");
    const result = await publishWording(
      rec.client, ORG,
      { instrument: "psp", title: mandated.title, intent: mandated.intent, body: short },
      { actorId: ACTOR },
    );
    expect(isWordingError(result) && result.code).toBe("psp_wording_not_mandated");
    expect(isWordingError(result) && result.message).toContain("Any crash");
    // Nothing published, and — just as important — nothing audited as though it had been.
    expect(rec.writtenRows("org_disclosures")).toEqual([]);
    expect(rec.writtenRows("audit_logs")).toEqual([]);
  });

  it("refuses our own placeholder, which is what an untouched editor would have sent", async () => {
    const rec = seed([], { rpc: {} });
    const result = await publishWording(
      rec.client, ORG,
      { instrument: "psp", title: "PSP", intent: "I authorize it.", body: DISCLOSURES.psp.body },
      { actorId: ACTOR },
    );
    expect(isWordingError(result) && result.code).toBe("psp_wording_not_mandated");
  });
});
