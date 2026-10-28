import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { answerConfirm } from "@silvicom/ui/testing";
import { WRITE_CHECK_PLAIN_VERDICT, WRITE_CHECK_RECOMMENDATIONS } from "@silvicom/shared";

/**
 * The EFS integration and Card control pages speak to an office admin, not to the engineer who built
 * them (F02-F04 PLAN.md chunk 14a, AUDIT.md W2). Before it, the EFS page linked a file in this repo,
 * named two environment variables and a platform kill switch, and the Card control page asked for
 * "the QA endpoint", "a no-op change" and "a real setCardV2".
 *
 * Every state each page can be in is rendered, and every string a person can read — the page text,
 * the hints, the feed cards' descriptions, the confirmation dialog and the toasts — is held to one
 * list of words. Results the API writes (a probe's verdict and steps) are not the page's copy and
 * are not checked here.
 */
const ENGINEERING = [
  /docs\//, /_MINUTES/, /anomaly engine/i, /\bSOAP\b/, /WSDL/, /setCardV2/, /QA endpoint/i, /no-op/i,
  /\becho\b/i, /kill switch/i, /\benv\b/i, /\bpoll/i, /credentials/i, /roundtrip/i, /&amp;/,
];
const offenders = (text: string) => ENGINEERING.filter((re) => re.test(text)).map(String);

const toasts = vi.hoisted(() => [] as string[]);
vi.mock("@/stores/toast", () => {
  const push = (title: string, detail?: string) => void toasts.push(`${title} ${detail ?? ""}`);
  return { useToastStore: () => ({ success: push, error: push, info: push, warning: push }) };
});

const efs = vi.hoisted(() => ({ status: null as unknown, test: null as unknown, failed: false, refetch: vi.fn() }));
vi.mock("@/features/settings/useEfsSoap", async () => {
  const { ref } = await import("vue");
  const mutation = (run: () => unknown) => ({ isPending: ref(false), mutateAsync: vi.fn(async () => run()) });
  return {
    useEfsSoapStatus: () => ({
      data: ref(efs.status),
      isLoading: ref(false),
      isError: ref(efs.failed),
      error: ref(efs.failed ? new Error("502") : null),
      isFetching: ref(false),
      refetch: efs.refetch,
    }),
    useEnableEfsSoap: () => mutation(() => ({ enabled: true })),
    useDisableEfsSoap: () => mutation(() => ({ enabled: false })),
    useTestEfsSoapConnection: () => mutation(() => efs.test),
  };
});

const card = vi.hoisted(() => ({ settings: null as unknown, probe: null as unknown }));
vi.mock("@/features/fuelCards/useCardControlSettings", async () => {
  const { ref } = await import("vue");
  const mutation = () => ({ isPending: ref(false), mutateAsync: vi.fn(async () => ({})) });
  return {
    useCardControlSettings: () => ({ data: ref(card.settings) }),
    useUpdateCardControlSettings: mutation,
    useGrantCardApprover: mutation,
    useRevokeCardApprover: mutation,
  };
});
vi.mock("@/features/fuelCards/useCardControl", async () => {
  const { ref } = await import("vue");
  return {
    CardControlApiError: class extends Error { code = ""; },
    useCardControlProbe: () => ({ data: ref(card.probe), isPending: ref(false), mutateAsync: vi.fn() }),
  };
});

/** The feed card is stubbed to print what it is given: its description is this page's copy. */
const stubs = {
  JobActionCard: { props: ["title", "description", "actionLabel"], template: "<div>{{ title }} {{ description }} {{ actionLabel }}</div>" },
  EfsClientCertCard: true,
  CardApproverList: true,
  StepUpPrompt: true,
  PageHeader: { props: ["description"], template: "<header>{{ description }}<slot /></header>" },
};

/** Every attribute a reader can meet — hints and placeholders are rendered as attributes by some primitives. */
const readable = (w: ReturnType<typeof mount>) =>
  [w.text(), ...w.findAll("[hint],[placeholder],[title]").flatMap((e) => ["hint", "placeholder", "title"].map((a) => e.attributes(a) ?? ""))].join(" ");

const feed = { lastPolledAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString(), lastError: null, processingPending: 2, processingLastError: null };
const status = (configured: boolean, enabled: boolean) => ({
  configured, enabled, environment: "production", endpointUrl: "https://ws.efsllc.com/x", accountId: "123",
  posted: feed, rejected: { ...feed, lastPolledAt: null }, tls: null,
});

beforeEach(() => {
  toasts.length = 0;
  // The product's confirm (D-US7) is a Pinia store, so the pages need one to ask through.
  setActivePinia(createPinia());
});

