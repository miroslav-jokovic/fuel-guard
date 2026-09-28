import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { sectionAccess } from "@silvicom/shared";
import { useToastStore } from "@/stores/toast";
import SettingsRecruitingPage from "@/pages/SettingsRecruitingPage.vue";

/**
 * Settings → Recruiting (APPLICATION-FLOW-V2-PLAN.md R1, Q-AW42): the register of the people who sign
 * for the carrier. ⚠ Mocked at `apiFetch`, not at the hooks, so the URL and method each act sends are
 * asserted — the retire hook is new here and nothing else in the web calls it.
 */
const REP = "11111111-2222-4333-8444-555555555555";
const EXAMINER = "66666666-7777-4888-9999-000000000000";

const state = vi.hoisted(() => ({
  reps: [] as unknown[],
  examiners: [] as unknown[],
  calls: [] as Array<{ url: string; method: string; body: unknown }>,
  refuse: null as null | { code: string; message: string },
  /** The carrier's link settings as the api holds them (Q-AW41); null = never saved. */
  settings: null as null | { invite_ttl_days: number; reminders_enabled: boolean; reminder_after_hours: number },
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? "GET";
    if (method !== "GET") {
      state.calls.push({ url, method, body: opts?.body });
      if (state.refuse) return { ok: false, error: state.refuse };
      const person = { id: "new-1", full_name: "Ana Perić", title: "Safety manager", created_at: "2026-09-28T15:00:00Z" };
      if (url.endsWith("/representatives")) return { ok: true, data: { representative: person } };
      if (url.endsWith("/road-test-examiners")) return { ok: true, data: { examiner: person } };
      if (url.endsWith("/settings")) {
        state.settings = opts!.body as typeof state.settings;
        return { ok: true, data: { settings: state.settings, isDefault: false, updatedAt: "2026-09-28T16:00:00Z" } };
      }
      return { ok: true, data: {} };
    }
    if (url.endsWith("/representatives")) return { ok: true, data: { representatives: state.reps } };
    if (url.endsWith("/road-test-examiners")) return { ok: true, data: { examiners: state.examiners } };
    if (url.endsWith("/settings")) {
      return state.settings
        ? { ok: true, data: { settings: state.settings, isDefault: false, updatedAt: "2026-09-27T09:00:00Z" } }
        : { ok: true, data: { settings: { invite_ttl_days: 14, reminders_enabled: true, reminder_after_hours: 48 }, isDefault: true, updatedAt: null } };
    }
    throw new Error(`unexpected GET ${url}`);
  }),
}));

// The session, put in one role's shoes from the shared matrix (`FuelLogTabs.test.ts`'s idiom) — so
// "a recruiter may" is the matrix's answer, not this file's.
const session = vi.hoisted(() => ({ role: "recruiter" as string, can: (_s: string): boolean => false }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));
const asRole = (role: string): void => {
  session.role = role;
  session.can = (s: string) => sectionAccess(role as never, s as never) === "manage";
};

enableAutoUnmount(afterEach);

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
const page = async () => {
  const w = mount(SettingsRecruitingPage, { global: { plugins: [VueQueryPlugin], stubs: { PageHeader: true } } });
  await settle(w);
  return w;
};
const buttons = (w: ReturnType<typeof mount>, text: string) => w.findAll("button").filter((b) => b.text() === text);
const section = (w: ReturnType<typeof mount>, title: string) => {
  const found = w.findAll("section").find((s) => s.find("h2").text() === title);
  if (!found) throw new Error(`no section titled ${title}`);
  return found;
};

beforeEach(() => {
  setActivePinia(createPinia());
  asRole("recruiter");
  state.calls = [];
  state.refuse = null;
  state.settings = null;
  state.reps = [{ id: REP, full_name: "Miroslav Jokovic", title: "Owner", created_at: "2026-09-01T12:00:00Z" }];
  state.examiners = [{ id: EXAMINER, full_name: "Arvidera Gakhal", title: "Maintenance manager", created_at: "2026-09-02T12:00:00Z" }];
  vi.stubGlobal("confirm", () => true);
});
afterEach(() => vi.unstubAllGlobals());

