import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../../testing/supabaseRecorder.js";
import { FleetpalClient } from "../client.js";
import { runIngest } from "./run.js";
import { poInvoicesIngest, purchaseOrdersIngest } from "./purchasing.js";
import purchaseOrderFixture from "../__fixtures__/purchase-orders.json" with { type: "json" };
import poInvoiceFixture from "../__fixtures__/purchase-order-invoices.json" with { type: "json" };

/**
 * The invoice bridge's ingest (FLEETPAL-INTEGRATION-PLAN.md F9, §2.4).
 *
 * `ingest.test.ts` already proves the four properties `runIngest` gives every watermarked resource
 * — delta from the stored position, watermark from the rows and never the clock, no advance on
 * failure, a named error for a rejected payload. These two collections go through that same path,
 * so re-asserting it here would be a test of `runIngest` wearing a different fixture.
 *
 * What is NOT covered anywhere else is the mapping, and the mapping is where this step's whole
 * argument lives: the coverage ratio is a bound precisely because of which fields survive the way
 * in and which shapes are left alone. Each case below names the wrong answer it exists to refuse.
 *
 * The fixtures are the redacted real pages F4 recorded against the live account on 2026-09-21, not
 * hand-built ones — three purchase orders (one with `payable_to` set, two with it null) and three
 * invoices whose numbers are "WI012764", "4010489436" and "12845". That spread is the point: those
 * three formats are what the join into `mcleod_ap_vouchers.invoice_number` actually meets.
 */

const ORG = "11111111-1111-1111-1111-111111111111";