describe("the EFS integration page reads as plain words (W2)", () => {
  for (const [name, s] of [["not set up", status(false, false)], ["saved but off", status(true, false)], ["collecting", status(true, true)]] as const) {
    it(`uses no engineering words when ${name}`, async () => {
      efs.status = s;
      const { default: Page } = await import("./EfsSoapPage.vue");
      const w = mount(Page, { global: { stubs } });
      await flushPromises();
      expect(w.text().length).toBeGreaterThan(100);
      expect(offenders(readable(w))).toEqual([]);
      w.unmount();
    });
  }

  // D-US5: before it, a failed read fell through to the setup form and said "not set up".
  it("says the configuration could not load, not that EFS is unset, and retries in place", async () => {
    efs.status = undefined;
    efs.failed = true;
    efs.refetch.mockReset();
    const { default: Page } = await import("./EfsSoapPage.vue");
    const w = mount(Page, { global: { stubs } });
    expect(w.text()).toContain("Could not load the EFS configuration.");
    expect(w.text()).not.toContain("Not configured");
    await w.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    expect(efs.refetch).toHaveBeenCalledTimes(1);
    efs.failed = false;
    w.unmount();
  });

  it("names both feeds by what they hold, and says which one is which", async () => {
    efs.status = status(true, true);
    const { default: Page } = await import("./EfsSoapPage.vue");
    const w = mount(Page, { global: { stubs } });
    expect(w.text()).toContain("Declined card attempts");
    expect(w.text()).toContain("Completed fuel purchases");
    expect(w.text()).toContain("Not checked yet.");
    w.unmount();
  });

  it("asks, and reports, in plain words when the admin tests and switches off", async () => {
    efs.status = status(true, true);
    const spy = answerConfirm(true);
    const { default: Page } = await import("./EfsSoapPage.vue");
    const w = mount(Page, { global: { stubs } });
    const button = (label: string) => w.findAll("button").find((b) => b.text().includes(label))!;

    efs.test = { kind: "not_implemented" };
    await button("Test now").trigger("click");
    await flushPromises();
    efs.test = { kind: "success", roundtripMs: 140 };
    await button("Test now").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("Connected. EFS answered in 140 ms.");
    await button("Switch off and delete password").trigger("click");
    await flushPromises();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: "Switch off", tone: "danger" }));
    const asked = spy.mock.calls.map(([q]) => `${q.title} ${q.message ?? ""} ${q.confirmLabel}`);
    expect(toasts.length).toBeGreaterThanOrEqual(2);
    expect(offenders([...asked, ...toasts, w.text()].join(" "))).toEqual([]);
    w.unmount();
  });
});

describe("the Card control page reads as plain words (W2)", () => {
  const settings = (writeEntitlement: string) => ({
    settings: { enabled: false, requireApprover: true, writeEntitlement, probeVerdict: null },
    approvers: [], eligible: [], eligibleRoles: ["admin", "fleet_manager"],
  });

  for (const e of ["unknown", "confirmed", "denied"]) {
    it(`uses no engineering words, and no raw code, when write access is "${e}"`, async () => {
      card.settings = settings(e);
      card.probe = null;
      const { default: Page } = await import("./CardControlSettingsPage.vue");
      const w = mount(Page, { global: { stubs } });
      await flushPromises();
      expect(offenders(readable(w))).toEqual([]);
      expect(w.text()).not.toMatch(/EFS write access: (unknown|denied)/);
      expect(w.text()).toContain("Run the read-only check");
      w.unmount();
    });
  }

  it("says what to type for a real change without naming the vendor's operation", async () => {
    card.settings = settings("unknown");
    const { default: Page } = await import("./CardControlSettingsPage.vue");
    const w = mount(Page, { global: { stubs } });
    const readOnly = w.findAll("input[type=checkbox]").at(-1)!;
    await readOnly.setValue(false);
    await flushPromises();
    expect(readable(w)).toContain("to send a real change to this card");
    expect(offenders(readable(w))).toEqual([]);
    w.unmount();
  });

  /**
   * CCF3 (D-CCF6, plan W4): the judge's verdict names file paths, "Phase B" and `readOnly=false`. The
   * page now LEADS with the plain sentence for its `recommendation` code and keeps the verdict, still
   * rendered and copyable, under "Technical details — for support".
   */
  for (const recommendation of WRITE_CHECK_RECOMMENDATIONS) {
    it(`leads with plain words for "${recommendation}" and keeps the engineering verdict under the support heading`, async () => {
      const verdict = "Capture the getCardv2 response as a fixture in apps/api/src/lib/__fixtures__/efs/. Phase B.";
      const base = settings("unknown");
      card.settings = { ...base, settings: { ...base.settings, probeVerdict: verdict, probeRecommendation: recommendation } };
      card.probe = {
        entitlement: "unknown", environment: "production", recommendation, verdict, steps: [], documentShape: null,
        changed: [], document: null, documentAfter: null, egressIp: null, persisted: true,
      };
      const { default: Page } = await import("./CardControlSettingsPage.vue");
      const w = mount(Page, { global: { stubs } });
      await flushPromises();
      const text = w.text();
      const support = text.indexOf("Technical details — for support");
      expect(support).toBeGreaterThan(-1);
      const plain = WRITE_CHECK_PLAIN_VERDICT[recommendation];
      // Twice above the heading — the "Last check" line and the result — and the record only below it.
      expect(text.slice(0, support).split(plain).length - 1).toBe(2);
      expect(text.slice(0, support)).not.toContain(verdict);
      expect(text.slice(support)).toContain(verdict);
      expect(offenders(text.slice(0, support))).toEqual([]);
      w.unmount();
    });
  }

  it("explains a check's result in plain words around the API's own text", async () => {
    card.settings = settings("unknown");
    card.probe = {
      entitlement: "unknown", environment: "qa", verdict: "", steps: [], documentShape: "nested:header",
      changed: [], document: null, documentAfter: null, egressIp: "203.0.113.9", persisted: true,
    };
    const { default: Page } = await import("./CardControlSettingsPage.vue");
    const w = mount(Page, { global: { stubs } });
    await flushPromises();
    expect(w.text()).toContain("EFS must have this address on its list of allowed addresses.");
    expect(w.text()).toContain("EFS write access: not checked yet");
    expect(offenders(readable(w))).toEqual([]);
    w.unmount();
  });
});
