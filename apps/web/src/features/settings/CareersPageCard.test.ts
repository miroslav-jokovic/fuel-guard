import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { CareersPageStatus } from "@silvicom/shared";

/**
 * Settings › Recruiting › Careers page (APPLY-PAGE-PLAN AP1). Pinned: what is sent for each act, that the card refuses
 * what the server refuses before sending, that a refused step-up becomes the password prompt, that the robot check's
 * absence is said, and that each opening not on the page says why.
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

import CareersPageCard from "./CareersPageCard.vue";
import StepUpPrompt from "@/components/StepUpPrompt.vue";

const PATH = "/api/recruitment/careers-page";
const status = (over: Partial<CareersPageStatus> = {}): CareersPageStatus => ({
  configured: true, handle: "silvicom", enabled: false, accommodationEmail: "recruiting@silvicominc.com", accommodationPhone: "+17082365732",
  publicUrl: "https://360.example.test/careers/silvicom", robotCheckReady: true, openings: [], ...over,
});
const NEW = { configured: false, handle: null, accommodationEmail: null, accommodationPhone: null, publicUrl: null };

const render = async (s: CareersPageStatus) => {
  api.status = s;
  setActivePinia(createPinia());
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = mount(CareersPageCard, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  await flushPromises();
  return w;
};
type W = Awaited<ReturnType<typeof render>>;
const button = (w: W, label: string) => w.findAll("button").find((b) => b.text() === label);
const click = async (w: W, label: string) => {
  await button(w, label)!.trigger("click");
  await flushPromises();
};
const field = (w: W, label: string) => {
  const l = w.findAll("label").find((x) => x.text() === label)!;
  return w.find(`#${l.attributes("for")}`);
};
const writes = () => api.calls.filter((c) => c.method !== "GET");

beforeEach(() => {
  api.calls = [];
  api.answer = {};
});

describe("CareersPageCard — before it is set up", () => {
  it("shows only the form, and saves the handle and contact switched off", async () => {
    const w = await render(status(NEW));
    expect(w.find('[role="switch"]').exists()).toBe(false);
    await field(w, "Page address").setValue(" Silvicom ");
    await field(w, "Accommodation requests: email").setValue("recruiting@silvicominc.com");
    await click(w, "Save");
    expect(writes()).toEqual([{ url: PATH, method: "PUT", body: { handle: "silvicom", enabled: false, accommodationEmail: "recruiting@silvicominc.com", accommodationPhone: null } }]);
  });

  it("a contact left empty is sent as none, never as an empty string", async () => {
    const w = await render(status(NEW));
    await field(w, "Page address").setValue("silvicom");
    await field(w, "Accommodation requests: phone").setValue("708 236 5732");
    await click(w, "Save");
    expect(writes()).toEqual([{ url: PATH, method: "PUT", body: { handle: "silvicom", enabled: false, accommodationEmail: null, accommodationPhone: "708 236 5732" } }]);
  });

  it("refuses an address people cannot type, and sends nothing", async () => {
    const w = await render(status(NEW));
    await field(w, "Page address").setValue("silvicom inc");
    await click(w, "Save");
    expect(writes()).toEqual([]);
    expect(w.text()).toContain("lower-case letters, digits or hyphens");
  });
});

describe("CareersPageCard — switching it on", () => {
  it("sends enabled with the saved contact; a refused step-up becomes the password prompt", async () => {
    api.answer[`PUT ${PATH}`] = { ok: false, error: { code: "step_up_required", message: "Confirm your password to publish the careers page." } };
    const w = await render(status());
    await w.find('[role="switch"]').trigger("click");
    await flushPromises();
    expect(writes()).toEqual([{ url: PATH, method: "PUT", body: { handle: "silvicom", enabled: true, accommodationEmail: "recruiting@silvicominc.com", accommodationPhone: "(708) 236-5732" } }]);
    expect(w.text()).toContain("Confirm your password to publish the careers page.");
    // The prompt itself, not the sentence printed as an error under the address.
    expect(w.findComponent(StepUpPrompt).exists()).toBe(true);
    expect(w.find('input[type="password"]').exists()).toBe(true);
  });

  it("will not switch on without an accommodation contact, and says why", async () => {
    const w = await render(status({ accommodationEmail: null, accommodationPhone: null }));
    await w.find('[role="switch"]').trigger("click");
    await flushPromises();
    expect(writes()).toEqual([]);
    expect(w.text()).toContain("for applicants who need an accommodation before it can be on");
  });

  it("a handle another account holds is said on the field", async () => {
    api.answer[`PUT ${PATH}`] = { ok: false, error: { code: "careers_handle_taken", message: "Another Silvicom 360 account already uses this address. Choose another." } };
    const w = await render(status());
    await click(w, "Save");
    expect(w.text()).toContain("Another Silvicom 360 account already uses this address.");
  });
});

describe("CareersPageCard — what it says", () => {
  it("the link when on, and what is and is not on the page, each with its reason", async () => {
    const w = await render(status({
      enabled: true,
      openings: [
        { id: "a", title: "Regional dry van", status: "open", unpublished: null },
        { id: "b", title: "OTR reefer", status: "open", unpublished: "no_pay_top" },
        { id: "c", title: "Local flatbed", status: "paused", unpublished: "not_open" },
        { id: "d", title: null, status: "open", unpublished: "no_version" },
      ],
    }));
    const text = w.text();
    expect(text).toContain("https://360.example.test/careers/silvicom");
    expect(text).toContain("On — anyone with the link");
    expect(text).toContain("Regional dry van");
    expect(text).toContain("OTR reefer — Not on the careers page: it needs the top of its pay range (Illinois Equal Pay Act).");
    expect(text).toContain("Local flatbed — Not open, so not on the careers page.");
    expect(text).toContain("Untitled opening — Has no saved details yet.");
  });

  it("no published opening is said, and so is a server with no robot check", async () => {
    const w = await render(status({ robotCheckReady: false }));
    expect(w.text()).toContain("No opening is published yet.");
    expect(w.text()).toContain("The robot check is not set up on this server");
  });

  it("a server with the robot check says nothing about it", async () => {
    const w = await render(status());
    expect(w.text()).not.toContain("robot check");
  });
});
