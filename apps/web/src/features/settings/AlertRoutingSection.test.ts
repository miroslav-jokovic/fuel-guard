import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { ALERT_CATALOGUE, ALERT_RELATION_LABELS, HOME_TIME_DEFAULTS, type AlertRoute, type AlertRoutingView, type MyAlerts } from "@silvicom/shared";

/**
 * Settings › Notifications' routing section and "My alerts" on screen (HOME-TIME-PLAN HT5): what a
 * save sends, what cannot be saved and why, that a failed read offers no editor (a replace-set saved
 * from an empty form would erase the carrier's routing), and what "My alerts" says.
 */
const state = vi.hoisted(() => ({
  routingFail: false,
  thresholdsFail: false,
  texts: false,
  contact: { available: true, state: "none", last4: null } as { available: boolean; state: string; last4: string | null },
  contactStep: vi.fn(),
  saveHours: vi.fn(),
  routes: null as null | Record<string, unknown[]>,
  mine: [] as unknown[],
  saveRoutes: vi.fn(),
  resetRoutes: vi.fn(),
  saveThresholds: vi.fn(),
  confirm: vi.fn(),
  refetch: vi.fn(),
}));

const MEMBERS = [
  { userId: "u-dana", name: "Dana Dispatch", role: "dispatcher", textReady: false },
  { userId: "u-fran", name: "Fran Fleet", role: "fleet_manager", textReady: true },
];
const view = (): AlertRoutingView => ({
  alerts: ALERT_CATALOGUE.map((a) => ({
    key: a.key,
    label: a.label,
    description: a.description,
    relations: a.relations.map((key) => ({ key, label: ALERT_RELATION_LABELS[key] })),
    roles: [
      { key: "fleet_manager", label: "Fleet manager" },
      { key: "dispatcher", label: "Dispatcher" },
    ],
    routes: ((state.routes?.[a.key] as AlertRoute[] | undefined) ?? [...a.defaults]) as AlertRoute[],
    usesDefaults: !state.routes?.[a.key],
  })),
  members: MEMBERS,
  texts: { available: state.texts, quiet: { startMin: 1260, endMin: 420 } },
});
const query = <T,>(fail: boolean, data: T) => ({ data: ref(fail ? undefined : data), isLoading: ref(false), isError: ref(fail), error: ref(fail ? new Error("502") : null), isFetching: ref(false), refetch: state.refetch });
const mutation = (fn: (v: unknown) => unknown) => () => ({ mutateAsync: fn, isPending: ref(false) });

vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@silvicom/ui", async (original) => ({ ...(await original<typeof import("@silvicom/ui")>()), useConfirm: () => state.confirm }));
vi.mock("./useAlertRouting", () => ({
  useAlertRouting: () => query(state.routingFail, view()),
  useHomeTimeThresholds: () => query(state.thresholdsFail, { ...HOME_TIME_DEFAULTS }),
  useSaveAlertRoutes: mutation((v) => state.saveRoutes(v)),
  useResetAlertRoutes: mutation((v) => state.resetRoutes(v)),
  useSaveHomeTimeThresholds: mutation((v) => state.saveThresholds(v)),
  useMyAlerts: () => query(false, { alerts: state.mine } as MyAlerts),
  useSaveAlertTextHours: mutation((v) => state.saveHours(v)),
  useMyAlertContact: () => query(false, state.contact),
  useStartAlertPhone: mutation((v) => state.contactStep("start", v)),
  useConfirmAlertPhone: mutation((v) => state.contactStep("confirm", v)),
  useStopAlertTexts: mutation(() => state.contactStep("stop")),
}));

async function mountSection() {
  const w = mount((await import("./AlertRoutingSection.vue")).default, { attachTo: document.body });
  await flushPromises();
  return w;
}
const card = (w: VueWrapper, alert = "home_time_overdue") => w.find(`[data-testid="alert-routes-${alert}"]`);
const button = (w: { findAll: VueWrapper["findAll"] }, label: string) => w.findAll("button").find((b) => b.text().trim() === label);
const toggle = (w: { find: VueWrapper["find"] }, label: string) => w.find(`[role="switch"][aria-label="${label}"]`);
const FM = "Everyone with the role Fleet manager";
const DISP = "Everyone with the role Dispatcher";

