import { vi } from "vitest";

/**
 * No test in this package performs a real DNS lookup.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * `ssrfGuard.ts` resolves every outbound host with `getaddrinfo` BEFORE the request is made, which is
 * the whole point of the guard — it validates the addresses the socket layer will actually dial. But
 * seven test files stub `globalThis.fetch` and stop there, so the vendor CALL was fake while the
 * name RESOLUTION stayed real: every one of them did a live lookup of `ws.partner.efsllc.com`.
 *
 * That is where the EFS route flakiness came from. Measured 2026-08-30 by making `dnsLookup` sleep
 * 6 s: **39 tests** across `fuelCardsControl.characterisation`, `efs/router`, `echoScanRoute` and
 * `inventoryRoute` timed out — so any of them could lose the race, and on CI two of them did, twice,
 * at exactly the 5000 ms default. Locally the resolver answers from cache in ~130 ms and everything
 * passes, which is why it read as "a slow test" rather than "a test on the network".
 *
 * ── WHY A GLOBAL SETUP RATHER THAN A STUB PER FILE ───────────────────────────────────────────────
 * The eighth file would forget. A test that stubs `fetch` looks complete, and nothing about it
 * announces that a name still has to resolve — the failure only appears later, on someone else's PR,
 * as an unrelated timeout. One setup file makes "tests do not touch the network" true by default
 * instead of by remembering.
 *
 * ── WHY THIS DOES NOT WEAKEN THE GUARD ───────────────────────────────────────────────────────────
 * `ssrfGuard.test.ts` — the file that actually tests the blocking rules — injects its own `lookup`
 * through `OutboundUrlOptions`, which takes precedence over this module import. Every private-range,
 * rebinding and unresolvable case it covers is unaffected. What this changes is only the DEFAULT
 * resolver used by tests that never meant to resolve anything.
 *
 * The address is TEST-NET-3 (RFC 5737 §3), reserved for documentation and guaranteed never routable
 * to anything real — a public-range answer, so the guard's "must resolve to public addresses" branch
 * behaves as it does in production, without naming a host anyone could own.
 */
vi.mock("node:dns/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:dns/promises")>()),
  lookup: async () => [{ address: "203.0.113.10", family: 4 }],
}));
