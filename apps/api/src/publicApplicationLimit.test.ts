import { describe, it, expect, afterAll } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { closeTestServer } from "./testing/httpServer.js";

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
const PATH = `/api/public/application/${TOKEN}/mark/x`;

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
    // ⚠ The arithmetic that took the ceremony down, stated as a test: the twentieth is served and
    // the twenty-first is not, and a packet has twenty-two places.
    expect(codes.slice(0, 20).every((c) => c !== 429)).toBe(true);
    expect(codes[20]).toBe(429);
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
    expect(lines[0]![1]).toEqual({ method: "GET", step: "mark" });
    // The token in the path IS the credential for a live application. Curing the blindness must not
    // be paid for by putting a signing link into Railway's log retention.
    expect(JSON.stringify(lines)).not.toContain(TOKEN);
  });
});