beforeEach(() => {
  setActivePinia(createPinia());
  Object.assign(state, { routingFail: false, thresholdsFail: false, routes: null, mine: [], texts: false, contact: { available: true, state: "none", last4: null } });
  for (const f of [state.saveRoutes, state.resetRoutes, state.saveThresholds, state.confirm, state.refetch, state.contactStep, state.saveHours]) f.mockReset();
  document.body.innerHTML = "";
});

describe("who is told", () => {
  it("shows every alert of the catalogue on its defaults, with Save off until something moves", async () => {
    const w = await mountSection();
    for (const a of ALERT_CATALOGUE) expect(card(w, a.key).text(), a.key).toContain(a.label);
    const c = card(w);
    expect(c.text()).toContain("On the defaults");
    expect(toggle(c, `${FM}: email`).attributes("aria-checked")).toBe("true");
    expect(toggle(c, `${DISP}: dashboard`).attributes("aria-checked")).toBe("false");
    expect(c.text()).toContain("1 person today");
    expect(button(c, "Save")!.attributes("disabled")).toBeDefined();
    expect(button(c, "Use the defaults")).toBeUndefined();
  });

  it("saves the alert's whole set in one request, with the switch that moved", async () => {
    const w = await mountSection();
    const c = card(w);
    await toggle(c, `${DISP}: dashboard`).trigger("click");
    await button(c, "Save")!.trigger("click");
    await flushPromises();
    expect(state.saveRoutes).toHaveBeenCalledTimes(1);
    const sent = state.saveRoutes.mock.calls[0]![0] as { alert: string; routes: AlertRoute[] };
    expect(sent.alert).toBe("home_time_overdue");
    expect(sent.routes).toContainEqual({ recipientKind: "role", recipientKey: "dispatcher", channel: "bell", enabled: true });
    expect(sent.routes).toContainEqual({ recipientKind: "role", recipientKey: "fleet_manager", channel: "email", enabled: true });
    // Every row, both channels: 2 relations + 2 roles.
    expect(sent.routes).toHaveLength(8);
  });

  it("will not save an alert sent to nobody, and says why", async () => {
    const w = await mountSection();
    const c = card(w, "home_time_return_due");
    await toggle(c, `${ALERT_RELATION_LABELS.marked_by}: dashboard`).trigger("click");
    await toggle(c, `${ALERT_RELATION_LABELS.truck_dispatcher}: dashboard`).trigger("click");
    expect(c.find('[role="alert"]').text()).toMatch(/cannot be sent to nobody/);
    expect(button(c, "Save")!.attributes("disabled")).toBeDefined();
    await button(c, "Undo changes")!.trigger("click");
    expect(c.find('[role="alert"]').exists()).toBe(false);
    expect(toggle(c, `${ALERT_RELATION_LABELS.marked_by}: dashboard`).attributes("aria-checked")).toBe("true");
  });

  it("adds a person on what their role already gives them, and takes them off again", async () => {
    const w = await mountSection();
    const c = card(w);
    await c.find('select[aria-label="Add a person to Home time overstayed"]').setValue("u-fran");
    expect(toggle(c, "Fran Fleet: email").attributes("aria-checked")).toBe("true");
    await toggle(c, "Fran Fleet: email").trigger("click");
    await button(c, "Save")!.trigger("click");
    expect((state.saveRoutes.mock.calls[0]![0] as { routes: AlertRoute[] }).routes).toContainEqual({ recipientKind: "user", recipientKey: "u-fran", channel: "email", enabled: false });
    await c.find('button[aria-label="Take Fran Fleet off this alert\'s list"]').trigger("click");
    expect(toggle(c, "Fran Fleet: email").exists()).toBe(false);
  });

  it("goes back to the defaults only after the question is answered yes", async () => {
    state.routes = { home_time_overdue: [{ recipientKind: "role", recipientKey: "dispatcher", channel: "bell", enabled: true }] };
    const w = await mountSection();
    const c = card(w);
    expect(c.text()).not.toContain("On the defaults");
    state.confirm.mockResolvedValueOnce(false);
    await button(c, "Use the defaults")!.trigger("click");
    await flushPromises();
    expect(state.resetRoutes).not.toHaveBeenCalled();
    state.confirm.mockResolvedValueOnce(true);
    await button(c, "Use the defaults")!.trigger("click");
    await flushPromises();
    expect(state.resetRoutes).toHaveBeenCalledWith({ alert: "home_time_overdue" });
  });

  it("offers no editor when the read failed, and Retry asks again", async () => {
    state.routingFail = true;
    const w = await mountSection();
    expect(w.text()).toContain("Could not load who is told.");
    expect(card(w).exists()).toBe(false);
    await button(w, "Retry")!.trigger("click");
    expect(state.refetch).toHaveBeenCalled();
  });
});

