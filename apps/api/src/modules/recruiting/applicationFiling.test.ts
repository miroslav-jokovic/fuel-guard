import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPLICATION_RELEASE_ORDER,
  DISCLOSURES,
  ESIGN_CONSENT,
  driverPlacementIds,
  packetPlacementById,
} from "@silvicom/shared";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { hashInvitationToken, isIntakeError } from "./applicationIntake.js";
import { submitApplication } from "./applicationSubmit.js";
import { recordPacketMark } from "./applicationPacketMarks.js";
import { packetTextVersion, packetTextVersionOf } from "./applicationPdf/packet/packetTextVersion.js";
import { PACKET_TEMPLATE_PATH, readPacketTemplate } from "./applicationPdf/packet/packetTemplate.js";

/**
 * C2c — what filing does that it did not before: A-5's packet text version, and D-AW3's composed
 * payload with AW1's v2 rules on it. The pre-C2c submit behaviour stays pinned in
 * `applicationIntake.test.ts`, whose fixtures now sign under the printed version.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const NOW = new Date("2026-09-27T15:00:00Z");
const TOKEN = "c".repeat(43);
const CTX = { ip: "203.0.113.9", userAgent: "UA" };
const env = () => loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
const PRINTED = await packetTextVersion();

afterEach(() => vi.restoreAllMocks());

const publish = (): void => {
  for (const purpose of APPLICATION_RELEASE_ORDER) vi.spyOn(DISCLOSURES[purpose], "version", "get").mockReturnValue("v1");
  vi.spyOn(ESIGN_CONSENT, "version", "get").mockReturnValue("v1");
};

const invitation = (over: Record<string, unknown> = {}) => ({
  id: "inv-1", org_id: ORG, driver_id: DRIVER, token_hash: hashInvitationToken(TOKEN),
  expires_at: "2026-10-30T00:00:00Z", revoked_at: null, consented_at: "2026-09-20T09:00:00Z",
  releases_completed_at: "2026-09-20T09:30:00Z", application_sent_at: "2026-09-21T09:00:00Z",
  review_requested_at: "2026-09-22T09:00:00Z", approved_at: "2026-09-23T10:00:00Z",
  signing_opened_at: "2026-09-27T14:00:00Z", submitted_at: null, sign_token_hash: null,
  ...over,
});

const packet = (version: string | null = PRINTED) =>
  driverPlacementIds(null).map((placement_id) => {
    const mark = packetPlacementById(placement_id)?.mark ?? "signature";
    return { placement_id, mark, signed_name: mark === "initials" ? "SG" : "Susan Godfrey", packet_version: version };
  });

/** An employer answering every (b)(10) question, covering the whole three-year window. */
const EMPLOYER_ID = "5b0c6a4e-1f2d-4c3b-9a8e-7d6c5b4a3f21";
const EMPLOYER = {
  key: EMPLOYER_ID, employer_name: "Midwest Freight",
  address_line1: "1 Main St", city: "Joliet", state: "IL",
  started_on: "2020-01-01", ended_on: null, operated_cmv: true, dot_regulated: true,
  reason_for_leaving: "Still employed", subject_to_fmcsr: true, safety_sensitive: true,
};

const APPLICATION = (over: Record<string, unknown> = {}) => ({
  application: {
    first_name: "Susan", last_name: "Godfrey", date_of_birth: "1980-04-01",
    email: "s@example.test", phone: "555-0111",
    addresses: [{ line1: "typed", line2: null, city: "typed", state: "WI", postal_code: "53201", from: "2019-02", to: null }],
    cdl_number: "TYPED1", cdl_state: "WI", cdl_expires_at: "2027-01-01",
    additional_licences: [], experience: "Eight years, dry van.",
    accidents: [], declares_no_accidents: true, violations: [], declares_no_violations: true,
    licence_ever_denied: false, prior_failed_pre_employment_test: null,
    employers: [EMPLOYER], declares_no_employment: false, employment_gaps: [],
    certified: true as const, signed_name: "Susan Godfrey",
    ...over,
  },
  ssn: null,
}) as unknown as Parameters<typeof submitApplication>[3];

const PART_ONE = {
  application_intakes: [{
    phone: "+13125550142", address_line1: "1 Main St", address_line2: null, city: "Joliet", state: "IL",
    postal_code: "60431", prior_positive_2y: false,
  }],
  application_intake_licences: [{ position: 0, state_code: "IL", agency: null, licence_number: "IL123", expires_on: "2029-03-01" }],
};

const seed = (opts: { marks?: unknown[]; tables?: Record<string, unknown> } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: [invitation()],
      organizations: [{ name: "Silvicom" }],
      application_packet_marks: opts.marks ?? packet(),
      ...opts.tables,
    },
    rpc: { submit_driver_application: { application_id: "app-1" } },
  });

