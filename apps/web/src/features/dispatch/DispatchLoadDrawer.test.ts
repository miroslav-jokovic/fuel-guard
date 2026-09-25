import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { AppCombobox } from "@silvicom/ui";

/**
 * The Dispatch drawer (LR-D3, D-LMR5/D-LMR6). What it must hold:
 *   · McLeod's driver is pre-selected, and choosing somebody else is what gets sent;
 *   · the message shown is the API's preview, verbatim — the browser never composes it;
 *   · it says plainly that no text went out, and why, rather than implying one did;
 *   · a driver the API would refuse (not active) is never offered.
 */
const LOAD = "11111111-2222-4333-8444-000000000001";
const MCLEOD = "d-mcleod";
const OTHER = "d-other";
const GONE = "d-gone";

const calls = vi.hoisted(() => ({ gets: [] as string[], posts: [] as { url: string; body: unknown }[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    if (opts?.method === "POST") {
      calls.posts.push({ url, body: opts.body });
      return {
        ok: true,
        data: { dispatch: { id: "x", driverName: "Sam Other", outcome: "not_sent", outcomeReason: "sms_not_configured" } },
      };
    }
    calls.gets.push(url);
    const driverId = new URL(url, "https://app.test").searchParams.get("driverId");
    return {
      ok: true,
      data: {
        preview: {
          loadId: LOAD,
          driverId,
          driverName: "whoever",
          body: `Silvicom Transport: load 0012345\nPick up: ACME Foods, Dallas TX, 09/25/2026 8:00 AM [${driverId}]`,
          smsHeldBecause: "sms_not_configured",
        },
      },
    };
  }),
}));
vi.mock("@/composables/useDrivers", () => ({
  useDriversQuery: () => ({
    data: ref([
      { id: MCLEOD, full_name: "Dana Kelly", status: "active", archived_at: null },
      { id: OTHER, full_name: "Sam Other", status: "active", archived_at: null },
      { id: GONE, full_name: "Left Us", status: "terminated", archived_at: null },
    ]),
  }),
}));

const SlideOverStub = {
  template: "<div v-if='open'><slot /><slot name='footer' /></div>",
  props: ["open", "title", "description"],
};
const DispatchLoadDrawer = (await import("./DispatchLoadDrawer.vue")).default;

const mountIt = (driverId: string | null = MCLEOD) =>
  mount(DispatchLoadDrawer, {
    props: { load: { id: LOAD, ref: "0012345", driver_id: driverId, driver_name: "Dana Kelly", last_dispatch: null } },
    global: { plugins: [VueQueryPlugin], stubs: { SlideOver: SlideOverStub } },
  });
const sendButton = (w: ReturnType<typeof mountIt>) => w.findAll("button").find((b) => b.text() === "Dispatch");

beforeEach(() => {
  setActivePinia(createPinia());
  calls.gets.length = 0;
  calls.posts.length = 0;
});

describe("DispatchLoadDrawer", () => {
  it("pre-selects McLeod's driver and shows the API's message verbatim, with why no text goes out", async () => {
    const w = mountIt();
    await flushPromises();
    expect(calls.gets[0]).toContain(`driverId=${MCLEOD}`);
    expect(w.get("[data-testid=dispatch-preview]").text()).toBe(
      `Silvicom Transport: load 0012345\nPick up: ACME Foods, Dallas TX, 09/25/2026 8:00 AM [${MCLEOD}]`,
    );
    expect(w.get("[data-testid=dispatch-held]").text()).toContain("Text messages aren't set up yet, so no text was sent.");
  });

  it("sends the driver the dispatcher CHOSE, even when it is not McLeod's", async () => {
    const w = mountIt();
    await flushPromises();
    w.findComponent(AppCombobox).vm.$emit("update:modelValue", OTHER);
    await flushPromises();
    expect(w.get("[data-testid=dispatch-preview]").text()).toContain(`[${OTHER}]`);
    await sendButton(w)!.trigger("click");
    await flushPromises();
    expect(calls.posts).toEqual([{ url: `/api/dispatch/loads/${LOAD}/dispatch`, body: { driverId: OTHER } }]);
    expect(w.emitted("close")).toHaveLength(1);
  });

  it("offers only active drivers, and marks which one McLeod has", () => {
    const labels = (w: ReturnType<typeof mountIt>) =>
      (w.findComponent(AppCombobox).props("options") as { label: string }[]).map((o) => o.label);
    expect(labels(mountIt())).toEqual(["Dana Kelly (McLeod's driver)", "Sam Other"]);
  });

  it("with no McLeod driver, nothing is chosen for the dispatcher and Dispatch waits", async () => {
    const w = mountIt(null);
    await flushPromises();
    expect(w.text()).toContain("McLeod has no driver on this load yet.");
    expect(calls.gets).toHaveLength(0);
    expect(sendButton(w)!.attributes("disabled")).toBeDefined();
  });
});
