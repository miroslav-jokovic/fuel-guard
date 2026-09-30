import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { REVIEW_SCREENS, USER_ROLE_LABELS, type AccessReviewState } from "@silvicom/shared";
import { AppBadge, AppCombobox } from "@silvicom/ui";
import { layerTag } from "./rows";
import WhoHasAccessTab from "./WhoHasAccessTab.vue";

/**
 * SP10 (Q-SET10) — the "Who has access" tab.
 *
 * The transport is mocked; the resolver is the real shared one, so these assertions fail when the
 * tab lists the wrong people, tags them with the wrong layer, or stops sending the export request.
 * The resolution rules themselves are pinned in `packages/shared/src/accessReview.test.ts`; what is
 * pinned here is that the tab SHOWS them: holders apart from non-holders, the layer tag on each, the
 * suspended apart from both, an empty list that says so, and an export that goes to the API.
 */
const state = vi.hoisted(() => ({ data: null as unknown, pending: false }));
const calls = vi.hoisted(() => ({ downloads: 0, fail: null as string | null, stepUp: false }));
const toasts = vi.hoisted(() => ({ success: [] as string[], error: [] as string[] }));

vi.mock("./useAccessReview", async () => {
  const { computed, ref } = await import("vue");
  return {
    useAccessReviewQuery: () => ({ data: computed(() => state.data), isPending: ref(state.pending) }),
    downloadAccessReview: vi.fn(async () => {
      calls.downloads++;
      if (calls.stepUp) {
        calls.stepUp = false;
        throw Object.assign(new Error("Confirm your password"), { code: "step_up_required" });
      }
      if (calls.fail) throw new Error(calls.fail);
    }),
  };
});
vi.mock("@/stores/toast", () => ({
  useToastStore: () => ({
    success: (t: string) => toasts.success.push(t),
    error: (t: string, m?: string) => toasts.error.push(`${t}: ${m}`),
  }),
}));

const member = (userId: string, fullName: string, role: string, extra: object = {}) => ({
  userId,
  email: `${userId}@carrier.test`,
  fullName,
  role,
  suspendedAt: null,
  ...extra,
});

const fixture = (): AccessReviewState => ({
  orgName: "Acme",
  members: [
    member("u-ann", "Ann", "fleet_manager"),
    member("u-dee", "Dee", "dispatcher"),
    member("u-ted", "Ted", "technician"),
    member("u-boss", "Boss", "admin"),
    member("u-sam", "Sam", "dispatcher", { suspendedAt: "2026-09-29T00:00:00Z" }),
  ] as AccessReviewState["members"],
  // The org opened Safety to dispatchers; Ted was given it personally.
  roleSections: { dispatcher: { safety: "view" } },
  userSections: { "u-ted": { safety: "view" } },
  roleSurfaces: {},
  userSurfaces: {},
  modules: [],
});

/**
 * The page's step-up hold (SP9), stubbed: it holds exactly a `step_up_required` refusal and remembers the
 * retry, which is the contract `useStepUpRetry` gives the Roles and People tabs.
 */
const held = { retry: null as null | (() => Promise<void>) };
const holdForStepUp = (e: unknown, retry: () => Promise<void>) => {
  if ((e as { code?: string })?.code !== "step_up_required") return false;
  held.retry = retry;
  return true;
};
const mountTab = () => mount(WhoHasAccessTab, { attachTo: document.body, props: { holdForStepUp } });

async function pick(w: ReturnType<typeof mountTab>, value: string) {
  w.findComponent(AppCombobox).vm.$emit("update:modelValue", value);
  await flushPromises();
}

/** Each table's rows as "Name|Answer|Tag", read from the rendered DOM. */
const tableRows = (w: ReturnType<typeof mountTab>, title: string) => {
  const card = w.find(`section[aria-label="${title}"]`);
  if (!card.exists()) return null;
  return card.findAll("tbody tr").map((tr) => {
    const cells = tr.findAll("td").map((td) => td.text());
    return `${cells[0]!.split("\n")[0]!.trim().replace(/u-\w+@carrier\.test$/, "").trim()}|${cells[2]}|${cells[3]}`;
  });
};

beforeEach(() => {
  calls.stepUp = false;
  held.retry = null;
  // jsdom has no `matchMedia`, so DataTable would draw its narrow card view; the rows read here are
  // the wide table's (see DataTable.test.ts for the same switch).
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  setActivePinia(createPinia());
  state.data = fixture();
  state.pending = false;
  calls.downloads = 0;
  calls.fail = null;
  toasts.success = [];
  toasts.error = [];
});

