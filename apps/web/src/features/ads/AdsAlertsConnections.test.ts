import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import {
  ADS_SETTINGS_UNSET, type AdsConnectionReport, type AdsConnectionView, type AdsSettings, type AdsSettingsView, type OrgMember,
} from "@silvicom/shared";

/**
 * Settings › Ads control's alerts and ad accounts (E1b): who is offered which act, and that what is sent is
 * what the person did. The doors are the API's (routes/guard.ts, routes/connections.ts); these pin that the
 * page offers the same acts to the same people, and that a refusal's reasons reach the screen.
 */
const sent = vi.hoisted(() => ({ settings: [] as AdsSettings[], acts: [] as unknown[] }));
const who = vi.hoisted(() => ({ admin: false }));
const conn = vi.hoisted(() => ({ list: [] as unknown[] | undefined, refuse: null as null | { message: string; code: string; report?: unknown }, confirm: true }));
vi.mock("./useAdsSettings", () => ({
  useSaveAdsSettings: () => ({ isPending: ref(false), mutateAsync: async (s: AdsSettings) => (sent.settings.push(s), { version: 2 }) }),
}));
vi.mock("./useAdsConnections", () => ({
  useAdsConnections: () => ({ isLoading: ref(false), isFetching: ref(false), error: ref(conn.list ? null : new Error("down")), data: ref(conn.list), refetch: () => {} }),
  useConnectionAct: () => ({
    isPending: ref(false),
    mutateAsync: async (a: unknown) => {
      sent.acts.push(a);
      if (conn.refuse) throw Object.assign(new Error(conn.refuse.message), conn.refuse);
      return {};
    },
  }),
}));
vi.mock("@silvicom/ui", async (orig) => ({ ...(await orig<object>()), useConfirm: () => async () => conn.confirm }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ admin: who.admin, can: () => false }) }));

import AdsSettingsForm from "./AdsSettingsForm.vue";
import AdsConnectionsCard from "./AdsConnectionsCard.vue";

const ANA = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const BO = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const GONE = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const SUS = "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a";
const member = (userId: string, fullName: string, over: Partial<OrgMember> = {}): OrgMember =>
  ({ userId, fullName, email: null, role: "recruiter", joinedAt: "2026-01-01T00:00:00Z", suspendedAt: null, ...over }) as OrgMember;
const MEMBERS = [member(ANA, "Ana Admin", { role: "admin" }), member(BO, "Bo Recruiter"), member(SUS, "Sus Pended", { suspendedAt: "2026-10-01T00:00:00Z" })];

const view = (alerts: AdsSettings["alerts"] = ADS_SETTINGS_UNSET.alerts): AdsSettingsView => ({
  settings: { ...ADS_SETTINGS_UNSET, alerts }, version: 1, kill_switch: false, kill_reason: null, saved_at: "2026-11-04T12:00:00Z", saved_by_name: "Ana",
});
const form = (v: AdsSettingsView, members: OrgMember[] | null) => {
  setActivePinia(createPinia());
  return mount(AdsSettingsForm, { props: { view: v, members, membersFailed: false } });
};
const row = (w: ReturnType<typeof form>, category: string) => w.find(`[data-alert="${category}"]`);
const save = async (w: ReturnType<typeof form>) => {
  await w.find("form#ads-settings").trigger("submit");
  await flushPromises();
};

beforeEach(() => {
  sent.settings = [];
  sent.acts = [];
  who.admin = false;
  conn.list = [];
  conn.refuse = null;
  conn.confirm = true;
});

describe("Ads control — alerts", () => {
  it("an admin adds a person to one alert, and the save carries exactly that list", async () => {
    who.admin = true;
    const w = form(view(), MEMBERS);
    await row(w, "ads_overspend").find("select").setValue(BO);
    await save(w);
    expect(sent.settings.map((s) => s.alerts.recipients)).toEqual([{ ads_overspend: [BO] }]);
  });

  it("removing the last person leaves the alert out, so it goes to its default audience", async () => {
    who.admin = true;
    const w = form(view({ recipients: { lead_new: [BO] }, uncontacted_lead_minutes: 15 }), MEMBERS);
    await row(w, "lead_new").find('button[aria-label="Stop sending to Bo Recruiter"]').trigger("click");
    await save(w);
    expect(sent.settings[0]!.alerts.recipients).toEqual({});
  });

  it("says who hears an alert nobody was chosen for: recruiting for a call to make, the admins otherwise", () => {
    const w = form(view(), null);
    expect(row(w, "lead_new").text()).toContain("Goes to everyone who manages recruiting.");
    expect(row(w, "lead_uncontacted").text()).toContain("Goes to everyone who manages recruiting.");
    expect(row(w, "lead_intake_failing").text()).toContain("Goes to the admins.");
    expect(row(w, "ads_overspend").text()).toContain("Goes to the admins.");
  });

  it("someone who cannot read the people list sees how many were chosen, never who, and cannot add", () => {
    const w = form(view({ recipients: { ads_brief: [ANA, BO] }, uncontacted_lead_minutes: 15 }), null);
    expect(row(w, "ads_brief").text()).toContain("2 people chosen");
    expect(w.text()).not.toContain("Bo Recruiter");
    expect(w.findAll("select")).toHaveLength(0);
  });

  it("a suspended member is not offered, and a chosen id that left the company is named as such", () => {
    who.admin = true;
    const w = form(view({ recipients: { ads_rejected: [GONE] }, uncontacted_lead_minutes: 15 }), MEMBERS);
    expect(row(w, "ads_rejected").text()).toContain("Someone no longer in the company");
    expect(row(w, "ads_overspend").findAll("option").map((o) => o.text())).toEqual(["Add someone…", "Ana Admin", "Bo Recruiter"]);
  });

  it("minutes outside 5–1,440 are not sent, and the field says why", async () => {
    who.admin = true;
    const w = form(view(), MEMBERS);
    await w.find('input[max="1440"]').setValue("2");
    await save(w);
    expect(sent.settings).toEqual([]);
    expect(w.text()).toContain("The minutes must be a whole number from 5 to 1,440 (a day).");
  });
});

