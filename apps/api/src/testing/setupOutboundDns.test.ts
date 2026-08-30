import { it, expect } from "vitest";

/**
 * The setup file is wired, and stays wired.
 *
 * Without this, removing `setupFiles` from `vitest.config.ts` breaks nothing visibly: every suite
 * still passes, just slower and on the network again, and the flakiness comes back weeks later as an
 * unrelated timeout on someone else's PR. That is exactly how it arrived the first time.
 */
import { lookup } from "node:dns/promises";
import { checkOutboundUrl } from "../lib/ssrfGuard.js";

it("the setup file stubs DNS for every test file", async () => {
  // `.invalid` is reserved by RFC 2606 and can never resolve for real.
  expect(await lookup("nothing.invalid")).toEqual([{ address: "203.0.113.10", family: 4 }]);
});

it("so the SSRF guard resolves a vendor host without touching the network", async () => {
  const r = await checkOutboundUrl("https://ws.partner.efsllc.com/axis2/services/CardManagementWS/");
  expect(r.ok).toBe(true);
});
