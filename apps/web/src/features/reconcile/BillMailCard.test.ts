import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import BillMailCard from "./BillMailCard.vue";

/**
 * "Did this week's Pilot bill arrive?" (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §4). The card shows what the
 * automatic pull did with each email, in words — including the refusals, which are the ones somebody must act on.
 */
const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));

async function mountWith(mails: unknown[]) {
  apiFetch.mockResolvedValueOnce({ ok: true, data: { mails } });
  const w = mount(BillMailCard, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } });
  await flushPromises();
  return w;
}
const base = { subject: "FW: Pilot invoice", received_at: "2026-11-23T22:00:00Z", attempts: 1, file_name: "x.pdf", invoice_no: null,
  period_start: null, period_end: null, statement_id: null, error: null, last_tried_at: "2026-11-23T22:05:00Z" };

describe("BillMailCard", () => {
  it("names the recorded week and invoice, a duplicate, and a refusal with Pilot's own reason", async () => {
    const text = (await mountWith([
      { ...base, state: "recorded", invoice_no: "INV-59656", period_start: "2026-11-16", period_end: "2026-11-23", statement_id: "s1" },
      { ...base, state: "duplicate", invoice_no: "INV-59656", statement_id: "s1" },
      { ...base, state: "refused", error: "The statement didn't add up. off by $787.77" },
    ])).text();
    expect(apiFetch).toHaveBeenCalledWith("/api/fueling/statements/mail");
    expect(text).toContain("Recorded");
    expect(text).toContain("Invoice INV-59656 · 11/16/2026 – 11/23/2026");
    expect(text).toContain("Already in");
    expect(text).toContain("Refused");
    expect(text).toContain("off by $787.77");
  });

  it("says plainly when no bill email has been read yet", async () => {
    expect((await mountWith([])).text()).toContain("No Pilot bill email has been read yet.");
  });
});
