import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { PilotPriceMail } from "@silvicom/shared";

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: api.fetch }));

import PriceMailCard from "./PriceMailCard.vue";

const row = (over: Partial<PilotPriceMail>): PilotPriceMail => ({
  subject: "11-19-2026 Price Quote - Pilot Flying J", received_at: "2026-11-18T20:24:26Z", state: "loaded", attempts: 1,
  effective_date: "2026-11-19", prices_loaded: 677, sites: 677, geocode_pending: 0, error: null, last_tried_at: "2026-11-18T20:40:00Z",
  ...over,
});

async function render() {
  const w = mount(PriceMailCard, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] } });
  await flushPromises();
  return w;
}

describe("PriceMailCard", () => {
  beforeEach(() => api.fetch.mockReset());

  it("reads the emailed quotes from the API and says which day's quote is newest", async () => {
    api.fetch.mockResolvedValue({ ok: true, data: { mails: [
      row({}),
      row({ subject: "11-17-2026 Price Quote - Pilot Flying J", state: "expired", effective_date: null, prices_loaded: null, error: "The link has expired" }),
    ] } });
    const w = await render();
    expect(api.fetch).toHaveBeenCalledWith("/api/fueling/prices/mail");
    expect(w.get('[data-test="price-mail-newest"]').text()).toContain("11/19/2026");
    const items = w.findAll('[data-test="price-mail-list"] li').map((li) => li.text());
    expect(items[0]).toMatch(/11\/19\/2026\s*Loaded\s*677 prices/);
    // An expired email has no Effective Date: its day comes from Pilot's subject, and it says what to do.
    expect(items[1]).toMatch(/11\/17\/2026\s*Expired/);
    expect(items[1]).toContain("upload it below");
  });

  it("shows a failed email's reason", async () => {
    api.fetch.mockResolvedValue({ ok: true, data: { mails: [row({ state: "failed", effective_date: null, prices_loaded: null, error: "Pilot answered 503" })] } });
    const w = await render();
    expect(w.text()).toContain("Failed");
    expect(w.text()).toContain("Pilot answered 503");
    expect(w.find('[data-test="price-mail-newest"]').exists()).toBe(false);
  });

  it("says so when no email has been read yet", async () => {
    api.fetch.mockResolvedValue({ ok: true, data: { mails: [] } });
    expect((await render()).get('[data-test="price-mail-empty"]').text()).toContain("No Pilot price email");
  });

  it("offers a retry when the read fails", async () => {
    api.fetch.mockResolvedValue({ ok: false, error: { message: "nope" } });
    const w = await render();
    expect(w.text()).toContain("Could not load the emailed quotes.");
    expect(w.text()).toContain("Retry");
  });
});
