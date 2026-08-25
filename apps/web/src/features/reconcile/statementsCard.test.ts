import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import type { StatementSummary } from "./useStatements";

/**
 * The list of statements we hold, and the link back to the PDF each figure came from.
 *
 * ── WHY THE "ORIGINAL" COLUMN IS THE ONE WORTH PINNING ───────────────────────────────────────────
 * Storing the source PDF is what makes every figure on this surface traceable to the document it was
 * read from — the argument 0243 gives for the private bucket, and the thing a discount conversation
 * with Pilot would actually rest on. A row whose `source_path` is null therefore has to say so: a
 * button that opens nothing is worse than an em dash, because the reader only finds out at the moment
 * they need the evidence.
 *
 * ── AND A FACT WORTH RECORDING HERE ──────────────────────────────────────────────────────────────
 * Measured on production 2026-08-25, `fuel_statements` holds **zero rows** — no statement has ever
 * been persisted, so every assertion below describes a surface no carrier has yet seen and the WP4
 * ingest path has never run outside a test. That is F0-bis in the plan, not a defect in this file,
 * but it is why the empty case is asserted as carefully as the populated one.
 */

const openSource = vi.fn(async () => "https://example.test/signed");
vi.mock("./useStatements", async (orig) => {
  const actual = await orig<typeof import("./useStatements")>();
  return { ...actual, statementSourceUrl: (...a: unknown[]) => openSource(...(a as [])) };
});

import StatementsCard from "./StatementsCard.vue";

const stmt = (o: Partial<StatementSummary> = {}): StatementSummary => ({
  id: "st1", invoiceNo: "795506105", periodStart: "2026-08-17", periodEnd: "2026-08-23",
  billingDate: "2026-08-24", totalGallons: 53937, fuelAmount: 259_487.2, invoiceTotal: 260_100.5,
  retailTotal: 290_569.3, savings: 31_082.1, lineCount: 849, sourceFilename: "db139445F.pdf",
  hasSource: true, createdAt: "2026-08-24T10:00:00Z", ...o,
});

beforeEach(() => {
  setActivePinia(createPinia());
  openSource.mockClear();
  // jsdom has no navigation, and the card opens the signed URL in a new tab.
  vi.stubGlobal("open", vi.fn());
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: true, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

const render = (statements: StatementSummary[], extra = {}) =>
  mount(StatementsCard, { props: { statements, ...extra }, global: { plugins: [createPinia()] } });

describe("StatementsCard", () => {
  it("lists a kept week with its invoice and what it billed", () => {
    const t = render([stmt()]).text();
    expect(t).toContain("795506105");
    expect(t).toContain("2026-08-17 → 2026-08-23");
    expect(t).toContain("849"); // lines
    expect(t).not.toContain("NaN");
    expect(t).not.toContain("undefined");
  });

  it("offers the original PDF, because that is what the figures trace back to", async () => {
    const w = render([stmt()]);
    const open = w.findAll("button").find((b) => b.text() === "Open PDF");
    expect(open, "a statement with a stored source offered no way to open it").toBeTruthy();
    await open!.trigger("click");
    expect(openSource).toHaveBeenCalledWith("st1");
  });

  it("shows an em dash rather than a button that opens nothing", () => {
    const w = render([stmt({ hasSource: false })]);
    expect(w.findAll("button").some((b) => b.text() === "Open PDF")).toBe(false);
    expect(w.text()).toContain("—");
  });

  it("states the empty case as a fact and the next action", () => {
    const t = render([]).text();
    expect(t).toContain("No statements kept yet");
    expect(t).toContain("Upload a weekly Pilot statement");
    expect(t).not.toContain("NaN");
  });

  it("reports a failed load rather than an empty list, which mean opposite things", () => {
    const t = render([], { error: "Could not load statements" }).text();
    expect(t).toContain("Could not load statements");
    expect(t).not.toContain("No statements kept yet");
  });

  it("computes fuel per gallon without dividing by zero on a statement with no gallons", () => {
    // Defensive: a merchandise-only or mis-parsed statement must not print "$Infinity".
    const t = render([stmt({ totalGallons: 0, fuelAmount: 0 })]).text();
    expect(t).not.toContain("NaN");
    expect(t).not.toContain("Infinity");
    expect(t).toContain("—");
  });
});
