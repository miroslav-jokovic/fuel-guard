import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { TenstreetConnectionStatus, TenstreetKeyIssued } from "@silvicom/shared";

/**
 * Settings › Recruiting › Tenstreet (TENSTREET-INTAKE-PLAN TS4). Pinned: what is sent for each act, that the
 * address is shown whole only once and only after a person agreed to replace the old one, that a refused step-up
 * becomes the password prompt instead of an error, and that the week's log is said, problems included.
 */
const api = vi.hoisted(() => ({
  status: null as unknown,
  calls: [] as Array<{ url: string; method: string; body?: unknown }>,
  answer: {} as Record<string, { ok: boolean; data?: unknown; error?: { code?: string; message?: string } }>,
}));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, init: { method?: string; body?: unknown } = {}) => {
    const method = init.method ?? "GET";
    api.calls.push({ url, method, ...(init.body === undefined ? {} : { body: init.body }) });
    if (method === "GET") return { ok: true, data: api.status };
    return api.answer[`${method} ${url}`] ?? { ok: true, data: { ok: true } };
  }),
}));
const confirmAnswer = vi.hoisted(() => ({ value: true, asked: [] as unknown[] }));
vi.mock("@silvicom/ui", async (orig) => ({
  ...(await orig<object>()),
  useConfirm: () => async (req: unknown) => (confirmAnswer.asked.push(req), confirmAnswer.value),
}));

import TenstreetConnectionCard from "./TenstreetConnectionCard.vue";

const PATH = "/api/recruitment/tenstreet/connection";
const status = (over: Partial<TenstreetConnectionStatus> = {}): TenstreetConnectionStatus => ({
  configured: true, companyId: "14", mode: "test", enabled: false, keyHint: "wxYz", rotatedAt: "2026-11-20T15:00:00Z",
  lastPostAt: null, endpointMasked: "https://api.example.test/api/webhooks/tenstreet/••••wxYz", receiverReady: true,
  last7Days: { accepted: 0, rejected: 0, failed: 0 }, lastProblem: null, ...over,
});
const ISSUED: TenstreetKeyIssued = {
  key: "A".repeat(39) + "q9Zz", keyHint: "q9Zz", endpoint: `https://api.example.test/api/webhooks/tenstreet/${"A".repeat(39)}q9Zz`, rotatedAt: "2026-11-20T16:00:00Z",
};

const render = async (s: TenstreetConnectionStatus) => {
  api.status = s;
  setActivePinia(createPinia());
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = mount(TenstreetConnectionCard, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  await flushPromises();
  return w;
};
const button = (w: Awaited<ReturnType<typeof render>>, label: string) => w.findAll("button").find((b) => b.text() === label);
const click = async (w: Awaited<ReturnType<typeof render>>, label: string) => {
  await button(w, label)!.trigger("click");
  await flushPromises();
};
const writes = () => api.calls.filter((c) => c.method !== "GET");

beforeEach(() => {
  api.calls = [];
  api.answer = {};
  confirmAnswer.value = true;
  confirmAnswer.asked = [];
});

describe("TenstreetConnectionCard — before it is set up", () => {
  it("shows only the form, and saves the Company ID and mode switched off", async () => {
    const w = await render(status({ configured: false, companyId: null, keyHint: null, endpointMasked: null }));
    expect(button(w, "Make the address")).toBeUndefined();
    expect(w.find('[role="switch"]').exists()).toBe(false);
    await w.find("input").setValue(" 1234 ");
    await click(w, "Save");
    expect(writes()).toEqual([{ url: PATH, method: "PUT", body: { companyId: "1234", mode: "test", enabled: false } }]);
  });

  it("refuses a Company ID that is not digits, and sends nothing", async () => {
    const w = await render(status({ configured: false, companyId: null, keyHint: null }));
    await w.find("input").setValue("14a");
    await click(w, "Save");
    expect(writes()).toEqual([]);
    expect(w.text()).toContain("digits only");
  });
});

describe("TenstreetConnectionCard — the address", () => {
  it("shows the masked address, never a whole one, until a new one is made", async () => {
    const w = await render(status());
    expect(w.text()).toContain("••••wxYz");
    expect(w.text()).not.toContain("Copy the address");
  });

  it("a first address is made without a question; a replacement is asked first, and No sends nothing", async () => {
    let w = await render(status({ keyHint: null, endpointMasked: null }));
    api.answer[`POST ${PATH}/rotate-key`] = { ok: true, data: ISSUED };
    await click(w, "Make the address");
    expect(confirmAnswer.asked).toEqual([]);
    expect(writes()).toEqual([{ url: `${PATH}/rotate-key`, method: "POST" }]);

    api.calls = [];
    confirmAnswer.value = false;
    w = await render(status());
    await click(w, "Make a new address");
    expect(confirmAnswer.asked).toHaveLength(1);
    expect(writes()).toEqual([]);
  });

  it("the new address is shown whole once, with the warning that it cannot be shown again", async () => {
    api.answer[`POST ${PATH}/rotate-key`] = { ok: true, data: ISSUED };
    const w = await render(status());
    await click(w, "Make a new address");
    expect(w.text()).toContain(ISSUED.endpoint);
    expect(w.text()).toContain("It is shown once here");
    expect(w.text()).toContain("by phone");
  });

  it("a deploy that does not know its own address shows the key and says where it goes", async () => {
    api.answer[`POST ${PATH}/rotate-key`] = { ok: true, data: { ...ISSUED, endpoint: null } };
    const w = await render(status({ keyHint: null, endpointMasked: null }));
    await click(w, "Make the address");
    expect(w.text()).toContain(ISSUED.key);
    expect(w.text()).toContain("/api/webhooks/tenstreet/");
  });

  it("a refused step-up becomes the password prompt, not an error", async () => {
    api.answer[`POST ${PATH}/rotate-key`] = { ok: false, error: { code: "step_up_required", message: "Confirm your password to make a new address." } };
    const w = await render(status({ keyHint: null, endpointMasked: null }));
    await click(w, "Make the address");
    expect(w.text()).toContain("Confirm your password to make a new address.");
    expect(w.text()).not.toContain("Could not make the address");
  });
});

describe("TenstreetConnectionCard — the switch and the week", () => {
  it("switching on sends the form with enabled true; it cannot be switched on with no address", async () => {
    let w = await render(status());
    await w.find('[role="switch"]').trigger("click");
    await flushPromises();
    expect(writes()).toEqual([{ url: PATH, method: "PUT", body: { companyId: "14", mode: "test", enabled: true } }]);

    w = await render(status({ keyHint: null, endpointMasked: null }));
    expect(w.find('[role="switch"]').attributes("disabled")).toBeDefined();
  });

  it("says the week's counts, the last accepted post and the last problem in its own sentence", async () => {
    const w = await render(status({
      enabled: true, lastPostAt: "2026-11-20T14:00:00Z", last7Days: { accepted: 5, rejected: 2, failed: 1 },
      lastProblem: { at: "2026-11-20T11:00:00Z", kind: "rejected", reason: "wrong_mode", text: "This listener takes the other Mode (TEST or PROD)." },
    }));
    expect(w.text()).toContain("Last 7 days: 5 accepted, 2 refused, 1 could not become a lead.");
    expect(w.text()).toContain("A post was refused");
    expect(w.text()).toContain("This listener takes the other Mode (TEST or PROD).");
    expect(w.text()).toContain("Last application accepted");
  });

  it("a server that cannot keep posts says so above everything", async () => {
    const w = await render(status({ receiverReady: false }));
    expect(w.text()).toContain("encryption key is not set");
  });
});