describe("when they are sent", () => {
  const input = (w: VueWrapper, n: number) => w.find('[data-testid="home-time-thresholds"]').findAll("input")[n]!;

  it("shows the carrier's numbers and saves all three as numbers", async () => {
    const w = await mountSection();
    expect(input(w, 0).element.value).toBe(String(HOME_TIME_DEFAULTS.returnDueHours));
    expect(button(w, "Save alert times")!.attributes("disabled")).toBeDefined();
    await input(w, 0).setValue("48");
    await w.find('[data-testid="home-time-thresholds"]').trigger("submit");
    expect(state.saveThresholds).toHaveBeenCalledWith({ ...HOME_TIME_DEFAULTS, returnDueHours: 48 });
  });

  it.each(["0", "169", "2.5", "", "abc"])("refuses %j as the warning hours, with the range, and sends nothing", async (bad) => {
    const w = await mountSection();
    await input(w, 0).setValue(bad);
    expect(w.find('[data-testid="home-time-thresholds"]').text()).toContain("A whole number, 1 to 168.");
    expect(button(w, "Save alert times")!.attributes("disabled")).toBeDefined();
    await w.find('[data-testid="home-time-thresholds"]').trigger("submit");
    expect(state.saveThresholds).not.toHaveBeenCalled();
  });

  it("offers no form on numbers it could not read", async () => {
    state.thresholdsFail = true;
    const w = await mountSection();
    expect(w.text()).toContain("Could not load the alert times.");
    expect(w.find('[data-testid="home-time-thresholds"]').exists()).toBe(false);
  });
});

describe("My alerts", () => {
  async function openPanel() {
    const { useMyAlertsPanel } = await import("./useMyAlertsPanel");
    useMyAlertsPanel().show();
    const w = mount((await import("./MyAlertsPanel.vue")).default, { attachTo: document.body });
    await flushPromises();
    return w;
  }

  it("says how each alert reaches the person, and that one does not", async () => {
    state.mine = [
      { key: "home_time_overdue", label: "Home time overstayed", description: "d", always: ["bell", "email"], whenMine: [] },
      { key: "home_time_return_due", label: "Home time ending", description: "d", always: [], whenMine: [] },
    ];
    await openPanel();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Always, on the dashboard and by email.");
    expect(text).toContain("You are not told about this one.");
  });

  it("says so when no routed alert is about a page the person can open", async () => {
    await openPanel();
    expect(document.body.querySelector('[data-testid="my-alerts-empty"]')).not.toBeNull();
  });
});

