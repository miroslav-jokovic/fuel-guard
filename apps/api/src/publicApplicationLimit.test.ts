import { describe, it, expect, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { packetDriverMarkCount } from "@silvicom/shared";
import { closeTestServer } from "./testing/httpServer.js";
import { PACKET_CEREMONY_LIMIT } from "./middleware/applicationLimits.js";

/**
 * The bucket in front of the applicant's own link, and what it does when it closes (A0, 2026-09-17).
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────────────────────
 * On 2026-09-17 the first signing ceremony this product ever ran stopped two places from the end.
 * Twenty marks landed — `p03` through `p28`, in the packet's own page order, in twenty-three seconds
 * — and `p31a` did not. Nothing anywhere said why: the service leaves no row for a refusal, and
 * express-rate-limit leaves no line at all. The cause was arithmetic nobody had done. **Twenty-two
 * marks are twenty-two POSTs by design** (`publicApplication.ts`: *"twenty-two marks made by one
 * request would be one act"*) and this bucket allows twenty per minute, so a driver signing at one
 * tap a second is refused at the twenty-first place on the carrier's paper. Every applicant would
 * have been, every time.
 *
 * ⚠ **The limit itself is not what these tests defend.** Sizing it for a ceremony is A0b, a separate
 * merge. What is pinned here is that the refusal is FINDABLE and that finding it costs nobody their
 * signing link: a day went into hunting the killer of that link in the abandonment sweep, which
 * measurement later showed had never fired (`HIRING-MODULE-PLAN.md` §1a C1).
 *
 * ⚠ **No Supabase in the test env**, so every request below is deliberately shaped to 404 in the
 * router rather than reach a service: three path segments match none of its routes. The limiter
 * counts a request it refuses to route exactly as it counts one it routes, which is the property
 * that lets this suite be hermetic — and `/<token>/mark/x` still exercises the one thing the log
 * line has to get right.
 */

/** Long enough to look like the real credential, so "the token is not logged" means something. */
const TOKEN = "seCretSigningToken0000000000000000000000000";
/** ⚠ Three segments and a GET: shaped like the ceremony, counted by the INTAKE. See `isPacketMark`. */
const PATH = `/api/public/application/${TOKEN}/mark/x`;
/** The ceremony's own verb. `validateBody` refuses an empty body at 400, before any service runs. */
const markPath = (token: string) => `/api/public/application/${token}/mark`;
const mark = (baseUrl: string, token: string) =>
  fetch(`${baseUrl}${markPath(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

/**
 * ⚠ One app, and therefore one bucket, PER TEST. The limiter's store belongs to the `createApp`
 * that built it, so a shared server would hand the second test a window the first had already
 * spent — and a suite whose second assertion only passes because of what its first did is a suite
 * that changes meaning when somebody reorders it.
 */
const servers: Server[] = [];
async function freshApp(): Promise<string> {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  return new Promise<string>((resolve) => {
    const server = app.listen(0, () => {
      servers.push(server);
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  });
}

afterAll(async () => {
  for (const server of servers) await closeTestServer(server);
});

describe("the applicant's bucket", () => {
  it("allows twenty requests in the window and refuses the twenty-first", async () => {
    const baseUrl = await freshApp();
    const codes: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      codes.push((await fetch(`${baseUrl}${PATH}`)).status);
    }
    // ⚠ The intake's number is UNCHANGED by A0b, and that is the point of the split: it is sized
    // for a form that takes a date of birth and a licence number, and nothing there is asked for
    // twenty times.
    expect(codes.slice(0, 20).every((c) => c !== 429)).toBe(true);
    expect(codes[20]).toBe(429);
  });

  /**
   * ⚠ A0b's whole reason. `PACKET_CEREMONY_LIMIT` is sized against the DOCUMENT — twenty-two places
   * — not against an attacker's guess rate, because twenty-two marks are twenty-two POSTs by design
   * and no applicant could ever finish a walk inside the intake's twenty.
   */
  it("lets a whole packet through the ceremony's own bucket, twice over", async () => {
    const baseUrl = await freshApp();
    const codes: number[] = [];
    for (let i = 0; i < PACKET_CEREMONY_LIMIT; i += 1) {
      codes.push((await mark(baseUrl, TOKEN)).status);
    }
    expect(PACKET_CEREMONY_LIMIT).toBeGreaterThan(2 * packetDriverMarkCount(null));
    expect(codes.some((c) => c === 429)).toBe(false);
    expect((await mark(baseUrl, TOKEN)).status).toBe(429);
  });

  /**
   * ⚠ The load-bearing choice, and the one an address key would get wrong. D-HM9 step 13 puts the
   * packet signing IN THE OFFICE on the day the driver arrives, so two applicants signing from one
   * address is the designed case — and under an address key the second one would spend the first
   * one's packet.
   */
  it("gives each link its own packet, so two applicants in one office do not share one", async () => {
    const baseUrl = await freshApp();
    for (let i = 0; i < PACKET_CEREMONY_LIMIT + 1; i += 1) await mark(baseUrl, TOKEN);
    expect((await mark(baseUrl, TOKEN)).status).toBe(429);
    // Same address, same second, different link. The office's other applicant is unaffected.
    expect((await mark(baseUrl, `${TOKEN}-second-driver`)).status).not.toBe(429);
  });

  /**
   * ⚠ The 429 that told a driver their link was dead. express-rate-limit's default body is plain
   * text; `publicFetch` parses JSON, so `body?.error?.code` was undefined and it fell back to
   * `invalid_link` — "This application link is not valid. Ask for a new one." — about a link that
   * was fine and would work again within the minute.
   */
  it("refuses in the API's own envelope, with a code the ceremony can act on", async () => {
    const baseUrl = await freshApp();
    for (let i = 0; i < PACKET_CEREMONY_LIMIT + 1; i += 1) await mark(baseUrl, TOKEN);
    const res = await mark(baseUrl, TOKEN);
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("too_many_requests");
    // And it tells the driver the one thing they can do about it.
    expect(body.error?.message).toMatch(/minute/);
  });

  /**
   * ⚠ The line that did not exist. A refusal that reaches an applicant and leaves no trace on the
   * server is the expensive kind of silence — the driver is told their link is invalid (the 429
   * carries express-rate-limit's plain-text body, which `publicFetch` cannot parse, so it reports
   * the only thing it has) and the office has nothing to look at.
   */
  it("says so in the log when it refuses an applicant, naming the step and not the token", async () => {
    const baseUrl = await freshApp();
    const lines: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void lines.push(args);
    try {
      for (let i = 0; i < 21; i += 1) await fetch(`${baseUrl}${PATH}`);
    } finally {
      console.warn = original;
    }
    // Exactly one: the twenty served requests say nothing, and only the refusal does.
    expect(lines).toHaveLength(1);
    expect(lines[0]![0]).toBe("[public-application] rate limited");
    expect(lines[0]![1]).toEqual({ bucket: "intake", method: "GET", step: "mark" });
    // The token in the path IS the credential for a live application. Curing the blindness must not
    // be paid for by putting a signing link into Railway's log retention.
    expect(JSON.stringify(lines)).not.toContain(TOKEN);
  });
});
