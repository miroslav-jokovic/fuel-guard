import { detectReportKind } from "@silvicom/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { EfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { __resetSoapPacing } from "./soapClient.js";
import { fetchPostedTransactions, fetchRejectedTransactions, pingEfsSoap } from "./efsSoap.js";
import { testEnv } from "../../../testing/testEnv.js";

const env = testEnv({
  EFS_SOAP_MAX_RPS: 100,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_BACKFILL_DAYS: 90,
  // These tests inject a fetch stub and never open a socket, but the SSRF gate in soapFetch (audit
  // 2026-08-09 §3.8) would still try to RESOLVE ws.efsllc.com — a network call this offline suite
  // must not make. The address checks are skipped here; lib/ssrfGuard.test.ts is where they are tested.
  EFS_SOAP_ALLOW_PRIVATE_ENDPOINT: true,
  // Step 5.9: pinned, not inherited. These cases assert single-page behaviour, and they used to get
  // it by accident — the fixture was an `as unknown as Env` cast with no paging keys at all, so the
  // call site's `?? 1` fallback answered. The real schema default is 12. Saying 1 out loud here is
  // the difference between a test that means "one page" and one that means "whatever undefined did".
  EFS_SOAP_BACKFILL_MAX_PAGES: 1,
});

const creds: EfsSoapCredentials = {
  orgId: "org-1",
  environment: "production",
  endpointUrl: "https://ws.efsllc.com/axis2/services/CardManagementWS/",
  soapUsername: "user",
  soapPassword: "pass<&",
  accountId: null,
  postedLastCursor: null,
  rejectedLastCursor: null,
  postedLastPolledAt: null,
  rejectedLastPolledAt: null,
  postedLastSuccessAt: null,
  rejectedLastSuccessAt: null,
  postedLastError: null,
  rejectedLastError: null,
  enabled: true,
  fromEnvFallback: false,
  tls: null,
};

const soap = (body: string) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;

