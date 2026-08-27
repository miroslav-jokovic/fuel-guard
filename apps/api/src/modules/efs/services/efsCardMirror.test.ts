import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetEfsSessions } from "../lib/efsSoapSession.js";
import { __resetSoapPacing } from "../lib/soapClient.js";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { cardRefHmac, syncEfsCards, upsertCardDetail } from "./efsCardMirror.js";
import type { EfsSoapCredentials } from "./efsSoapCredentials.js";
import { testEnv } from "../../../testing/testEnv.js";

/**
 * Two things this suite exists to prove, both of which the type system cannot.
 *
 * 1. NO PLAINTEXT CARD NUMBER REACHES THE DATABASE. getCardSummaries returns the whole fleet's PANs in
 *    one response; every one of them passes through this service. The scan at the bottom is the
 *    mechanical proof, and it looks at what was actually written rather than at what we intended.
 * 2. EVERY QUERY IS ORG-SCOPED. getSupabaseAdmin is the SERVICE ROLE and bypasses RLS, so a dropped
 *    `.eq("org_id", …)` has no second line of defence. expectOrgScoped is the only thing that catches it.
 */

const ORG = "org-1";
const OTHER_ORG = "org-2";

const env = testEnv({
  EFS_SOAP_MAX_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_BACKFILL_DAYS: 90,
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
  // 32 bytes, base64 — a test key, never a deploy key.
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
});

const creds: EfsSoapCredentials = {
  orgId: ORG,
  environment: "production",
  endpointUrl: "https://ws.efsllc.com/axis2/services/CardManagementWS/",
  soapUsername: "user", soapPassword: "pass", accountId: null,
  postedLastCursor: null, rejectedLastCursor: null,
  postedLastPolledAt: null, rejectedLastPolledAt: null,
  postedLastSuccessAt: null, rejectedLastSuccessAt: null,
  postedLastError: null, rejectedLastError: null,
  enabled: true, fromEnvFallback: false, tls: null,
};

const PAN_A = "70830000000000001";
const PAN_B = "70830000000000002";

const soap = (body: string) =>
  `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
const loginOk = soap("<loginResponse><result>sess-1</result></loginResponse>");
/** A roster that legitimately returns no cards — must never be read as "tombstone the fleet". */
const emptySummaries = soap("<getCardSummariesV2Response><result></result></getCardSummariesV2Response>");
const cardDetail = readFileSync(
  fileURLToPath(new URL("../lib/__fixtures__/efs/getCardV2.full.xml", import.meta.url)), "utf8",
);

const summaries = soap(`<getCardSummariesV2Response><result>
  <value><cardNumber>${PAN_A}</cardNumber><policyNumber>14</policyNumber><unitNumber>3182</unitNumber>
    <driverId>D-4471</driverId><status>Active</status><override>0</override></value>
  <value><cardNumber>${PAN_B}</cardNumber><policyNumber>3</policyNumber><status>Hold</status><override>1</override></value>
