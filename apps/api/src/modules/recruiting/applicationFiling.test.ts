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
import { CURRENT_LINK_APPLICATION, CURRENT_LINK_EMPLOYER, PART_ONE_ANSWERED } from "../../testing/partOneRow.js";
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

const EMPLOYER = CURRENT_LINK_EMPLOYER;

const APPLICATION = (over: Record<string, unknown> = {}) => ({
  application: { ...CURRENT_LINK_APPLICATION, ...over },
  ssn: null,
}) as unknown as Parameters<typeof submitApplication>[3];

const PART_ONE = PART_ONE_ANSWERED;

const seed = (opts: { marks?: unknown[]; tables?: Record<string, unknown> } = {}) =>
  createSupabaseRecorder({
    tables: {
      application_invitations: [invitation()],
      organizations: [{ name: "Silvicom" }],
      application_packet_marks: opts.marks ?? packet(),
      // The link a driver is sent: Part 1 answered, which the filing lays over the certified document.
      ...PART_ONE,
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
      tables: { application_invitations: [invitation({ signing_opened_at: "2026-09-27T14:00:00Z" })], ...PART_ONE, application_packet_marks: [] },
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

/**
 * Q-AM3 (0589): the SSN the form saved is filed from `application_ssns` — its last four and its sealed
 * envelope, unopened — and the pre-signing copy is deleted once the filing has committed, so the number
 * lives in one place. A number typed at sign-off (a page served before the form asked it) still wins.
 */
/**
 * Q-AM21 (a): page 21's statement is also the driver's §395.8(j)(2) record on the roster. Filing writes
 * it once, by its own function, with the days the packet prints (the seven before the application's
 * day) and the last-relieved wall time read in the carrier's zone; a filing without it writes nothing.
 */
describe("page 21 becomes the roster's seven-day statement (Q-AM21)", () => {
  const seededFiled = (payload: Record<string, unknown>) =>
    createSupabaseRecorder({
      tables: {
        application_invitations: [invitation()],
        organizations: [{ name: "Silvicom", operating_hours: { timezone: "America/Chicago" } }],
        application_packet_marks: packet(),
        ...PART_ONE,
        driver_applications: [{ payload, signed_name: "Susan Godfrey", certified_at: "2026-09-14T15:00:00Z" }],
      },
      rpc: { submit_driver_application: { application_id: "app-1" }, record_application_seven_day_statement: "sds-1" },
    });

  it("records the statement once, with the packet's dates and the carrier's clock", async () => {
    publish();
    const rec = seededFiled({ seven_day_hours: [0, 8, 10.5, 0, 0, 6, 4], last_relieved_at: "2026-09-13T17:30" });
    expect(isIntakeError(await submitApplication(rec.client, env(), TOKEN, APPLICATION(), CTX, NOW))).toBe(false);
    const call = rec.rpcs().find((c) => c.fn === "record_application_seven_day_statement")!.args as Record<string, unknown>;
    expect(call).toMatchObject({ p_org: ORG, p_application: "app-1", p_statement_date: "2026-09-14", p_signed_on: "2026-09-14", p_signed_name: "Susan Godfrey" });
    expect((call.p_days as Array<{ date: string; hours: number }>).map((d) => `${d.date}:${d.hours}`)).toEqual([
      "2026-09-07:0", "2026-09-08:8", "2026-09-09:10.5", "2026-09-10:0", "2026-09-11:0", "2026-09-12:6", "2026-09-13:4",
    ]);
    // 17:30 in Chicago (CDT, UTC−5) on 13 September.
    expect(call.p_last_relieved_at).toBe("2026-09-13T22:30:00.000Z");
  });

  it("records nothing for a filing that has no page 21", async () => {
    publish();
    const rec = seededFiled({});
    await submitApplication(rec.client, env(), TOKEN, APPLICATION(), CTX, NOW);
    expect(rec.rpcs().some((c) => c.fn === "record_application_seven_day_statement")).toBe(false);
  });
});

describe("the SSN the form saved is the one filed (Q-AM3)", () => {
  const ssnArgs = (rec: ReturnType<typeof seed>) => {
    const call = rec.rpcs().find((c) => c.fn === "submit_driver_application")?.args as Record<string, unknown>;
    return [call.p_ssn_last4, call.p_ssn_sealed];
  };
  const SAVED = { ...PART_ONE, application_ssns: [{ ssn_last4: "6789", ssn_sealed: "v1.sealed-by-the-form", entered_by: "applicant" }] };

  it("files the saved last four and sealed envelope as they are, then deletes the pre-signing row", async () => {
    publish();
    const rec = seed({ tables: SAVED });
    expect(isIntakeError(await submitApplication(rec.client, env(), TOKEN, APPLICATION(), CTX, NOW))).toBe(false);
    expect(ssnArgs(rec)).toEqual(["6789", "v1.sealed-by-the-form"]);
    const deletes = rec.forTable("application_ssns").filter((q) => q.ops.some((o) => o.method === "delete"));
    expect(deletes).toHaveLength(1);
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations"] });
  });

  it("files a number typed at sign-off over the saved one, and none when there is neither", async () => {
    publish();
    const typed = seed({ tables: SAVED });
    const body = { ...APPLICATION(), ssn: "111223333" } as Parameters<typeof submitApplication>[3];
    expect(isIntakeError(await submitApplication(typed.client, env(), TOKEN, body, CTX, NOW))).toBe(false);
    expect(ssnArgs(typed)[0]).toBe("3333");
    const none = seed({ tables: PART_ONE });
    expect(isIntakeError(await submitApplication(none.client, env(), TOKEN, APPLICATION(), CTX, NOW))).toBe(false);
    expect(ssnArgs(none)).toEqual([null, null]);
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
    // Two reads of Part 1, each scoped to the org: the resolver's "is this a current link?" and the filing's.
    expect(rec.forTable("application_intakes")).toHaveLength(2);
    expect(rec.forTable("application_intake_licences")).toHaveLength(1);
    // The token lookup is what FINDS the org, so it is the one read that cannot filter on it.
    expectOrgScoped(rec, ORG, { exempt: ["application_invitations"] });
  });

  /**
   * P3 (F2c part 2): an other licence's type is filed as Part 1 holds it. The recorder serves whole
   * fixture rows whatever is selected, so the read's own column list is asserted too — without `kind`
   * there, a real database would file every type as null.
   */
  it("files each other licence's type from Part 1, and reads the column it files", async () => {
    publish();
    const rec = seed({ tables: { ...PART_ONE, application_intake_licences: [
      ...PART_ONE.application_intake_licences,
      { position: 1, state_code: "OH", agency: null, licence_number: "OH55", expires_on: "2029-06-30", kind: "clp" },
    ] } });
    expect(isIntakeError(await submitApplication(rec.client, env(), TOKEN, APPLICATION(), CTX, NOW))).toBe(false);
    expect(filedPayload(rec)!.additional_licences).toEqual([
      { issuing_authority: "OH", number: "OH55", expires_at: "2029-06-30", kind: "clp" },
    ]);
    const select = rec.forTable("application_intake_licences")[0]!.ops.find((o) => o.method === "select");
    expect(String(select?.args[0]).split(",").map((c) => c.trim())).toContain("kind");
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

  /**
   * F2c: the carrier's page 2 asks question B (suspended or revoked) apart from A, and gives every
   * conviction a state and a penalty. A filing without them is refused in words.
   */
  it("refuses a filing that never answered question B, or a conviction with no state or penalty, and files nothing", async () => {
    publish();
    const rec = seed();
    const noB = await submitApplication(
      rec.client, env(), TOKEN, APPLICATION({ prior_failed_pre_employment_test: false, licence_suspended: null }), CTX, NOW,
    );
    expect(isIntakeError(noB) && noB.code).toBe("application_incomplete");
    expect(isIntakeError(noB) && noB.message).toContain("suspended or revoked");
    const noPenalty = await submitApplication(rec.client, env(), TOKEN, APPLICATION({
      prior_failed_pre_employment_test: false, declares_no_violations: false,
      violations: [{ occurred_on: "2025-02-01", offence: "Speeding", state: "IL", penalty: null }],
    }), CTX, NOW);
    expect(isIntakeError(noPenalty) && noPenalty.message).toContain("penalty");
    expect(rec.rpcs()).toHaveLength(0);
  });
});
