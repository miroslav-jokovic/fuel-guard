import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { ADS_SETTINGS_UNSET, type AdsSettings, type AdsSettingsView } from "@silvicom/shared";

/**
 * Settings › Ads control's two cards (E1a): who sees which act, and that what is sent is what the person
 * did. The doors are the API's (routes/guard.ts); these pin that the page offers the same acts to the same
 * people, so nobody is shown a button the API will refuse, and nobody who may act is left without one.
 */
const sent = vi.hoisted(() => ({ settings: [] as AdsSettings[], kill: [] as Array<{ on: boolean; reason: string }> }));
const who = vi.hoisted(() => ({ admin: false, manages: false }));
vi.mock("./useAdsSettings", () => ({
  useSaveAdsSettings: () => ({ isPending: ref(false), mutateAsync: async (s: AdsSettings) => (sent.settings.push(s), { version: 2 }) }),
  useSetKillSwitch: () => ({ isPending: ref(false), mutateAsync: async (k: { on: boolean; reason: string }) => void sent.kill.push(k) }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ admin: who.admin, can: () => who.manages }) }));

import AdsSettingsForm from "./AdsSettingsForm.vue";
import AdsKillSwitchCard from "./AdsKillSwitchCard.vue";

const view = (over: Partial<AdsSettingsView> = {}): AdsSettingsView => ({
  settings: ADS_SETTINGS_UNSET, version: null, kill_switch: false, kill_reason: null, saved_at: null, saved_by_name: null, ...over,
});
const mountIt = (c: typeof AdsSettingsForm | typeof AdsKillSwitchCard, v: AdsSettingsView) => {
  setActivePinia(createPinia());
  return mount(c, { props: { view: v } });
};
const button = (w: ReturnType<typeof mountIt>, label: string) => w.findAll("button").find((b) => b.text() === label);

beforeEach(() => {
  sent.settings = [];
  sent.kill = [];
  who.admin = false;
  who.manages = false;
});

describe("AdsSettingsForm", () => {
  it("says nothing is in force before the first save", () => {
    expect(mountIt(AdsSettingsForm, view()).text()).toContain("Nothing saved yet, so nothing can launch.");
  });

  it("a non-admin reads every field but cannot change or save one", () => {
    const w = mountIt(AdsSettingsForm, view());
    expect(w.findAll("input").every((i) => i.attributes("disabled") !== undefined)).toBe(true);
    expect(button(w, "Save as a new version")).toBeUndefined();
    expect(w.text()).toContain("Only an admin can change these.");
  });

  it("an admin saves what was typed, in cents, as a new version", async () => {
    who.admin = true;
    const w = mountIt(AdsSettingsForm, view());
    const caps = w.findAll('input[type="number"]');
    await caps[0]!.setValue("3000");
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(sent.settings).toHaveLength(1);
    expect(sent.settings[0]!.limits.monthly_cap_cents).toEqual({ meta: 300_000 });
  });

  it("an amount the contract refuses is not sent, and the field says why", async () => {
    who.admin = true;
    const w = mountIt(AdsSettingsForm, view());
    await w.findAll('input[type="number"]')[0]!.setValue("0");
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(sent.settings).toEqual([]);
    expect(w.text()).toContain("A monthly cap must be a dollar amount above zero.");
  });

  it("shows the benchmark beside the automatic pauses, with its source", () => {
    expect(mountIt(AdsSettingsForm, view()).text()).toContain("Suggested: $42 (Boostpoint 2026 benchmark, CDL drivers on Meta)");
  });
});

describe("AdsKillSwitchCard", () => {
  it("anyone who manages recruiting can press it, with a reason", async () => {
    who.manages = true;
    const w = mountIt(AdsKillSwitchCard, view());
    await w.find("input").setValue("Cost per lead doubled");
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(sent.kill).toEqual([{ on: true, reason: "Cost per lead doubled" }]);
  });

  it("a press with no reason is not sent", async () => {
    who.manages = true;
    const w = mountIt(AdsKillSwitchCard, view());
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(sent.kill).toEqual([]);
    expect(w.text()).toContain("Say why, so the next person knows.");
  });

  it("someone who only reads recruiting gets no button", () => {
    expect(button(mountIt(AdsKillSwitchCard, view()), "Stop all ads")).toBeUndefined();
  });

  it("once on, only an admin is offered Clear; a manager is told who can", async () => {
    who.manages = true;
    const on = view({ kill_switch: true, kill_reason: "owner pressed it" });
    const manager = mountIt(AdsKillSwitchCard, on);
    expect(manager.find("form").exists()).toBe(false);
    expect(manager.text()).toContain("Only an admin can clear it.");
    expect(manager.text()).toContain("Reason given: owner pressed it.");
    who.admin = true;
    const admin = mountIt(AdsKillSwitchCard, on);
    await admin.find("input").setValue("Spend checked");
    await admin.find("form").trigger("submit");
    await flushPromises();
    expect(sent.kill).toEqual([{ on: false, reason: "Spend checked" }]);
  });
});

describe("AdsSettingsForm — every switch says what it does", () => {
  // Found by the E1a browser pass: `AppSwitch`'s `label` is only its accessible name, so the agent and
  // pause switches first drew as an unlabelled row of toggles.
  it("each switch has its words beside it, on the page", () => {
    const w = mountIt(AdsSettingsForm, view());
    for (const words of ["Pause at the daily budget", "Pause when the opening is filled", "Writes the ad's words", "Checks the picture"]) {
      expect(w.findAll("p").some((p) => p.text() === words), words).toBe(true);
    }
  });
});