function scriptedFetch(bodies: unknown[]) {
  const urls: string[] = [];
  let i = 0;
  const impl = (async (input: unknown) => {
    urls.push(String(input));
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => bodies[Math.min(i++, bodies.length - 1)],
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, urls };
}

const clientWith = (bodies: unknown[]) => {
  const { impl, urls } = scriptedFetch(bodies);
  return {
    client: new FleetpalClient({ apiKey: "fp_test_key", baseUrl: "https://openapi.fleetpal.io", fetchImpl: impl }),
    urls,
  };
};

const recorderWith = (state: Record<string, unknown>[] = []) =>
  createSupabaseRecorder({
    tables: { fleetpal_sync_state: () => ({ data: state, error: null }) },
    rpc: () => ({ data: 3, error: null }),
  });

/** The three purchase orders and three invoices F4 recorded, typed loosely for the mapper. */
const purchaseOrders = purchaseOrderFixture.results as unknown as Record<string, unknown>[];
const poInvoices = poInvoiceFixture.results as unknown as Record<string, unknown>[];

describe("the invoice bridge walks the real pages", () => {
  it("stages every purchase order F4 recorded, through the watermarked path", async () => {
    const { client } = clientWith([purchaseOrderFixture]);
    const rec = recorderWith();
    const result = await runIngest({ admin: rec.client, client, orgId: ORG }, purchaseOrdersIngest);
    expect(result.error).toBeNull();
    expect(result.fetched).toBe(3);
    const staged = rec.rpcs().find((c) => c.fn === "stage_fleetpal_purchase_orders")!.args as {
      p_rows: Record<string, unknown>[];
    };
    expect(staged.p_rows).toHaveLength(3);
  });

  it("stages every invoice F4 recorded, and reads its own tenant on the way", async () => {
    const { client } = clientWith([poInvoiceFixture]);
    const rec = recorderWith();
    const result = await runIngest({ admin: rec.client, client, orgId: ORG }, poInvoicesIngest);
    expect(result.error).toBeNull();
    expect(result.fetched).toBe(3);
    // The API reads with the service role, which bypasses RLS: every query org-filters itself.
    expectOrgScoped(rec, ORG);
  });

  it("both ask the vendor for a delta once a position exists — neither is a bounded re-read", async () => {
    // Unlike F7's three siblings, `PurchaseOrder` and `POInvoice` both carry `updated` and both
    // endpoints take `updated_after` (§2.7's filter matrix). A full re-read of 3,969 + 4,010 rows
    // every hour against an API with no published rate limit is what this refuses.
    const orders = clientWith([purchaseOrderFixture]);
    await runIngest(
      { admin: recorderWith([{ resource: "purchase-orders", watermark: "2026-09-01T00:00:00Z", window_end: null, last_run_at: null, last_error: null, rows_seen: 0 }]).client, client: orders.client, orgId: ORG },
      purchaseOrdersIngest,
    );
    const invoices = clientWith([poInvoiceFixture]);
    await runIngest(
      { admin: recorderWith([{ resource: "purchase-order-invoices", watermark: "2026-09-01T00:00:00Z", window_end: null, last_run_at: null, last_error: null, rows_seen: 0 }]).client, client: invoices.client, orgId: ORG },
      poInvoicesIngest,
    );
    expect(orders.urls[0]).toContain("updated_after=2026-09-01T00%3A00%3A00Z");
    expect(invoices.urls[0]).toContain("updated_after=2026-09-01T00%3A00%3A00Z");
  });
});

describe("what the purchase-order mapping carries", () => {
  it("⚠ keeps `payable_to` and `vendor_location` APART, null and all", () => {
    // 81.5% of the live account leaves `payable_to` null (F4, 2026-09-21) because the vendor only
    // sets it when the payee DIFFERS from the supplying location. Collapsing the pair here would
    // store an interpretation and destroy its input: "the payee is the supplier" and "the payee was
    // never recorded" would become the same row. The coalesce belongs at read, where it can be seen.
    const withPayee = purchaseOrdersIngest.map(purchaseOrders[1] as never) as Record<string, unknown>;
    const withoutPayee = purchaseOrdersIngest.map(purchaseOrders[0] as never) as Record<string, unknown>;

    expect(withPayee.payable_to_fleetpal_id).toBe("i2KFJmdU");
    expect(withPayee.vendor_location_fleetpal_id).toBe("BuRxy8Zc");
    expect(withoutPayee.payable_to_fleetpal_id).toBeNull();
    expect(withoutPayee.vendor_location_fleetpal_id).toBe("oe7DPadx");
  });

  it("⚠ keeps the work-order id — without it a dollar cannot reach a truck", () => {
    // 2,899 of 3,969 purchase orders name a work order (F4). That column is the only reason this
    // resource is staged at all rather than the invoices alone: work order → unit → our vehicle.
    const mapped = purchaseOrdersIngest.map(purchaseOrders[0] as never) as Record<string, unknown>;
    expect(mapped.work_order_fleetpal_id).toBe("dAP6VYUL");
    expect(mapped.po_type).toBe("WORK_ORDER");
  });

  it("⚠ carries a null `total_payments` as null, never as zero", () => {
    // D-FIN10: every `total_*` at this vendor is nullable and a dash is what a surface prints for
    // one. Zero would say "nothing has been paid against this purchase order", which is a claim the
    // vendor did not make — all three of F4's recorded rows have `total_payments: null` while
    // carrying a real `total_invoices`.
    const mapped = purchaseOrdersIngest.map(purchaseOrders[0] as never) as Record<string, unknown>;
    expect(mapped.total_payments).toBeNull();
    expect(mapped.total_invoices).toBe(1808.1);
  });
});

describe("what the invoice mapping carries", () => {
  it("⚠ keeps the vendor's invoice number EXACTLY as entered — it is the only key the bridge has", () => {
    // Q9 was ruled (a) on 2026-09-21: the coverage ratio joins on this number alone, because
    // `payable_to` is null 81.5% of the time and `Vendor.code` — FleetPal's own suggested
    // accounting-system key — is populated on 1 of 761 vendors. Any normalisation here (trim, case
    // fold, strip the leading zeros of "4010489436", drop the "WI" of "WI012764") would be
    // indistinguishable at read from a real match, and would turn a stated bound into a guess.
    const numbers = poInvoices.map(
      (row) => (poInvoicesIngest.map(row as never) as Record<string, unknown>).invoice_number,
    );
    expect(numbers).toEqual(["WI012764", "4010489436", "12845"]);

    // ⚠ The three real numbers above CANNOT prove this on their own, and discovering that is the
    // reason this paragraph exists. All three are already uppercase, already trimmed and have no
    // leading zero, so `.trim().toUpperCase().replace(/^0+/, "")` passes the assertion above
    // untouched — a normaliser and the identity are indistinguishable against F4's page. Proved by
    // mutating exactly that in and watching all ten tests stay green.
    //
    // So the discriminating case is synthetic, and deliberately so: it is the shape the assertion
    // is ABOUT rather than a shape the account has happened to produce yet. A supplier who pads to
    // eight digits and a data-entry space are both ordinary, and either would silently become a
    // different invoice number than the one McLeod holds.
    const awkward = poInvoicesIngest.map(
      { ...poInvoices[0], number: " 0012845\t" } as never,
    ) as Record<string, unknown>;
    expect(awkward.invoice_number).toBe(" 0012845\t");
  });

  it("⚠ keeps a CREDIT's type beside its POSITIVE amount, and derives no sign", () => {
    // The vendor's model makes the TYPE the sign: a CREDIT carries a positive `amount`. Summing
    // amounts without reading the type overstates spend by twice every credit note — and a signed
    // column computed in the mapper would quietly absorb a third type nobody has seen yet.
    const credit = poInvoicesIngest.map(
      { ...poInvoices[0], type: "CREDIT", amount: 250.5 } as never,
    ) as Record<string, unknown>;
    expect(credit.invoice_type).toBe("CREDIT");
    expect(credit.amount).toBe(250.5);
    expect(Object.keys(credit)).not.toContain("signed_amount");
  });

  it("keeps the invoice date, which is the month the ratio is grouped by", () => {
    // `date` is the vendor's invoice date and NOT `created`; a September invoice entered into
    // FleetPal in October belongs to September's coverage, because that is the month the general
    // ledger will have posted it in.
    const mapped = poInvoicesIngest.map(poInvoices[1] as never) as Record<string, unknown>;
    expect(mapped.invoice_date).toBe("2026-08-04");
    expect(mapped.vendor_created_at).toBe("2026-09-21T19:09:35.093817Z");
  });

  it("keeps the purchase-order id, which is the bridge's first joint", () => {
    const mapped = poInvoicesIngest.map(poInvoices[0] as never) as Record<string, unknown>;
    expect(mapped.purchase_order_fleetpal_id).toBe("htogZmNa");
  });
});
