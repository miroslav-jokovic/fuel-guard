import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { idleParityReport, type IdleParityDay } from "@silvicom/shared";

/**
 * The Idling page's idle-engine check (IE5, D-IE9). The gate is the server's; what this pins is that
 * the page says honestly where it stands — nothing finished yet, still counting days, or ready — and
 * lists the trucks that disagree with signed misses. Views are built by the real `idleParityReport`.
 */
const fetched = { value: null as unknown, ok: true };
const calls: string[] = [];
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string) => {
    calls.push(url);
    return fetched.ok ? { ok: true, data: { ok: true, data: fetched.value } } : { ok: false, error: { message: "boom" } };
  }),
}));

import IdleEngineParityPanel from "./IdleEngineParityPanel.vue";

const H = 3600;
const day = (vehicleId: string, d: number, o: Partial<IdleParityDay> = {}): IdleParityDay => ({
  vehicleId, day: `2026-10-${String(d).padStart(2, "0")}`, hours: 24,
  runningSec: 10 * H, stoppedSec: 4 * H, ecuSec: 10 * H, ecuHours: 24, samsaraIdleSec: 4 * H,
  noDataSec: 0, samsaraWholeDay: true, ...o,
});
const view = (rows: IdleParityDay[], finalThrough: string | null) => {
  const r = idleParityReport(rows, finalThrough);
  return { ...r, timezone: "America/Chicago", disagreements: r.disagreements.map((d) => ({ ...d, unit: d.vehicleId === "v9" ? "650" : "x" })) };
};

const render = async () => {
  const w = mount(IdleEngineParityPanel, {
    global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] },
  });
  await flushPromises();
  return w;
};

beforeEach(() => {
  calls.length = 0;
  fetched.ok = true;
  fetched.value = view([], null);
});

describe("IdleEngineParityPanel", () => {
  it("reads its own route, and states the gate in the ruling's numbers", async () => {
    const t = (await render()).text();
    expect(calls).toEqual(["/api/idle/engine/parity"]);
    expect(t).toContain("within 3% on 95% of days over 14 finished days");
    // Q-IE17: idling against Samsara is information, and the page says why it reads higher.
    expect(t).not.toContain("within 5%");
    expect(t).toContain("shown, not judged");
  });

  it("before any day is finished, says so rather than showing a share", async () => {
    const t = (await render()).text();
    expect(t).toContain("Still checking");
    expect(t).toContain("No day is finished yet");
    expect(t).not.toContain("days agree");
  });

  it("while days are being counted: how many, through when, and the share — and lists the truck that disagreed", async () => {
    // Two days; 650 ran 20% over its ECU on 10/02. 3 of 4 days agree.
    fetched.value = view([day("v1", 1), day("v1", 2), day("v9", 1), day("v9", 2, { runningSec: 12 * H })], "2026-10-02");
    const w = await render();
    const t = w.text();
    expect(t).toContain("Still checking");
    expect(t).toContain("2 of 14 days finished, through 10/02/2026");
    expect(t).toContain("75% of 4 days agree");
    expect(t).toContain("650");
    expect(t).toContain("+20.0%");
  });

  it("at 14 days and 95%: ready to switch", async () => {
    fetched.value = view(Array.from({ length: 14 }, (_, i) => day("v1", i + 1)), "2026-10-14");
    expect((await render()).text()).toContain("Ready to switch");
  });

  it("at 14 days below 95%: not agreeing yet", async () => {
    fetched.value = view(Array.from({ length: 14 }, (_, i) => day("v1", i + 1, { runningSec: i < 2 ? 5 * H : 10 * H })), "2026-10-14");
    expect((await render()).text()).toContain("Not agreeing yet");
  });

  it("never rounds a failing share up to the bar: 189 of 199 (94.97%) reads 94.9%", async () => {
    const rows = [
      ...Array.from({ length: 14 }, (_, t) => Array.from({ length: 14 }, (_, i) => day(`v${t}`, i + 1, { runningSec: t === 0 && i < 10 ? 5 * H : 10 * H }))).flat(),
      day("w1", 1), day("w2", 1), day("w3", 1),
    ];
    fetched.value = view(rows, "2026-10-14");
    const t = (await render()).text();
    expect(t).toContain("94.9% of 199 days agree");
    expect(t).toContain("Not agreeing yet");
  });

  it("a failed read is an error, not a clean bill", async () => {
    fetched.ok = false;
    const t = (await render()).text();
    expect(t).toContain("boom");
    expect(t).not.toContain("Ready to switch");
  });
});