describe("texts (HT6)", () => {
  it("shows no Text column and no quiet hours on a server that cannot text", async () => {
    const w = await mountSection();
    expect(toggle(card(w), `${FM}: text`).exists()).toBe(false);
    expect(w.find('[data-testid="alert-text-hours"]').exists()).toBe(false);
  });

  it("with texting on: a Text switch per recipient, saved with the rest, saying how many of the role confirmed a number", async () => {
    state.texts = true;
    const w = await mountSection();
    const c = card(w);
    expect(c.text()).not.toContain("1 of 1 confirmed");
    await toggle(c, `${FM}: text`).trigger("click");
    expect(c.text()).toContain("1 of 1 confirmed");
    await button(c, "Save")!.trigger("click");
    const sent = state.saveRoutes.mock.calls[0]![0] as { routes: AlertRoute[] };
    expect(sent.routes).toContainEqual({ recipientKind: "role", recipientKey: "fleet_manager", channel: "sms", enabled: true });
    // 4 rows × 3 channels.
    expect(sent.routes).toHaveLength(12);
  });

  it("saves the quiet hours as minutes of the day, says the window in words, and refuses equal ends", async () => {
    state.texts = true;
    const w = await mountSection();
    const form = w.find('[data-testid="alert-text-hours"]');
    expect(form.text()).toContain("A text due between 9:00 PM and 7:00 AM is sent at 7:00 AM.");
    const [from, until] = form.findAll("input");
    await from!.setValue("22:00");
    await form.trigger("submit");
    expect(state.saveHours).toHaveBeenCalledWith({ startMin: 1320, endMin: 420 });
    await until!.setValue("22:00");
    expect(form.find('[role="alert"]').text()).toBe("Choose two different times.");
    await form.trigger("submit");
    expect(state.saveHours).toHaveBeenCalledTimes(1);
  });
});

describe("Text alerts under My alerts (D-HT17)", () => {
  async function mountTexts() {
    const { useMyAlertsPanel } = await import("./useMyAlertsPanel");
    useMyAlertsPanel().show();
    const w = mount((await import("./MyTextAlerts.vue")).default, { attachTo: document.body });
    await flushPromises();
    return w;
  }

  it("will not ask for a code without a real number AND the agreement, whose words are on the page", async () => {
    const w = await mountTexts();
    expect(w.text()).toContain("Reply STOP to end, HELP for help.");
    const send = () => button(w, "Text me a code")!;
    expect(send().attributes("disabled")).toBeDefined();
    await w.find('input[type="tel"]').setValue("708 555 0100");
    expect(send().attributes("disabled")).toBeDefined();
    await w.find('input[type="checkbox"]').setValue(true);
    expect(send().attributes("disabled")).toBeUndefined();
    await w.find('input[type="tel"]').setValue("555");
    expect(send().attributes("disabled")).toBeDefined();
    await w.find('input[type="tel"]').setValue("708 555 0100");
    await w.find("form").trigger("submit");
    expect(state.contactStep).toHaveBeenCalledWith("start", { phone: "708 555 0100" });
  });

  it("asks for the code once one is out, sends six digits only, and shows the server's refusal beside it", async () => {
    state.contact = { available: true, state: "pending", last4: "0100" };
    state.contactStep.mockRejectedValueOnce(new Error("That is not the code. 4 tries left."));
    const w = await mountTexts();
    expect(w.text()).toContain("number ending in 0100");
    await w.find('input[autocomplete="one-time-code"]').setValue("12345");
    expect(button(w, "Confirm")!.attributes("disabled")).toBeDefined();
    await w.find('input[autocomplete="one-time-code"]').setValue("123456");
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(state.contactStep).toHaveBeenCalledWith("confirm", { code: "123456" });
    expect(w.find('[role="alert"]').text()).toBe("That is not the code. 4 tries left.");
  });

  it("when on: says where texts go and offers to stop them", async () => {
    state.contact = { available: true, state: "verified", last4: "0100" };
    const w = await mountTexts();
    expect(w.text()).toContain("number ending in 0100");
    await button(w, "Stop text alerts")!.trigger("click");
    expect(state.contactStep).toHaveBeenCalledWith("stop");
  });

  it("when stopped: says so, names START, and leads back to confirming a number", async () => {
    state.contact = { available: true, state: "stopped", last4: "0100" };
    const w = await mountTexts();
    expect(w.text()).toContain("text START");
    await button(w, "Confirm a number")!.trigger("click");
    expect(w.find('input[type="tel"]').exists()).toBe(true);
  });

  it("offers nothing on a server that cannot text", async () => {
    state.contact = { available: false, state: "none", last4: null };
    const w = await mountTexts();
    expect(w.text()).toContain("Text alerts are not set up yet.");
    expect(w.find("form").exists()).toBe(false);
  });
});