function fetchSequence(...responses: string[]): { fetchImpl: typeof fetch; bodies: string[] } {
  let index = 0;
  const bodies: string[] = [];
  const fetchImpl = (async (_input: string | URL, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    return new Response(responses[index++] ?? soap("<empty/>"), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, bodies };
}

describe("EFS SOAP operations", () => {
  afterEach(() => __resetSoapPacing());

  it("logs in, fetches posted line items, and logs out", async () => {
    const sequence = fetchSequence(
      soap("<loginResponse><result>session-123</result></loginResponse>"),
      soap(`<getMCTransExtLocV2Response><result><value><transactionId>77</transactionId><POSDate>2026-08-01</POSDate><cardNumber>1234</cardNumber><invoice>INV-7</invoice><locationName>Truck Stop</locationName><locationCity>Chicago</locationCity><locationState>IL</locationState><infos><type>UNIT</type><value>TRK-7</value></infos><infos><type>NAME</type><value>Jane Driver</value></infos><infos><type>DRID</type><value>42</value></infos><infos><type>ODRD</type><value>1000</value></infos><lineItems><category>ULSD</category><quantity>50.5</quantity><ppu>3.49</ppu><amount>176.25</amount></lineItems></value></result></getMCTransExtLocV2Response>`),
      soap("<logoutResponse/>")
    );

    const result = await fetchPostedTransactions(env, creds, null, { fetchImpl: sequence.fetchImpl });

    expect(detectReportKind(Object.keys(result.rows[0] ?? {}))).toBe("transaction");
    expect(result.rows).toEqual([
      expect.objectContaining({
        TransactionId: "77",
        "Card #": "1234",
        Invoice: "INV-7",
        Unit: "TRK-7",
        "Driver Name": "Jane Driver",
        "Driver ID": "42",
        Odometer: "1000",
        Item: "ULSD",
        Qty: "50.5",
        Amt: "176.25",
      }),
    ]);
    expect(result.pagesFetched).toBe(1);
    expect(result.responseHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sequence.bodies[0]).toContain("<user>user</user><password>pass&lt;&amp;</password>");
    expect(sequence.bodies[1]).toContain("<CardManagementEP_getMCTransExtLocV2>");
    expect(sequence.bodies[1]).toContain("<clientId>session-123</clientId>");
    expect(sequence.bodies[2]).toContain("<CardManagementEP_logout>");
  });

  it("uses the WSDL search object and required empty reject filters", async () => {
    const sequence = fetchSequence(
      soap("<loginResponse><result>session-456</result></loginResponse>"),
      soap("<getTranRejectsResponse><result><value><tranDate>2026-08-01T15:30:00Z</tranDate><cardNum>9876</cardNum><invoice>INV-8</invoice><locId>9</locId><locName>Stop 9</locName><locCity>Dallas</locCity><locState>TX</locState><errorCode>401</errorCode><errorDesc>LIMIT EXCEEDED</errorDesc><unit>TRK-8</unit></value></result></getTranRejectsResponse>"),
      soap("<logoutResponse/>")
    );

    const result = await fetchRejectedTransactions(env, creds, "2026-08-01T15:00:00.000Z", { fetchImpl: sequence.fetchImpl });

    expect(result.rows).toEqual([
      expect.objectContaining({
        Date: "2026-08-01T15:30:00Z",
        "Card Number": "9876",
        "Error Code": "401",
        "Error Description": "LIMIT EXCEEDED",
      }),
    ]);
    expect(sequence.bodies[1]).toContain("<CardManagementEP_getTranRejects>");
    expect(sequence.bodies[1]).toContain("<search><startDate>");
    expect(sequence.bodies[1]).toContain("<endDate>");
    expect(sequence.bodies[1]).toContain("<cardNum></cardNum>");
    expect(sequence.bodies[1]).toContain("<invoice></invoice>");
    expect(sequence.bodies[1]).toContain("<locationId>0</locationId>");
  });

  it("reports login failures without exposing the password", async () => {
    const sequence = fetchSequence(soap("<soap:Fault><faultstring>Invalid username or password</faultstring></soap:Fault>"));
    const result = await pingEfsSoap(env, creds, { fetchImpl: sequence.fetchImpl });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("auth");
      expect(result.error.message).not.toContain(creds.soapPassword);
    }
  });
});

// ── Catch-up paging (backfill throughput) ────────────────────────────────────────────────────────
// A first backfill is 180 days at 7-day windows = 26 requests. One window per poll at a 15-minute
// cadence is 6.5 hours of waiting on timers, not on EFS. These tests pin the behaviour that makes a
// catch-up drain in minutes while leaving steady state at exactly one window per poll.

const pagingEnv = testEnv({
  EFS_SOAP_MAX_RPS: 1000,
  EFS_SOAP_MAX_RETRIES: 0,
  EFS_SOAP_BACKFILL_DAYS: 90,
  EFS_SOAP_MAX_DAYS_PER_REQUEST: 7,
  EFS_SOAP_BACKFILL_MAX_PAGES: 5,
  EFS_SOAP_BACKFILL_MAX_MS: 60_000,
  EFS_SOAP_MAX_ROWS_PER_POLL: 5_000,
});

/** A posted response carrying `n` single-line-item transactions. */
const postedPage = (n: number, tag: string): string =>
  soap(`<getMCTransExtLocV2Response><result>${Array.from({ length: n }, (_, i) =>
    `<value><transactionId>${tag}-${i}</transactionId><POSDate>2026-06-01T10:00:00Z</POSDate>` +
    `<cardNumber>7083050030281917521</cardNumber><invoice>INV-${tag}-${i}</invoice>` +
    `<lineItems><category>ULSD</category><quantity>50</quantity><ppu>3.5</ppu><amount>175</amount></lineItems>` +
    `</value>`).join("")}</result></getMCTransExtLocV2Response>`);

/** login + `pages` data responses + logout. */
const pagedSequence = (perPage: number[]) =>
  fetchSequence(
    soap("<loginResponse><result>s</result></loginResponse>"),
    ...perPage.map((n, i) => postedPage(n, `p${i}`)),
    soap("<logoutResponse/>"),
  );

describe("catch-up paging", () => {
  afterEach(() => __resetSoapPacing());

  it("fetches ONE window in steady state (cursor already near now)", async () => {
    const seq = pagedSequence([1]);
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h old cursor
    const r = await fetchPostedTransactions(pagingEnv, creds, recent, { fetchImpl: seq.fetchImpl });
    // The 48h look-back is inside one 7-day window, so a single request — no change from before.
    expect(r.pagesFetched).toBe(1);
    expect(r.moreAvailable).toBe(false);
    expect(r.windowsOutstanding).toBe(1);
  });

  it("pages up to the page budget when the cursor is far behind", async () => {
    const seq = pagedSequence([1, 1, 1, 1, 1, 1, 1]);
    const r = await fetchPostedTransactions(pagingEnv, creds, null, { fetchImpl: seq.fetchImpl });
    // 90 days of backfill ÷ 7-day windows = 13 outstanding; the budget caps this poll at 5.
    expect(r.windowsOutstanding).toBe(13);
    expect(r.pagesFetched).toBe(5);
    expect(r.rows).toHaveLength(5);
    // …and it says so, rather than looking like a feed that found nothing.
    expect(r.moreAvailable).toBe(true);
  });

  it("advances the cursor past every COMPLETED page, so the next poll resumes with no gap", async () => {
    const seq = pagedSequence([1, 1, 1, 1, 1]);
    const first = await fetchPostedTransactions(pagingEnv, creds, null, { fetchImpl: seq.fetchImpl });
    const seq2 = pagedSequence([1, 1, 1, 1, 1]);
    const second = await fetchPostedTransactions(pagingEnv, creds, first.nextCursor, { fetchImpl: seq2.fetchImpl });
    expect(new Date(second.nextCursor!).getTime()).toBeGreaterThan(new Date(first.nextCursor!).getTime());
    // The second poll's first request starts one 48h look-back before where the first one stopped —
    // deliberate overlap for late settlements, made safe by external_ref dedupe.
    const begDate = /<begDate>([^<]+)<\/begDate>/.exec(seq2.bodies[1] ?? "")?.[1];
    const gap = new Date(first.nextCursor!).getTime() - new Date(begDate!).getTime();
    expect(gap).toBe(48 * 60 * 60 * 1000);
  });

  it("stops on the row budget so one poll never builds an unbounded upsert", async () => {
    const tight = testEnv({ ...pagingEnv, EFS_SOAP_MAX_ROWS_PER_POLL: 3 });
    const seq = pagedSequence([2, 2, 2, 2, 2]);
    const r = await fetchPostedTransactions(tight, creds, null, { fetchImpl: seq.fetchImpl });
    // Page 1 → 2 rows (under budget, continue). Page 2 → 4 rows (at/over budget, stop).
    expect(r.pagesFetched).toBe(2);
    expect(r.rows).toHaveLength(4);
    expect(r.moreAvailable).toBe(true);
  });

  it("always fetches at least one page, even with the budgets already exhausted", async () => {
    const zero = testEnv({ ...pagingEnv, EFS_SOAP_MAX_ROWS_PER_POLL: 1, EFS_SOAP_BACKFILL_MAX_MS: 1 });
    const seq = pagedSequence([2]);
    const r = await fetchPostedTransactions(zero, creds, null, { fetchImpl: seq.fetchImpl });
    // Budgets are checked only after the first page — a poll must never be a no-op that still
    // advances nothing and logs nothing.
    expect(r.pagesFetched).toBe(1);
    expect(r.rows).toHaveLength(2);
  });

  it("an explicit maxPages from the caller overrides the catch-up budget", async () => {
    const seq = pagedSequence([1, 1, 1, 1, 1]);
    const r = await fetchPostedTransactions(pagingEnv, creds, null, { fetchImpl: seq.fetchImpl, maxPages: 2 });
    expect(r.pagesFetched).toBe(2);
  });

  // Rewritten in Step 5.9. This case used to be titled "degrades to single-page when the env predates
  // these keys (no NaN loop)" and built an Env with the paging keys missing, to prove the call site's
  // `?? 1` fallback stopped a NaN loop. That state is not reachable: the defaults live in the zod
  // schema (env.ts), compiled into the binary, so `loadEnv` cannot return an Env without them — no
  // deployment, however old its Railway variables, produces one. The test was guarding an input the
  // program cannot receive, and the fallback it guarded was the duplicated default Step 5.9 removes.
  //
  // The property it was really protecting — the pager cannot spin on a non-number — is now the
  // schema's job, so it is asserted where it actually lives, against a real parsed env.
  it("gets its paging bounds from the schema, so the pager can never loop on a non-number", () => {
    const parsed = testEnv();
    for (const key of ["EFS_SOAP_BACKFILL_MAX_PAGES", "EFS_SOAP_MAX_ROWS_PER_POLL", "EFS_SOAP_MAX_DAYS_PER_REQUEST"] as const) {
      expect(Number.isFinite(parsed[key]), `${key} must be a finite number`).toBe(true);
      expect(parsed[key]).toBeGreaterThan(0);
    }
  });
});

describe("windowOverride — the historical hole re-fetch path (recon F11)", () => {
  afterEach(() => __resetSoapPacing());

  it("fetches exactly the requested range, paged at the day cap, covering it whole by default", async () => {
    // 2026-04-18..05-05 is 17 days → 3 pages at the 7-day cap. The default page budget for an
    // override is the whole range, NOT the steady-state single page.
    const seq = pagedSequence([1, 1, 1]);
    const r = await fetchPostedTransactions(pagingEnv, creds, null, {
      fetchImpl: seq.fetchImpl,
      windowOverride: { start: "2026-04-18T00:00:00.000Z", end: "2026-05-05T00:00:00.000Z" },
    });
    expect(r.pagesFetched).toBe(3);
    expect(r.moreAvailable).toBe(false);
    const begFirst = /<begDate>([^<]+)<\/begDate>/.exec(seq.bodies[1] ?? "")?.[1];
    const endLast = /<endDate>([^<]+)<\/endDate>/.exec(seq.bodies[3] ?? "")?.[1];
    expect(begFirst).toBe("2026-04-18T00:00:00.000Z");
    expect(endLast).toBe("2026-05-05T00:00:00.000Z");
    // The cursor result describes THIS range's end — callers must never persist it as the feed's.
    expect(r.nextCursor).toBe("2026-05-05T00:00:00.000Z");
  });

  it("still honors the hard row budget, reporting moreAvailable with a resumable nextCursor", async () => {
    const tight = testEnv({ ...pagingEnv, EFS_SOAP_MAX_ROWS_PER_POLL: 1 });
    const seq = pagedSequence([1, 1, 1]);
    const r = await fetchPostedTransactions(tight, creds, null, {
      fetchImpl: seq.fetchImpl,
      windowOverride: { start: "2026-04-18T00:00:00.000Z", end: "2026-05-05T00:00:00.000Z" },
    });
    expect(r.pagesFetched).toBe(1);
    expect(r.moreAvailable).toBe(true);
    expect(r.nextCursor).toBe("2026-04-25T00:00:00.000Z"); // last COMPLETED page — resume point
  });

  it("refuses an inverted or unparseable window instead of fetching now-minus-backfill", async () => {
    const seq = pagedSequence([1]);
    await expect(
      fetchPostedTransactions(pagingEnv, creds, null, {
        fetchImpl: seq.fetchImpl,
        windowOverride: { start: "2026-05-05T00:00:00.000Z", end: "2026-04-18T00:00:00.000Z" },
      }),
    ).rejects.toThrow(/invalid fetch window/);
    await expect(
      fetchPostedTransactions(pagingEnv, creds, null, {
        fetchImpl: seq.fetchImpl,
        windowOverride: { start: "not-a-date", end: "2026-04-18T00:00:00.000Z" },
      }),
    ).rejects.toThrow(/invalid fetch window/);
  });
});