describe("Who has access", () => {
  it("asks for a pick first and offers every section and reviewed screen", async () => {
    const w = mountTab();
    expect(w.text()).toContain("Pick a screen or section");
    const labels = w.findComponent(AppCombobox).props("options").map((o: { label: string }) => o.label);
    expect(labels).toContain("Section · Safety");
    expect(labels).toContain("Screen · Settings › Card control");
    expect(labels).toHaveLength(12 + REVIEW_SCREENS.length);
  });

  it("lists the holders with the layer that gave each answer, and who does not have it", async () => {
    const w = mountTab();
    await pick(w, "section:safety");
    expect(w.find("h2").text()).toBe("Safety section");
    expect(w.text()).toContain("4 of 4 active members have access.");
    const holders = tableRows(w, "Has access")!;
    expect(holders).toContain("Ann|Manage|Default");
    expect(holders).toContain("Dee|View|Role");
    expect(holders).toContain("Ted|View|Personal");
    expect(holders).toContain("Boss|Manage|Fixed by role");
    expect(tableRows(w, "No access")).toEqual([]);
    expect(w.text()).toContain(USER_ROLE_LABELS.technician);
  });

  // The tag is the People tab's own marker, tone included: "Personal" there is brand and "Role" is
  // info, and the same member must not read differently on the two tabs.
  it("draws each layer with the People tab's own tag", async () => {
    const w = mountTab();
    await pick(w, "section:safety");
    const found = w.find('section[aria-label="Has access"]').findAllComponents(AppBadge) as unknown as Array<{
      text(): string;
      props(): Record<string, unknown>;
    }>;
    const badges = found.map((b) => [b.text(), b.props().tone]);
    expect(badges).toContainEqual([layerTag("user").label, layerTag("user").tone]);
    expect(badges).toContainEqual([layerTag("role").label, layerTag("role").tone]);
    expect(badges).toContainEqual([layerTag("default").label, layerTag("default").tone]);
    expect(badges).toContainEqual(["Fixed by role", "neutral"]);
  });

  it("keeps the suspended apart, never among the holders", async () => {
    const w = mountTab();
    await pick(w, "section:safety");
    expect(tableRows(w, "Has access")!.some((r) => r.startsWith("Sam"))).toBe(false);
    expect(tableRows(w, "Suspended")).toEqual(["Sam|View|Role"]);
  });

  it("names an admin-only screen as such, and says who has none of it", async () => {
    const w = mountTab();
    await pick(w, "screen:admin.settings.card-control");
    expect(w.text()).toContain("Admin only");
    expect(tableRows(w, "Has access")).toEqual(["Boss|Open|Admin only"]);
    expect(tableRows(w, "No access")).toHaveLength(3);
  });

  it("says so when nobody has it", async () => {
    state.data = { ...fixture(), members: [member("u-ted", "Ted", "technician")] as AccessReviewState["members"] };
    const w = mountTab();
    await pick(w, "section:accounting");
    expect(w.text()).toContain("0 of 1 active members have access.");
    expect(w.find('section[aria-label="Has access"]').text()).toContain("Nobody in this organisation has this.");
  });

  it("exports through the API and says the export was recorded", async () => {
    const w = mountTab();
    const button = w.findAll("button").find((b) => b.text() === "Export access review (CSV)")!;
    await button.trigger("click");
    await flushPromises();
    expect(calls.downloads).toBe(1);
    expect(toasts.success).toEqual(["Access review exported"]);
  });

  it("reports a refused export with the server's words", async () => {
    calls.fail = "Could not record the export, so it was not produced.";
    const w = mountTab();
    await w.findAll("button").find((b) => b.text() === "Export access review (CSV)")!.trigger("click");
    await flushPromises();
    expect(toasts.error[0]).toContain("Could not record the export");
  });

  it("holds a step-up refusal for the page's password prompt, then downloads on the retry (SP9)", async () => {
    calls.stepUp = true;
    const w = mountTab();
    await w.findAll("button").find((b) => b.text() === "Export access review (CSV)")!.trigger("click");
    await flushPromises();
    expect(held.retry).not.toBeNull();
    expect(toasts.error).toEqual([]);
    expect(toasts.success).toEqual([]);
    await held.retry!();
    await flushPromises();
    expect(calls.downloads).toBe(2);
    expect(toasts.success).toEqual(["Access review exported"]);
  });
});
