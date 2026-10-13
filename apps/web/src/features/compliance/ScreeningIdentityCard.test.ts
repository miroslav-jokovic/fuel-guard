import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";

/** D-US6 — the screening identity's read-only values are a FactList; an unrecorded licence is a dash. */
vi.mock("@/stores/session", async () => {
  const { fakeSession } = await import("@/testing/fakeSession");
  const s = fakeSession("admin");
  return { useSessionStore: () => s };
});
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
const ScreeningIdentityCard = (await import("./ScreeningIdentityCard.vue")).default;

const driver = (extra: Record<string, unknown> = {}) =>
  ({ id: "d1", cdl_number: "PA334554", cdl_state: null, date_of_birth: "1980-04-02", ...extra }) as never;

beforeEach(() => setActivePinia(createPinia()));

describe("the screening identity card", () => {
  it("lists licence number, state and date of birth, with a dash for what the roster lacks", () => {
    const w = mount(ScreeningIdentityCard, { props: { driver: driver() }, global: { plugins: [VueQueryPlugin] } });
    expect(w.findAll("dt").map((d) => d.text())).toEqual(["Licence number", "Licence state", "Date of birth"]);
    expect(w.findAll("dd").map((d) => d.text())).toEqual(["PA334554", "—", "04/02/1980"]);
  });

  it("leaves the date of birth to the form while none is on file", () => {
    const w = mount(ScreeningIdentityCard, {
      props: { driver: driver({ date_of_birth: null, cdl_state: "PA" }) },
      global: { plugins: [VueQueryPlugin] },
    });
    expect(w.findAll("dt").map((d) => d.text())).toEqual(["Licence number", "Licence state"]);
    expect(w.findAll("dd").map((d) => d.text())).toEqual(["PA334554", "PA"]);
  });
});