describe("who may change the register", () => {
  it("lists both kinds and offers a recruiter every write — their section is `recruitment: manage`", async () => {
    const w = await page();
    expect(section(w, "Representatives").text()).toContain("Miroslav Jokovic");
    expect(section(w, "Road-test examiners").text()).toContain("Arvidera Gakhal");
    expect(buttons(w, "Remove")).toHaveLength(1);
    expect(buttons(w, "Retire")).toHaveLength(1);
    expect(buttons(w, "Add a representative")).toHaveLength(1);
    expect(buttons(w, "Add an examiner")).toHaveLength(1);
  });

  it("shows an auditor the lists and no act at all — `recruitment: view`", async () => {
    expect(sectionAccess("auditor", "recruitment")).toBe("view");
    asRole("auditor");
    const w = await page();
    expect(w.text()).toContain("Miroslav Jokovic");
    expect(w.text()).toContain("Arvidera Gakhal");
    expect(buttons(w, "Remove")).toHaveLength(0);
    expect(buttons(w, "Retire")).toHaveLength(0);
    expect(w.text()).not.toContain("Add a representative");
    expect(w.text()).not.toContain("Add an examiner");
  });

  it("opens the add form at once on an empty register, but only for a caller who may add", async () => {
    state.reps = [];
    state.examiners = [];
    const w = await page();
    expect(section(w, "Representatives").text()).toContain("Nobody signs for the carrier yet");
    expect(section(w, "Representatives").find("input").exists()).toBe(true);
    expect(section(w, "Road-test examiners").find("input").exists()).toBe(true);

    asRole("auditor");
    const ro = await page();
    expect(section(ro, "Representatives").find("input").exists()).toBe(false);
    expect(section(ro, "Road-test examiners").find("input").exists()).toBe(false);
    expect(section(ro, "Road-test examiners").text()).toContain("No examiner is on file yet");
  });
});

describe("taking somebody off", () => {
  it("removes a Representative by DELETE, after asking", async () => {
    const w = await page();
    await buttons(w, "Remove")[0]!.trigger("click");
    await settle(w);
    expect(state.calls).toEqual([{ url: `/api/recruitment/representatives/${REP}`, method: "DELETE", body: undefined }]);
  });

  it("retires an examiner through the retire route, never a DELETE", async () => {
    const w = await page();
    await buttons(w, "Retire")[0]!.trigger("click");
    await settle(w);
    expect(state.calls).toEqual([
      { url: `/api/recruitment/road-test-examiners/${EXAMINER}/retire`, method: "POST", body: {} },
    ]);
  });

  it("sends nothing when the question is declined", async () => {
    vi.stubGlobal("confirm", () => false);
    const w = await page();
    await buttons(w, "Remove")[0]!.trigger("click");
    await buttons(w, "Retire")[0]!.trigger("click");
    await settle(w);
    expect(state.calls).toEqual([]);
  });

  it("shows the server's own sentence when a Representative who has signed cannot be removed", async () => {
    state.refuse = { code: "has_signed", message: "This representative has signed a driver handbook, so they stay on file." };
    const w = await page();
    await buttons(w, "Remove")[0]!.trigger("click");
    await settle(w);
    const toasts = useToastStore().toasts;
    expect(toasts.map((t) => [t.variant, t.title, t.message])).toEqual([
      ["error", "Could not remove the representative", "This representative has signed a driver handbook, so they stay on file."],
    ]);
  });
});

