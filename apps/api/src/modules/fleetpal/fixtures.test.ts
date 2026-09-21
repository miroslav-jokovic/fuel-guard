import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  fleetpalDefectSchema,
  fleetpalExpirationSchema,
  fleetpalIssueSchema,
  fleetpalJobItemSchema,
  fleetpalJobSchema,
  fleetpalMeterSchema,
  fleetpalPartSchema,
  fleetpalPmScheduleSchema,
  fleetpalPoInvoiceSchema,
  fleetpalPoReceiptItemSchema,
  fleetpalPoReceiptSchema,
  fleetpalPurchaseOrderSchema,
  fleetpalServiceHistorySchema,
  fleetpalShopSchema,
  fleetpalUnitSchema,
  fleetpalVendorSchema,
  fleetpalWorkOrderSchema,
} from "@silvicom/shared";

/**
 * The contracts, against payloads the vendor actually sent (F4, 2026-09-21).
 *
 * Every other test in this module scripts `fetch` with a shape we invented, which is the right way
 * to test pagination and backoff and the wrong way to learn what a `Part` looks like. F1 and F3
 * shipped with nothing but invented shapes, and F4's first run against the live account found three
 * contracts that would have rejected the first real page: `payable_to` typed as required where the
 * server sends null 81.5% of the time, `Part.type` typed as the integer the SPEC declares where the
 * server sends the string `"VENDOR_HIDDEN"`, and the webhook catalogue read through the standard
 * envelope it does not use.
 *
 * So these fixtures are recorded evidence and this file is what keeps them load-bearing: a contract
 * tightened back to what the document says fails here rather than in a sweep at 03:00.
 *
 * ── WHAT IS IN THE FILES ───────────────────────────────────────────────────────────────────────
 * Three rows per resource, redacted by `scripts/fleetpalSmoke.ts`'s key list — person-shaped values
 * are replaced by a value of the SAME JSON TYPE, so a schema that would have rejected the real
 * payload still rejects the redacted one. The unredacted run lives in `docs/FleetPal/smoke-runs/`,
 * which is gitignored like the spec beside it.
 */

const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "__fixtures__");

/** Fixture file stem → the contract that must accept every row in it. */
const SCHEMAS: Record<string, z.ZodType<unknown>> = {
  units: fleetpalUnitSchema,
  "work-orders": fleetpalWorkOrderSchema,
  jobs: fleetpalJobSchema,
  "job-items": fleetpalJobItemSchema,
  "service-history": fleetpalServiceHistorySchema,
  meters: fleetpalMeterSchema,
  "pm-schedules": fleetpalPmScheduleSchema,
  defects: fleetpalDefectSchema,
  issues: fleetpalIssueSchema,
  expirations: fleetpalExpirationSchema,
  parts: fleetpalPartSchema,
  vendors: fleetpalVendorSchema,
  shops: fleetpalShopSchema,
  "purchase-orders": fleetpalPurchaseOrderSchema,
  "purchase-order-invoices": fleetpalPoInvoiceSchema,
  "purchase-order-receipts": fleetpalPoReceiptSchema,
  "purchase-order-receipt-items": fleetpalPoReceiptItemSchema,
};

function read(stem: string): { count: number; results: unknown[] } {
  return JSON.parse(readFileSync(path.join(DIR, `${stem}.json`), "utf8")) as {
    count: number;
    results: unknown[];
  };
}

const recorded = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

/**
 * Resources the live account had nothing to record, with the reason.
 *
 * ⚠ **This is a measurement, not an exemption.** `GET /v1/expirations/` answered `count: 0` on
 * 2026-09-21 — the carrier tracks no registration, permit or inspection expiry in FleetPal at all —
 * so F7's expiration half will ship proved against the spec's examples and nothing else, and the
 * plan says so rather than implying a coverage it does not have. A later run that finds rows should
 * record the fixture and delete this entry.
 */
const NOT_RECORDED: Record<string, string> = {
  expirations: "count: 0 on the live account, 2026-09-21 — nothing to record",
};

describe("the recorded FleetPal payloads", () => {
  it("has a schema mapped for every fixture on disk", () => {
    // A fixture nobody parses is a file, not evidence. A new one recorded by a later probe run
    // arrives here as a failure rather than as three kilobytes nothing reads.
    expect(recorded.filter((r) => !SCHEMAS[r])).toEqual([]);
  });

  it("explains every resource that has no fixture", () => {
    const missing = Object.keys(SCHEMAS).filter((s) => !recorded.includes(s));
    expect(missing.filter((m) => !NOT_RECORDED[m])).toEqual([]);
  });

  for (const [stem, schema] of Object.entries(SCHEMAS)) {
    if (NOT_RECORDED[stem]) continue;
    it(`${stem}: every recorded row parses`, () => {
      const { results } = read(stem);
      for (const row of results) {
        const parsed = schema.safeParse(row);
        expect(parsed.success ? null : parsed.error.issues[0]).toBeNull();
      }
    });
  }

  it("carries no key material and no unredacted contact details", () => {
    // `lint:secrets` scans committed content for the obvious shapes; this is the narrow version
    // that knows what a FleetPal key looks like and what the probe was supposed to have stripped.
    const all = recorded.map((r) => readFileSync(path.join(DIR, `${r}.json`), "utf8")).join("\n");
    expect(all).not.toMatch(/fp_[A-Za-z0-9]{16,}/);
    expect(all).not.toMatch(/"email": "(?!REDACTED)[^"]*@/);
    expect(all).not.toMatch(/"phone": "(?!REDACTED)[^"]+"/);
  });
});

describe("the three contract findings F4 exists to have made", () => {
  it("⚠ accepts a purchase order whose `payable_to` is null — 81.5% of the live account", () => {
    const orders = read("purchase-orders").results;
    const nulls = orders.filter((o) => (o as { payable_to: unknown }).payable_to === null);
    // The fixture would be worthless for this if the three recorded rows happened to be the 18.5%.
    expect(nulls.length).toBeGreaterThan(0);
    for (const o of nulls) expect(fleetpalPurchaseOrderSchema.safeParse(o).success).toBe(true);
  });

  it("⚠ accepts an invoice whose `payable_to` is null, which is the coverage bridge's key", () => {
    const invoices = read("purchase-order-invoices").results;
    const nulls = invoices.filter((i) => (i as { payable_to: unknown }).payable_to === null);
    expect(nulls.length).toBeGreaterThan(0);
    for (const i of nulls) expect(fleetpalPoInvoiceSchema.safeParse(i).success).toBe(true);
  });

  it("⚠ accepts the STRING `Part.type` the server sends, against the integer the spec declares", () => {
    const parts = read("parts").results;
    const strings = parts.filter((p) => typeof (p as { type: unknown }).type === "string");
    expect(strings.length).toBeGreaterThan(0);
    for (const p of strings) expect(fleetpalPartSchema.safeParse(p).success).toBe(true);
  });
});