</result></getCardSummariesV2Response>`);

function stub(...responses: string[]): typeof fetch {
  let i = 0;
  return (async () => new Response(responses[i++] ?? cardDetail, { status: 200 })) as typeof fetch;
}

/** Every `{code, source, at}` record this sweep wrote, in order (Step 7.5 / migration 0198). */
const syncErrorWrites = (rec: ReturnType<typeof createSupabaseRecorder>) =>
  rec
    .writtenRows("efs_cards")
    .map((r) => r.sync_error as { code?: string; source?: string; at?: string } | null)
    .filter((v): v is { code: string; source: string; at: string } => !!v && typeof v === "object");

afterEach(() => {
  __resetEfsSessions();
  __resetSoapPacing();
});

describe("syncEfsCards", () => {
  it("mirrors the roster and then deepens it with a per-card read", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    const result = await syncEfsCards(rec.client, env, creds, {
      fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail),
    });

    expect(result.cardsSeen).toBe(2);
    expect(result.upserted).toBe(2);
    expect(result.detailed).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("NEVER writes a plaintext card number", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail) });

    const written = JSON.stringify(rec.writtenRows("efs_cards"));
    expect(written).not.toContain(PAN_A);
    expect(written).not.toContain(PAN_B);
    // The mechanical form of the same assertion: nothing card-number-shaped, whatever the column.
    expect(written).not.toMatch(/\d{10,}/);
  });

  it("stores the number sealed AND as a keyed lookup handle", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail) });

    const row = rec.writtenRows("efs_cards")[0]!;
    expect(String(row.card_number_sealed)).toMatch(/^v1\./); // secretBox envelope
    expect(String(row.card_ref_hmac)).toMatch(/^[0-9a-f]{64}$/);
    expect(row.card_last4).toBe("0001");
  });

  it("scopes every query to the org", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail) });
    expectOrgScoped(rec, ORG);
  });

  it("never writes to fuel_cards — attribution is not this service's job", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail) });

    // Two writers on one row is how both end up wrong; syncCardAssignments owns fuel_cards and its
    // manual rows are authoritative.
    expect(rec.forTable("fuel_cards").filter((q) => q.write !== null)).toHaveLength(0);
  });

  it("refuses to store anything when the sealing key is absent", async () => {
    // Matches saveSamsaraToken: refuse to persist rather than silently fall back to plaintext.
    const rec = createSupabaseRecorder({ tables: { efs_cards: [] } });
    const result = await syncEfsCards(rec.client, testEnv({ ...env, SECRETS_ENCRYPTION_KEY: undefined }), creds, {
      fetchImpl: stub(loginOk, summaries),
    });

    expect(result.errors[0]).toMatch(/SECRETS_ENCRYPTION_KEY/);
    expect(rec.writtenRows("efs_cards")).toHaveLength(0);
  });

  it("does NOT tombstone the fleet when the roster comes back empty (audit P2 guard)", async () => {
    // A vendor blip returning zero cards is indistinguishable from a real empty account here, and
    // marking every card absent on one empty response is exactly the damage this file refuses. An
    // empty roster must touch nothing.
    const rec = createSupabaseRecorder({
      tables: { efs_cards: [{ org_id: ORG, card_ref_hmac: "a".repeat(64), absent_since: null }], fuel_cards: [] },
    });
    const result = await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, emptySummaries) });

    expect(result.cardsSeen).toBe(0);
    expect(result.tombstoned).toBe(0);
    // Nothing was marked absent — no write carrying an absent_since timestamp went out.
    const wrote = JSON.stringify(rec.writtenRows("efs_cards"));
    expect(wrote).not.toContain("absent_since");
  });

  it("carries on when one card's detail read fails, and records why on that row", async () => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    const result = await syncEfsCards(rec.client, env, creds, {
      fetchImpl: stub(loginOk, summaries, soap("<soap:Fault><faultstring>InvalidParameterNameID</faultstring></soap:Fault>"), cardDetail),
    });

    // One unreadable card must not abandon the other 399.
    expect(result.detailed).toBe(1);
    expect(result.failed).toBe(1);
    // Step 7.5: the structured record migration 0198 enforces, not the bare string it replaced. The
    // old assertion — "some write carried a truthy sync_error" — is satisfied by BOTH shapes, which
    // is the definition of a test that cannot tell the fix from the bug.
    const errored = syncErrorWrites(rec).at(-1);
    expect(errored).toMatchObject({ source: "detail", code: expect.stringContaining("InvalidParameterNameID") });
    expect(typeof errored?.at).toBe("string");
  });

  it("records a ROSTER-pass failure on the card's own row, not only in the job's stats", async () => {
    // A roster write that fails for one card used to exist exclusively in `result.errors` — the job
    // ledger's stats blob, which is not what somebody looking at that card sees. `source` is what
    // makes the column able to carry both passes at all.
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: (q) => (q.write?.method === "upsert" ? { writeError: { message: "policy_number out of range" } } : []),
        fuel_cards: [],
      },
    });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail) });

    const roster = syncErrorWrites(rec).filter((r) => r.source === "roster");
    expect(roster.length).toBeGreaterThan(0);
    expect(roster[0]!.code).toContain("policy_number");
  });

  it("masks card numbers on the way into the sync_error COLUMN, not just into the job's log", async () => {
    /**
     * A new surface, and it is the one this file's header exists for. Before Step 7.5 the vendor's
     * words only ever reached `result.errors` — a stats blob — and the masking test below asserts
     * that path. `recordSyncError` now writes them into a DATABASE COLUMN that a page renders, so a
     * PAN in a Postgres error message would be persisted and displayed. Same `errorText`, second
     * consumer, and the assertion has to follow it there.
     */
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: (q) =>
          q.write?.method === "upsert" ? { writeError: { message: `card ${PAN_A} rejected` } } : [],
        fuel_cards: [],
      },
    });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail) });

    const written = JSON.stringify(syncErrorWrites(rec));
    expect(written).not.toContain(PAN_A);
    expect(written).toContain("••••0001");
  });

  it("does NOT let the roster pass clear an error the detail pass recorded", async () => {
    /**
     * Step 7.5, and the whole behavioural half of it.
     *
     * `sync_error` had one WRITER (the detail pass) and two CLEARERS, the second being the roster
     * pass — which runs FIRST and set the column to null for every card on every sweep, before the
     * budgeted detail pass had a chance to re-record anything. A card whose detail read failed on
     * Monday was reported clean on Tuesday whether or not anything had managed to re-read it.
     *
     * Reverting the omission in `rosterFields` turns this red.
     */
    const rec = createSupabaseRecorder({
      tables: { efs_cards: [{ card_ref_hmac: cardRefHmac(env, ORG, PAN_A) }], fuel_cards: [] },
    });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail) });

    // The roster pass touches every card. Not one of its writes may carry the column at all — an
    // explicit null is exactly the erasure, and omission is the only way to leave the value alone.
    const rosterWrites = rec
      .forTable("efs_cards")
      .filter((q) => (q.write?.payload as Record<string, unknown> | undefined)?.status !== undefined)
      .filter((q) => (q.write?.payload as Record<string, unknown>).document === undefined);
    expect(rosterWrites.length).toBeGreaterThan(0);
    for (const write of rosterWrites) expect(write.write!.payload).not.toHaveProperty("sync_error");
  });

  it("clears the error on the pass that read the whole document, which is the only one entitled to", async () => {
    // The other half of the rule: if NOTHING cleared it, an error would outlive its own cause. A
    // successful `getCardv2` is the evidence that the card reads cleanly — including over a roster
    // failure, which it has just disproved.
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail) });

    // Keyed on `detail_synced_at`, not on `document`: the roster pass's FIRST-sighting upsert also
    // carries a document (`{}`, so the not-null column is never half-formed) and would be counted as
    // a detail write. `detail_synced_at` is the detail pass's own clock and nothing else writes it.
    const detailWrites = rec
      .writtenRows("efs_cards")
      .filter((r) => r.detail_synced_at !== undefined);
    expect(detailWrites.length).toBeGreaterThan(0);
    for (const row of detailWrites) expect(row.sync_error).toBeNull();
  });

  it("reports the cards its detail budget cannot reach, instead of quietly never reaching them", async () => {
    /**
     * Step 7.5's invariant, `budget > fleetSize`.
     *
     * Below it, no sweep ever holds a current document for the whole fleet — so `staleAfterMinutes`
     * and Step 7.8's override badge are both measuring rows against a cadence the sweep is
     * configured not to meet. Production shipped 199 cards against a budget of 200, one card away,
     * with nothing anywhere that would have said so.
     */
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    const result = await syncEfsCards(rec.client, env, creds, {
      maxDetail: 1,
      fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail),
    });

    expect(result.cardsSeen).toBe(2);
    expect(result.detailed).toBe(1);
    expect(result.undetailedByBudget).toBe(1);
  });

  it("says nothing about the budget when it covers the fleet", async () => {
    // The positive control. An invariant that reports every run is one nobody reads — and this one
    // is emitted at `error`, so a false positive costs more than the signal is worth.
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    const result = await syncEfsCards(rec.client, env, creds, {
      maxDetail: 2,
      fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail),
    });

    expect(result.cardsSeen).toBe(2);
    expect(result.undetailedByBudget).toBe(0);
  });

  it("keeps card numbers out of its error messages", async () => {
    const shortPan = "7083000000";
    const suffixedPan = "70830000000000111OVER";
    const rec = createSupabaseRecorder({
      tables: { efs_cards: { writeError: { message: `card ${shortPan} and ${suffixedPan} rejected` } }, fuel_cards: [] },
    });
    const result = await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail) });
    const errors = result.errors.join(" ");

    expect(errors).not.toContain(shortPan);
    expect(errors).not.toContain(suffixedPan);
    expect(errors).toContain("••••0000");
    expect(errors).toContain("••••0111");
  });

  it("stores a status EFS reports even when the getCard enum omits it", async () => {
    // 'Fraud' is only the `U` search code in getCardSummaries (p44). Coercing it to something familiar
    // would hide the single most important fact about that card.
    const fraud = soap(`<r><result><value><cardNumber>${PAN_A}</cardNumber><status>Fraud</status></value></result></r>`);
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, fraud, cardDetail) });

    expect(rec.writtenRows("efs_cards")[0]!.status).toBe("Fraud");
  });

  it("stores a status outside the documented list rather than dropping the card", async () => {
    // Production returned one of these and z.enum rejected the whole document, so getCardv2 failed
    // and the card page went with it. The guide types `status` as string(8) with examples, not a
    // closed set (p38); migration 0175 removed the matching check constraint.
    const odd = soap(`<r><result><value><cardNumber>${PAN_A}</cardNumber><status>Frozen</status></value></result></r>`);
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    const result = await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, odd, cardDetail) });

    expect(result.cardsSeen).toBe(1);
    expect(rec.writtenRows("efs_cards")[0]!.status).toBe("Frozen");
  });

  it("says Unknown when EFS reports no status, rather than inventing Inactive", async () => {
    // The column is not-null so something must go in it. Inactive is a real state an operator acts
    // on; claiming it for a card we know nothing about is the kind of confident wrong answer that
    // gets a working truck sent to a different pump.
    const noStatus = soap(`<r><result><value><cardNumber>${PAN_A}</cardNumber><policyNumber>14</policyNumber></value></result></r>`);
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, noStatus, cardDetail) });

    expect(rec.writtenRows("efs_cards")[0]!.status).toBe("Unknown");
  });

  it("never lets the roster pass wipe a document the detail pass already mirrored", async () => {
    // The roster call carries no card document. An earlier version upserted `document: {}` and
    // `card_version: ""` for EVERY summary row, so each nightly sweep erased the mirrored detail for
    // every known card — permanently for any card beyond the detail budget. A known card must get an
    // UPDATE of the roster facts only; the empty document is for first sightings.
    const rec = createSupabaseRecorder({
      tables: {
        efs_cards: [{ card_ref_hmac: cardRefHmac(env, ORG, PAN_A) }],
        fuel_cards: [],
      },
    });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail) });

    const rosterUpdates = rec
      .forTable("efs_cards")
      .filter((q) => q.write?.method === "update" && (q.write.payload as Record<string, unknown>).status !== undefined);
    expect(rosterUpdates).toHaveLength(1); // PAN_A is known → update; PAN_B is new → upsert
    const updated = rosterUpdates[0]!;
    expect(updated.filters()).toContainEqual({ col: "card_ref_hmac", val: cardRefHmac(env, ORG, PAN_A) });
    expect(updated.write!.payload).not.toHaveProperty("document");
    expect(updated.write!.payload).not.toHaveProperty("card_version");
    expect(updated.write!.payload).not.toHaveProperty("card_number_sealed");

    // And nothing anywhere re-blanks PAN_A's document: every write that names its hmac either omits
    // the document (roster update) or carries the full one (detail pass).
    const blanked = rec
      .writtenRows("efs_cards")
      .filter((r) => r.card_ref_hmac === cardRefHmac(env, ORG, PAN_A) && r.card_version === "");
    expect(blanked).toHaveLength(0);
  });

  it("stops the sweep when it cannot read which cards it already holds", async () => {
    // A sweep that cannot tell new from known would treat all 199 cards as first sightings and blank
    // every document. Refusing to write is strictly better than that.
    const rec = createSupabaseRecorder({
      tables: { efs_cards: { data: null, error: { message: "connection refused" } }, fuel_cards: [] },
    });
    const result = await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries) });

    expect(result.errors.join(" ")).toMatch(/existing mirror/);
    expect(rec.writtenRows("efs_cards")).toHaveLength(0);
  });

  it("keeps a config source it does not recognise instead of erasing it", async () => {
    // normalizeSource used to null anything outside POLICY/CARD/BOTH, because 0171's constraint would
    // have rejected the row — so the page said "we have no idea where this card's rules come from"
    // when EFS had in fact told us.
    const odd = soap(`<r><result><value><cardNumber>${PAN_A}</cardNumber><status>Active</status><infosrc>Mixed</infosrc></value></result></r>`);
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });
    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, odd, cardDetail) });

    expect(rec.writtenRows("efs_cards")[0]!.info_source).toBe("MIXED");
  });
});

describe("cardRefHmac", () => {
  it("is deterministic for one org and one card", () => {
    expect(cardRefHmac(env, ORG, PAN_A)).toBe(cardRefHmac(env, ORG, PAN_A));
  });

  it("does not correlate the same physical card across tenants", () => {
    // The org id is inside the MAC precisely so a shared card cannot be matched between customers.
    expect(cardRefHmac(env, ORG, PAN_A)).not.toBe(cardRefHmac(env, OTHER_ORG, PAN_A));
  });

  it("distinguishes two cards in one org", () => {
    expect(cardRefHmac(env, ORG, PAN_A)).not.toBe(cardRefHmac(env, ORG, PAN_B));
  });

  it("does not leak the card number into the handle", () => {
    expect(cardRefHmac(env, ORG, PAN_A)).not.toContain(PAN_A.slice(0, 8));
  });

  it("refuses to run without a key rather than falling back to an unkeyed digest", () => {
    // An unkeyed SHA-256 of a card number with a known BIN and known last four is a few million
    // guesses — that is not a lookup handle, it is the PAN with extra steps.
    expect(() => cardRefHmac(testEnv({ ...env, SECRETS_ENCRYPTION_KEY: undefined }), ORG, PAN_A)).toThrow(/SECRETS_ENCRYPTION_KEY/);
  });
});

describe("attribution columns after a prompts change", () => {
  /**
   * The Cards page and the drawer's header read `unit_prompt` / `driver_id_prompt` / `driver_name`,
   * NOT the document. `preserveAttribution` fills them from the card's own prompt records.
   *
   * Reported from live QA on 2026-08-14: changing the Unit Number through the prompts drawer updated
   * the prompts section and left the header showing the OLD number. The value of a REPORT_ONLY prompt
   * lives in `reportValue` — `matchValue` comes back nil — and the reader only ever looked at
   * `matchValue`, so the column was silently left at whatever it held before.
   *
   * Same shape as the Phase 1 reportValue bug: a reader that knows about one of the two fields a
   * prompt can carry its value in.
   */
  const docWith = (infos: { infoId: string; validationType: string; matchValue: string | null; reportValue: string | null }[]) =>
    ({
      version: "v1",
      redactedXml: "<card/>",
      card: {
        status: "Active", originalStatus: null, payrollStatus: null, payrollUse: null,
        policyNumber: 14, companyXRef: null, handEnter: null,
        infoSource: null, limitSource: null, locationSource: null, timeSource: null,
        overrideUses: 0, locationOverrideId: null, overrideAllLocations: false,
        lastUsedDate: null, lastTransaction: null,
        infos, limits: [], locationGroups: [], locations: [], timeRestrictions: [],
      },
    }) as unknown as Parameters<typeof upsertCardDetail>[4];

  const written = async (infos: Parameters<typeof docWith>[0]) => {
    const rec = createSupabaseRecorder({ tables: { efs_cards: { data: { id: "efs-1" }, error: null } } });
    await upsertCardDetail(rec.client, env, ORG, "70830000000000000", docWith(infos));
    return rec.writtenRows("efs_cards").at(-1) ?? {};
  };

  it("takes the unit number from matchValue on an EXACT_MATCH prompt", async () => {
    const row = await written([
      { infoId: "UNIT", validationType: "EXACT_MATCH", matchValue: "3182", reportValue: null },
    ]);
    expect(row.unit_prompt).toBe("3182");
  });

  it("takes it from reportValue on a REPORT_ONLY prompt, where matchValue is nil", async () => {
    const row = await written([
      { infoId: "UNIT", validationType: "REPORT_ONLY", matchValue: null, reportValue: "4242" },
    ]);
    expect(row.unit_prompt).toBe("4242");
  });

  it("still omits the column when the card carries no such prompt at all", async () => {
    // The protection this function exists for: a card whose prompts live on its POLICY must not have
    // the roster pass's answer blanked by the detail pass.
    const row = await written([]);
    expect(row).not.toHaveProperty("unit_prompt");
    expect(row).not.toHaveProperty("driver_id_prompt");
  });

  it("carries the same rule to the driver id and driver name", async () => {
    const row = await written([
      { infoId: "DRID", validationType: "REPORT_ONLY", matchValue: null, reportValue: "D-9999" },
      { infoId: "NAME", validationType: "REPORT_ONLY", matchValue: null, reportValue: "Dana" },
    ]);
    expect(row.driver_id_prompt).toBe("D-9999");
    expect(row.driver_name).toBe("Dana");
  });
});

describe("an unmodelled field (Step 7.3)", () => {
  /**
   * The asymmetry the step asks for: **the scan fails on an unmodelled field; the sweep only logs
   * it.** This is the sweep half.
   *
   * It runs unattended against a live fleet, and refusing to mirror a card because WEX added a field
   * would take the product offline over something the echo already preserves
   * (`getCardV2.unknownField.xml` proves the write path keeps unknown fields, and a case throws when
   * one is dropped). So the card is mirrored and the field is reported.
   */
  const unknownFieldDoc = readFileSync(
    fileURLToPath(new URL("../lib/__fixtures__/efs/getCardV2.unknownField.xml", import.meta.url)), "utf8",
  );

  it("mirrors the card anyway, and names the field in a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });

    const result = await syncEfsCards(rec.client, env, creds, {
      fetchImpl: stub(loginOk, summaries, unknownFieldDoc, unknownFieldDoc),
    });

    // Mirrored, not refused — the whole point of the asymmetry.
    expect(result.detailed).toBe(2);
    expect(result.failed).toBe(0);
    const said = warn.mock.calls.map((c) => String(c[0])).join(" ");
    expect(said).toContain("unmodelled field");
    expect(said).toContain("futureFlag");
    // Names, never values: this line reaches logs.
    expect(said).not.toContain("keep-me");
    warn.mockRestore();
  });

  it("says nothing at all for a document made entirely of modelled fields", async () => {
    // The positive control. A warning on every sweep is a warning nobody reads by the time one
    // matters — and this fires per card, on a fleet of 199.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rec = createSupabaseRecorder({ tables: { efs_cards: [], fuel_cards: [] } });

    await syncEfsCards(rec.client, env, creds, { fetchImpl: stub(loginOk, summaries, cardDetail, cardDetail) });

    expect(warn.mock.calls.map((c) => String(c[0])).join(" ")).not.toContain("unmodelled");
    warn.mockRestore();
  });
});
