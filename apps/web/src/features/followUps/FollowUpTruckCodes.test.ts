import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { FollowUpTruckCodes, TruckFaultCode } from "@silvicom/shared";

/**
 * The drawer's codes section (D-ORM8–10): the truck's own codes first, the cameras' folded, what came
 * and went — and, when Samsara did not answer, the kept codes with their age said out loud.
 */
const api = vi.hoisted(() => ({ answer: null as unknown, paths: [] as string[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string) => {
    api.paths.push(path);
    return api.answer === "fail" ? { ok: false, error: { message: "Samsara did not answer" } } : { ok: true, data: api.answer };
  }),
}));

const { default: FollowUpTruckCodes } = await import("./FollowUpTruckCodes.vue");

const code = (spn: number, module: number, over: Partial<TruckFaultCode> = {}): TruckFaultCode => ({
  module, moduleName: module === 232 ? "Forward Road Image Processor" : "Engine #1", spn, fmi: 3, description: `Code ${spn}`,
  fmiDescription: null, makerSpecific: false, occurrences: 1, ...over,
});

async function render(answer: FollowUpTruckCodes | "fail") {
  api.answer = answer;
  const w = mount(FollowUpTruckCodes, {
    props: { followUpId: "fu-1" },
    global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]] },
  });
  await flushPromises();
  return w;
}

beforeEach(() => {
  api.paths = [];
});

describe("FollowUpTruckCodes", () => {
  it("lists the truck's own codes, folds the camera's, and shows what came and went", async () => {
    const w = await render({
      source: "samsara",
      asOf: "2026-11-27T10:32:12.000Z",
      lamps: { stop: true, warning: false, emissions: false, protect: false },
      now: [code(232001, 232), code(1636, 0, { makerSpecific: true, description: null })],
      cameAndWent: [{ ...code(110, 0), firstSeen: "2026-11-25T08:00:00.000Z", lastSeen: "2026-11-26T08:00:00.000Z" }],
      since: "2026-11-24T11:00:00.000Z",
      sinceCapped: false,
    });
    expect(api.paths).toEqual(["/api/follow-ups/fu-1/codes"]);
    expect(w.find('[data-test="codes-as-of"]').text()).toContain("Lamps on: red STOP.");
    const own = w.find('ul[aria-label="Codes on the truck now"]').text();
    expect(own).toContain("Maker-specific code — the shop looks it up by its SPN");
    expect(own).toContain("SPN 1636 · FMI 3");
    expect(own).not.toContain("232001");
    expect(w.find('[data-test="codes-electronics"] summary').text()).toBe("Cameras, radar and telematics: 1 code");
    expect(w.find('[data-test="codes-came-and-went"]').text()).toContain("Code 110");
  });

  it("says the codes are the kept ones, and how old, when Samsara did not answer", async () => {
    const w = await render({ source: "stored", asOf: "2026-11-26T08:00:00.000Z", now: [code(444, 0)] });
    expect(w.find('[data-test="codes-stored"]').text()).toContain("Samsara did not answer");
    expect(w.find('[data-test="codes-came-and-went"]').exists()).toBe(false);
    expect(w.text()).toContain("Code 444");
  });

  it("says when Samsara has no reading at all for the truck, rather than an empty list", async () => {
    const w = await render({ source: "samsara", asOf: null, lamps: null, now: [], cameAndWent: [], since: "2026-11-24T11:00:00.000Z", sinceCapped: false });
    expect(w.find('[data-test="codes-as-of"]').text()).toBe("Samsara has no fault-code reading for this truck.");
    expect(w.text()).not.toContain("No codes from the truck's own systems now.");
  });

  it("offers a retry when the read fails", async () => {
    const w = await render("fail");
    expect(w.text()).toContain("Could not read the truck's codes.");
  });
});
