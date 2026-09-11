import { describe, it, expect } from "vitest";
import { isDraftDisclosure, ESIGN_CONSENT_CLAUSES } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { isWordingError, loadCarrierWording, outstandingWording, publishWording } from "./carrierWording.js";

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

  it("⚠ leaves every unpublished instrument a draft, so its refusal stays put", async () => {
    const rec = seed([published()]);
    const wording = await loadCarrierWording(rec.client, ORG);
    expect(isDraftDisclosure(wording.disclosures.psp.version)).toBe(true);
    expect(isDraftDisclosure(wording.esignConsent.version)).toBe(true);
  });

  it("⚠ fails CLOSED when the table cannot be read", async () => {
    // A database blip on the applicant's page load must not take the form down, and the state it
    // degrades to has to be "nothing may be signed" — never the other one. So the error is not
    // thrown: it produces the placeholders, which are `v0-draft`, which every refusal already reads.
    const rec = createSupabaseRecorder({
      tables: { org_disclosures: { data: null, error: { message: "db is down" } } },
    });
    const wording = await loadCarrierWording(rec.client, ORG);
    for (const purpose of ["fcra_disclosure", "psp", "previous_employer", "clearinghouse", "drug_alcohol"] as const) {
      expect(isDraftDisclosure(wording.disclosures[purpose].version)).toBe(true);
    }
    expect(isDraftDisclosure(wording.esignConsent.version)).toBe(true);
  });

  it("scopes the read to the carrier asking", async () => {
    const rec = seed([published()]);
    await loadCarrierWording(rec.client, ORG);
    expectOrgScoped(rec, ORG);
  });

  it("names everything still owed, and that is six for a carrier that has published nothing", async () => {
    expect(await outstandingWording(seed([]).client, ORG)).toHaveLength(6);
    expect(await outstandingWording(seed([published()]).client, ORG)).not.toContain("fcra_disclosure");
  });
});

describe("publishing", () => {
  it("assigns the first version and records the act", async () => {
    const rec = seed([], { rpc: {} });
    const result = await publishWording(
      rec.client, ORG,
      { instrument: "psp", title: "PSP", intent: "I authorize it.", body: "The PSP wording." },
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
    expect(JSON.stringify(audit)).not.toContain("The PSP wording.");
  });

  it("⚠ never takes a version from the request", async () => {
    // `driver_authorizations` stores the text AND the version; if a carrier could name the version,
    // two signatures could name one version and mean different things.
    const rec = seed([], { rpc: {} });
    await publishWording(
      rec.client, ORG,
      { instrument: "psp", title: "PSP", intent: "i", body: "b", version: "v99" } as never,
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
      { instrument: "psp", title: "t", intent: "i", body: "b" },
      { actorId: ACTOR },
    );
    expect(isWordingError(result) && result.code).toBe("publish_raced");
  });
});
