import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { PilotSftpFile } from "@silvicom/shared";

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: api.fetch }));

import PilotSftpCard from "./PilotSftpCard.vue";

const row = (over: Partial<PilotSftpFile>): PilotSftpFile => ({
  remote_path: "/pq-139445-11272026.xlsx", remote_size: 61_000, remote_mtime: "2026-11-26T20:20:00Z", kind: "price_quote", state: "loaded",
  attempts: 1, effective_date: "2026-11-27", rows_loaded: 677, error: null, first_seen_at: "2026-11-26T20:30:00Z", last_tried_at: "2026-11-26T20:30:00Z",
  ...over,
});

async function render() {
  const w = mount(PilotSftpCard, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] } });
  await flushPromises();
  return w;
}

describe("PilotSftpCard", () => {
  beforeEach(() => api.fetch.mockReset());

  it("lists each file with what became of it: a loaded quote's day and count, a held transaction file as kept", async () => {
    api.fetch.mockResolvedValue({ ok: true, data: { files: [
      row({}),
      row({ remote_path: "/Transactions_139445_20261126.csv", kind: "transactions", state: "held", effective_date: null, rows_loaded: null, error: "Kept: no reader yet" }),
    ] } });
    const w = await render();
    expect(api.fetch).toHaveBeenCalledWith("/api/fueling/prices/sftp");
    const items = w.findAll('[data-test="sftp-list"] li').map((li) => li.text());
    expect(items[0]).toMatch(/Price quote\s*Loaded\s*677 prices for 11\/27\/2026/);
    expect(items[0]).toContain("pq-139445-11272026.xlsx");
    expect(items[1]).toMatch(/Transactions\s*Kept\s*Kept safely/);
  });

  it("shows a failed file's reason", async () => {
    api.fetch.mockResolvedValue({ ok: true, data: { files: [row({ state: "failed", rows_loaded: null, error: "Download failed: timeout" })] } });
    const w = await render();
    expect(w.text()).toContain("Failed");
    expect(w.text()).toContain("Download failed: timeout");
  });

  it("says so when no file has come yet", async () => {
    api.fetch.mockResolvedValue({ ok: true, data: { files: [] } });
    expect((await render()).get('[data-test="sftp-empty"]').text()).toContain("No file has come from Pilot's SFTP yet.");
  });

  it("offers a retry when the read fails", async () => {
    api.fetch.mockResolvedValue({ ok: false, error: { message: "nope" } });
    const w = await render();
    expect(w.text()).toContain("Could not load Pilot's SFTP files.");
    expect(w.text()).toContain("Retry");
  });
});