const REPORT: AdsConnectionReport = {
  ok: false, user: null, account: null, page: null, scopes_granted: [], scopes_extra: [], error_code: "spending_limit",
  checks: [
    { key: "token", ok: true, detail: "Accepted, for Silvicom system user." },
    { key: "spending_limit", ok: false, detail: "No spending limit is set on this ad account in Meta." },
    { key: "page", ok: null, detail: "Not checked: an earlier check failed." },
  ],
};
const connection = (over: Partial<AdsConnectionView> = {}): AdsConnectionView => ({
  id: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a", provider: "simulator", is_sandbox: true, account_ref: "000000001", page_ref: "000000002",
  token_expires_on: null, scopes: [], status: "connected", last_test_at: "2026-11-04T12:00:00Z", last_test: { ...REPORT, ok: true, checks: [REPORT.checks[0]!] },
  last_error: null, created_at: "2026-11-04T12:00:00Z", updated_at: "2026-11-04T12:00:00Z", ...over,
});
const card = () => {
  setActivePinia(createPinia());
  return mount(AdsConnectionsCard);
};
const button = (w: ReturnType<typeof card>, label: string) => w.findAll("button").find((b) => b.text() === label);

describe("Ads control — ad accounts", () => {
  it("someone who is not an admin reads the accounts and their last test, with no act offered", () => {
    conn.list = [connection()];
    const w = card();
    expect(w.text()).toContain("Every check passed");
    expect(w.text()).toContain("Only an admin can connect, test or disconnect one.");
    for (const label of ["Test", "Disconnect", "Connect the simulator", "Connect a Meta account"]) expect(button(w, label), label).toBeUndefined();
  });

  it("an admin tests a connection, and disconnects only after saying yes", async () => {
    who.admin = true;
    conn.list = [connection()];
    const w = card();
    await button(w, "Test")!.trigger("click");
    conn.confirm = false;
    await button(w, "Disconnect")!.trigger("click");
    await flushPromises();
    conn.confirm = true;
    await button(w, "Disconnect")!.trigger("click");
    await flushPromises();
    expect(sent.acts).toEqual([{ kind: "test", id: connection().id }, { kind: "disconnect", id: connection().id }]);
  });

  it("a failing account lists its checks, and says its failure once", () => {
    conn.list = [connection({ provider: "meta", status: "failing", last_test: REPORT, last_error: "spending_limit: No spending limit is set on this ad account in Meta." })];
    const text = card().text();
    expect(text.split("No spending limit is set on this ad account in Meta.")).toHaveLength(2);
    expect(text).toContain("Not checked: an earlier check failed.");
  });

  it("a failure the pause path met after a passing test is still shown", () => {
    conn.list = [connection({ status: "failing", last_error: "Meta refused the token (code 190)." })];
    expect(card().text()).toContain("Meta refused the token (code 190).");
  });

  it("while the list cannot be read, no connect is offered — an unknown list is not an empty one", () => {
    who.admin = true;
    conn.list = undefined;
    const w = card();
    expect(w.text()).toContain("Could not load the ad accounts.");
    for (const label of ["Connect the simulator", "Connect a Meta account"]) expect(button(w, label), label).toBeUndefined();
  });

  it("the simulator is offered only while none is connected", () => {
    who.admin = true;
    expect(button(card(), "Connect the simulator")).toBeDefined();
    conn.list = [connection()];
    expect(button(card(), "Connect the simulator")).toBeUndefined();
    conn.list = [connection({ status: "disconnected" })];
    expect(button(card(), "Connect the simulator")).toBeDefined();
  });

  it("a Meta connect the contract refuses is not sent, and says the contract's reason", async () => {
    who.admin = true;
    const w = card();
    await button(w, "Connect a Meta account")!.trigger("click");
    const inputs = w.find("form#ads-meta-connect").findAll("input");
    await inputs[0]!.setValue("EAAB".padEnd(40, "x"));
    await inputs[1]!.setValue("12");
    await inputs[2]!.setValue("1234567");
    await w.find("form#ads-meta-connect").trigger("submit");
    await flushPromises();
    expect(sent.acts).toEqual([]);
    expect(w.text()).toContain("An ad account id is digits, as Ads Manager shows it (act_ optional)");
  });

  it("a Meta connect is sent as typed, and a refusal shows which check failed", async () => {
    who.admin = true;
    conn.refuse = { message: "Meta does not accept this token. Nothing was saved.", code: "token_refused", report: REPORT };
    const w = card();
    await button(w, "Connect a Meta account")!.trigger("click");
    const inputs = w.find("form#ads-meta-connect").findAll("input");
    await inputs[0]!.setValue("EAAB".padEnd(40, "x"));
    await inputs[1]!.setValue("act_1234567");
    await inputs[2]!.setValue("7654321");
    await w.find("form#ads-meta-connect").trigger("submit");
    await flushPromises();
    expect(sent.acts).toEqual([{ kind: "meta", ask: { token: "EAAB".padEnd(40, "x"), account_id: "act_1234567", page_id: "7654321", sandbox: false } }]);
    const alert = w.find('[role="alert"]');
    expect(alert.text()).toContain("Meta does not accept this token. Nothing was saved.");
    expect(alert.text()).toContain("No spending limit is set on this ad account in Meta.");
  });
});
