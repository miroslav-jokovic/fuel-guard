import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { RECRUITING_MESSAGE_KEYS, STANDARD_WORDING } from "@silvicom/shared";
import ApplicantMessagesSettings from "./ApplicantMessagesSettings.vue";

/**
 * Settings → Recruiting's "Messages" (HIRING-WORKFLOW-AUDIT §12 MT2): every catalogue message listed,
 * the editor's preview drawn by the sender's own renderer, each save asserted by the request it makes,
 * and the rules (placeholders, GSM-7) refusing the save before it is sent.
 */
const state = vi.hoisted(() => ({
  messages: [] as unknown[],
  requests: [] as Array<{ url: string; method: string; body: unknown }>,
  canManage: true,
}));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    const method = opts?.method ?? "GET";
    if (method === "PUT") {
      state.requests.push({ url, method, body: opts?.body });
      const key = url.split("/").at(-1);
      return { ok: true, data: { message: { key, wording: opts?.body, savedAt: "2026-11-03T10:00:00Z", savedByName: "Dana" } } };
    }
    if (url.endsWith("/messages")) return { ok: true, data: { messages: state.messages, carrier: "Acme Freight" } };
    if (url.endsWith("/settings")) {
      return { ok: true, data: { settings: { invite_ttl_days: 10 }, isDefault: false, updatedAt: null } };
    }
    return { ok: false, error: { message: `unexpected ${url}` } };
  }),
}));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ can: () => state.canManage }) }));

const settle = async (w: ReturnType<typeof mount>) => {
  for (let i = 0; i < 10; i++) {
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
  }
};
const standardList = () => RECRUITING_MESSAGE_KEYS.map((key) => ({ key, wording: STANDARD_WORDING, savedAt: null, savedByName: null }));
const mountIt = () => mount(ApplicantMessagesSettings, { global: { plugins: [VueQueryPlugin] } });
const open = async (w: ReturnType<typeof mount>, key: string) => {
  await w.find(`[data-testid="message-edit-${key}"]`).trigger("click");
  await settle(w);
};
const type = async (w: ReturnType<typeof mount>, part: string, value: string) => {
  const el = w.find(`[data-testid="part-${part}"]`);
  await (el.element.tagName === "TEXTAREA" || el.element.tagName === "INPUT" ? el : el.find("input, textarea")).setValue(value);
  await settle(w);
};

beforeEach(() => {
  setActivePinia(createPinia());
  state.messages = standardList();
  state.requests = [];
  state.canManage = true;
});

describe("the list", () => {
  it("lists every message in the catalogue, none marked as the carrier's while all are standard", async () => {
    const w = mountIt();
    await settle(w);
    for (const key of RECRUITING_MESSAGE_KEYS) expect(w.find(`[data-testid="message-${key}"]`).exists()).toBe(true);
    expect(w.text()).not.toContain("Your wording");
    expect(w.find('[data-testid="message-standard-invitation"]').exists()).toBe(false);
  });

  it("marks a saved wording, says who changed it, and saves four nulls on 'Use the standard wording'", async () => {
    state.messages = standardList().map((m) => (m.key === "reminder"
      ? { ...m, wording: { ...STANDARD_WORDING, textLead: "Come back:" }, savedAt: "2026-11-02T10:00:00Z", savedByName: "Lee" } : m));
    const w = mountIt();
    await settle(w);
    const row = w.find('[data-testid="message-reminder"]');
    expect(row.text()).toContain("Your wording");
    expect(row.text()).toContain("by Lee");
    await w.find('[data-testid="message-standard-reminder"]').trigger("click");
    await settle(w);
    expect(state.requests.at(-1)).toMatchObject({ url: "/api/recruitment/messages/reminder", method: "PUT", body: STANDARD_WORDING });
  });

  it("offers no edit to somebody who can only view recruiting", async () => {
    state.canManage = false;
    const w = mountIt();
    await settle(w);
    expect(w.find('[data-testid="message-edit-invitation"]').exists()).toBe(false);
  });
});

describe("the editor", () => {
  it("previews the standard words with the carrier's name and link lifetime, and the fixed pieces", async () => {
    const w = mountIt();
    await settle(w);
    await open(w, "invitation");
    expect(w.find('[data-testid="preview-subject"]').text()).toBe("Your driver application for Acme Freight");
    const email = w.find('[data-testid="preview-email"]').text();
    expect(email).toContain("stops working in 10 days");
    expect(email).toContain("/apply/sample-link");
    const text = w.find('[data-testid="preview-text"]').text();
    expect(text).toMatch(/^Acme Freight: You asked us to text you/);
    expect(text).toContain("STOP to opt out.");
  });

  it("previews the carrier's words as typed, placeholders filled, and saves exactly what was typed", async () => {
    const w = mountIt();
    await settle(w);
    await open(w, "application_ready");
    await type(w, "emailSubject", "{first_name}, it is ready");
    await type(w, "textLead", "Hi {first_name}, start here:");
    expect(w.find('[data-testid="preview-subject"]').text()).toBe("Pat, it is ready");
    expect(w.find('[data-testid="preview-text"]').text()).toContain("Acme Freight: Hi Pat, start here: ");
    await w.find('[data-testid="message-save"]').trigger("click");
    await settle(w);
    expect(state.requests.at(-1)).toMatchObject({
      url: "/api/recruitment/messages/application_ready",
      body: { emailSubject: "{first_name}, it is ready", emailHeading: null, emailParagraph: null, textLead: "Hi {first_name}, start here:" },
    });
  });

  it("refuses to save a placeholder the message does not have, or a curly quote in the text", async () => {
    const w = mountIt();
    await settle(w);
    await open(w, "reminder");
    await type(w, "emailParagraph", "You have {days} left");
    expect(w.find('[data-testid="message-editor-reminder"]').text()).toContain("{days} is not a placeholder");
    expect(w.find('[data-testid="message-save"]').attributes("disabled")).toBeDefined();
    await type(w, "emailParagraph", "");
    await type(w, "textLead", "It’s saved:");
    expect(w.find('[data-testid="message-save"]').attributes("disabled")).toBeDefined();
    await type(w, "textLead", "It's saved:");
    expect(w.find('[data-testid="message-save"]').attributes("disabled")).toBeUndefined();
    expect(state.requests).toHaveLength(0);
  });
});