const filedPayload = (rec: ReturnType<typeof seed>) =>
  (rec.rpcs().find((c) => c.fn === "submit_driver_application")?.args as { p_payload: Record<string, unknown> } | undefined)
    ?.p_payload;

describe("the packet text version (A-5)", () => {
  it("is derived from the words that print, so the spelling register already moves it off the carrier's file", async () => {
    expect(PRINTED).toBe(packetTextVersionOf(await readPacketTemplate()));
    expect(PRINTED).not.toBe(packetTextVersionOf(await readPacketTemplate(PACKET_TEMPLATE_PATH)));
  });

  it("changes when one printed run changes", async () => {
    const pages = await readPacketTemplate();
    const edited = pages.map((p, i) => (i !== 6 ? p : { ...p, runs: p.runs.map((r, j) => (j === 0 ? { ...r, text: `${r.text}!` } : r)) }));
    expect(packetTextVersionOf(edited)).not.toBe(PRINTED);
  });

  it("is stamped on every mark, selecting 0376's thirteen-argument overload", async () => {
    const rec = createSupabaseRecorder({
      tables: { application_invitations: [invitation({ signing_opened_at: "2026-09-27T14:00:00Z" })], application_packet_marks: [] },
      rpc: { record_packet_mark: { mark_id: "m-1", signed_count: 1, complete: false } },
    });
    await recordPacketMark(rec.client, TOKEN, { placement_id: "p03", signed_name: "Susan Godfrey", esign_consent: true }, CTX, NOW);
    expect(rec.rpcs()[0]!.args).toMatchObject({ p_packet_version: PRINTED, p_adoption_id: null });
  });
});

describe("filing refuses marks made under another text (A-5)", () => {
  it("refuses marks with no recorded text, pending Q-AW2, and files nothing", async () => {
    publish();
    const rec = seed({ marks: packet(null) });
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION(), CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("packet_signed_before_versioning");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses marks made under a text that no longer prints", async () => {
    publish();
    const rec = seed({ marks: packet("pk-0000000000000000") });
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION(), CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("packet_text_changed");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses a packet in which only one place is under another text", async () => {
    publish();
    const marks = packet();
    marks[3] = { ...marks[3]!, packet_version: "pk-0000000000000000" };
    const result = await submitApplication(seed({ marks }).client, env(), TOKEN, APPLICATION(), CTX, NOW);
    expect(isIntakeError(result) && result.code).toBe("packet_text_changed");
  });
});

describe("a v2 invitation files the composed application (D-AW3, AW1)", () => {
  it("files Part 1's phone, street, licence and §40.25(j) answer, org-scoped", async () => {
    publish();
    const rec = seed({ tables: PART_ONE });
    const result = await submitApplication(rec.client, env(), TOKEN, APPLICATION(), CTX, NOW);
    expect(isIntakeError(result)).toBe(false);
    const filed = filedPayload(rec)!;
    expect(filed.phone).toBe("+13125550142");
    expect((filed.addresses as Array<Record<string, unknown>>)[0]).toMatchObject({ line1: "1 Main St", city: "Joliet", from: "2019-02" });
    expect([filed.cdl_number, filed.cdl_state, filed.cdl_expires_at]).toEqual(["IL123", "IL", "2029-03-01"]);
    expect(filed.prior_failed_pre_employment_test).toBe(false);
    expect(rec.forTable("application_intakes")).toHaveLength(1);
    expect(rec.forTable("application_intake_licences")).toHaveLength(1);
    // The token lookup is what FINDS the org, so it is the one read that cannot filter on it.
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations"] });
  });

  it("refuses a v2 filing that misses AW1's rules, naming each, and files nothing", async () => {
    publish();
    const rec = seed({ tables: PART_ONE });
    const result = await submitApplication(
      rec.client, env(), TOKEN, APPLICATION({ employers: [{ ...EMPLOYER, reason_for_leaving: null, address_line1: null }] }), CTX, NOW,
    );
    expect(isIntakeError(result) && result.code).toBe("application_incomplete");
    expect(isIntakeError(result) && result.message).toContain("Say why you left this job");
    expect(isIntakeError(result) && result.message).toContain("Give this employer's street, city and state");
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("asks a legacy invitation nothing new and files what it certified", async () => {
    publish();
    const rec = seed();
    const result = await submitApplication(
      rec.client, env(), TOKEN, APPLICATION({ employers: [{ ...EMPLOYER, reason_for_leaving: null }] }), CTX, NOW,
    );
    expect(isIntakeError(result)).toBe(false);
    const filed = filedPayload(rec)!;
    expect([filed.phone, filed.cdl_number]).toEqual(["555-0111", "TYPED1"]);
    expect(rec.forTable("application_intake_licences")).toHaveLength(0);
  });
});
