import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mount } from "@vue/test-utils";
import WeeklyBillCard from "./WeeklyBillCard.vue";

/**
 * The weekly bill in the old columns, on its invoice check (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §3).
 * The figures are the server's; this pins what the card says with them — and that a check with no
 * recorded statement says so in words rather than showing zeros.
 */
const bill = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("./useWeeklyBill", () => ({
  useWeeklyBillQuery: () => ({ data: bill, isLoading: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn() }),
}));
const ExportStub = { props: ["href", "filename", "scope", "label"], template: "<div />" };
const QueryStateStub = { template: "<div><slot /></div>" };

const overLine = {
  lines: [2], card: "111111", unit: "700", site: "4599", city: "Monteagle", state: "TN", ticket: "T2", auth: null, po: null,
  date: "2026-11-18", odometer: 1, vehicleId: null, driverId: null, productCode: "020", tank: "tractor", units: 151.37,
  fuelCost: 5.0543, amount: 765.07, misc: 0, tax: 0, invoiceTotal: 765.07, retailTotal: 896.11, savings: 131.04,
  quotedPrice: 4.922, overQuotePerGal: 0.1323, overQuoteUsd: 20.03,
};

function mountCard(statementId: string | null) {
  bill.value = {
    statement: { id: "s1", invoiceNo: "INV-59656", accountNo: "139445", periodStart: "2026-11-16", periodEnd: "2026-11-23",
      billingDate: "2026-11-23", sourceFilename: "x.pdf", printed: { amount: 341127.06, retail: null, savings: null }, supersededBy: null },
    report: {
      rows: [overLine],
      byProduct: [{ code: "020", units: 63779.19, amount: 321565.53, retail: 374638.66, savings: 52960.57, lines: 499 }],
      totals: { units: 1, amount: 1, misc: 0, tax: 0, invoiceTotal: 341127.06, retailTotal: 394755.16, savings: 53628.1 },
      overQuote: [overLine],
      quote: { tractorLines: 499, quoted: 349, unquoted: 150, floorUsd: 5 },
    },
  };
  return mount(WeeklyBillCard, { props: { statementId }, global: { stubs: { ExportButton: ExportStub, QueryState: QueryStateStub } } });
}

describe("WeeklyBillCard", () => {
  it("puts back the totals the old statement printed: invoice, retail and savings", () => {
    const text = mountCard("s1").text();
    expect(text).toContain("$341,127.06");
    expect(text).toContain("$394,755.16");
    expect(text).toContain("$53,628.10");
    expect(text).toContain("020 Customer Total");
  });

  it("lists the lines billed above Pilot's quote, and how many lines could be checked", () => {
    const text = mountCard("s1").text();
    expect(text).toContain("Billed above Pilot's quote");
    expect(text).toContain("$20.03 (+$0.1323/gal)");
    expect(text).toContain("349 of 499 truck-diesel lines");
    expect(text).toContain("150 had no quote");
  });

  it("offers the whole statement as Excel, in the old column order", () => {
    const button = mountCard("s1").findComponent(ExportStub);
    expect(button.props("href")).toBe("/api/fueling/statements/s1/weekly-bill.xlsx");
    expect(button.props("filename")).toBe("pilot-INV-59656-2026-11-16-old-columns.xlsx");
  });

  it("says the statement was not saved, rather than showing zeros, when the check has none", () => {
    const w = mountCard(null);
    expect(w.text()).toContain("The statement itself was not saved with this check");
    expect(w.text()).not.toContain("$0.00");
    expect(w.findComponent(ExportStub).exists()).toBe(false);
  });
});