describe("adding somebody", () => {
  const fill = async (w: ReturnType<typeof mount>, sectionTitle: string) => {
    const s = section(w, sectionTitle);
    const inputs = s.findAll("input:not([type=file])");
    await inputs[0]!.setValue("  Ana Perić ");
    await inputs[1]!.setValue("Safety manager");
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    s.findComponent({ name: "SignaturePad" }).vm.$emit("change", png);
    await settle(w);
    return s;
  };

  it("posts a Representative's name, title and signature as a PNG data URL", async () => {
    const w = await page();
    await buttons(w, "Add a representative")[0]!.trigger("click");
    await settle(w);
    const s = await fill(w, "Representatives");
    await s.findAll("button").find((b) => b.text() === "Add representative")!.trigger("click");
    await settle(w);
    expect(state.calls).toEqual([
      {
        url: "/api/recruitment/representatives",
        method: "POST",
        body: { full_name: "Ana Perić", title: "Safety manager", signature_png: "data:image/png;base64,iVBORw==" },
      },
    ]);
    // The form closes once the person is on file.
    expect(buttons(w, "Add representative")).toHaveLength(0);
  });

  it("posts an examiner to the examiners' route", async () => {
    const w = await page();
    await buttons(w, "Add an examiner")[0]!.trigger("click");
    await settle(w);
    const s = await fill(w, "Road-test examiners");
    await s.findAll("button").find((b) => b.text() === "Add examiner")!.trigger("click");
    await settle(w);
    expect(state.calls.map((c) => [c.url, c.method])).toEqual([["/api/recruitment/road-test-examiners", "POST"]]);
  });

  it("will not add anybody without a signature", async () => {
    const w = await page();
    await buttons(w, "Add a representative")[0]!.trigger("click");
    await settle(w);
    const s = section(w, "Representatives");
    const inputs = s.findAll("input:not([type=file])");
    await inputs[0]!.setValue("Ana Perić");
    await inputs[1]!.setValue("Safety manager");
    const submit = s.findAll("button").find((b) => b.text() === "Add representative")!;
    expect(submit.attributes("disabled")).toBeDefined();
  });
});

describe("the application links (Q-AW41)", () => {
  const links = (w: ReturnType<typeof mount>) => section(w, "Application links");
  const inputs = (w: ReturnType<typeof mount>) => links(w).findAll("input");
  const saveButton = (w: ReturnType<typeof mount>) => links(w).findAll("button").find((b) => b.text() === "Save");

  it("shows the product's defaults and says nobody has changed them", async () => {
    const w = await page();
    expect(links(w).text()).toContain("These are the product's defaults");
    expect((inputs(w)[0]!.element as HTMLInputElement).value).toBe("14");
    expect((inputs(w)[1]!.element as HTMLInputElement).value).toBe("48");
    // Nothing changed yet, so nothing to save.
    expect(saveButton(w)!.attributes("disabled")).toBeDefined();
  });

  it("saves the whole set as numbers", async () => {
    const w = await page();
    await inputs(w)[0]!.setValue("7");
    await inputs(w)[1]!.setValue("72");
    await saveButton(w)!.trigger("click");
    await settle(w);
    expect(state.calls).toEqual([
      { url: "/api/recruitment/settings", method: "PUT", body: { invite_ttl_days: 7, reminders_enabled: true, reminder_after_hours: 72 } },
    ]);
  });

  it("refuses, in the contract's words, a reminder that would come after the link dies", async () => {
    const w = await page();
    await inputs(w)[0]!.setValue("2");
    await settle(w);
    expect(links(w).text()).toContain("The reminder must go before the link expires");
    expect(saveButton(w)!.attributes("disabled")).toBeDefined();
  });

  it("switched off, hides the delay and saves it unchanged", async () => {
    const w = await page();
    links(w).findComponent({ name: "AppSwitch" }).vm.$emit("update:modelValue", false);
    await settle(w);
    expect(inputs(w)).toHaveLength(1);
    await inputs(w)[0]!.setValue("1");
    await saveButton(w)!.trigger("click");
    await settle(w);
    expect(state.calls.at(-1)!.body).toEqual({ invite_ttl_days: 1, reminders_enabled: false, reminder_after_hours: 48 });
  });

  it("refuses a link longer than 60 days", async () => {
    const w = await page();
    await inputs(w)[0]!.setValue("61");
    await settle(w);
    expect(links(w).text()).toContain("Between 1 and 60 days.");
    expect(saveButton(w)!.attributes("disabled")).toBeDefined();
  });

  it("shows an auditor the values and no Save", async () => {
    asRole("auditor");
    state.settings = { invite_ttl_days: 9, reminders_enabled: true, reminder_after_hours: 30 };
    const w = await page();
    expect(links(w).text()).toContain("Last changed");
    expect(inputs(w)[0]!.attributes("disabled")).toBeDefined();
    expect(saveButton(w)).toBeUndefined();
  });
});
