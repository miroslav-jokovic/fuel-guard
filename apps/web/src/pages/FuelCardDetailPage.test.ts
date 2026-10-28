import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";

/**
 * One card's facts (D-US6): what an operator asks before deciding anything, as a `FactList` — a label
 * beside each value, and a blank the list's em dash rather than a dash typed into the value. The card's
 * operations have their own suite (`features/fuelCards/cardOperations.test.ts`).
 */
const card = {
  id: "c-1", maskedRef: "••••7550", status: "ACTIVE", version: "v1",
  policyNumber: 2, unitPrompt: "654", driverIdPrompt: null, driverName: "Dana Reyes", companyXref: null,
  handEnter: "DISALLOW", payrollStatus: null, lastUsedDate: null, lastTransaction: null,
  syncedAt: new Date().toISOString(), detailSyncedAt: new Date().toISOString(),
  absentSince: null, syncError: null, syncErrorSource: null, syncErrorAt: null,
  overrideUses: null, overrideAllLocations: null, locationOverrideId: null,
};
const data = ref({ card, capabilities: null, effective: { infos: [] }, staleAfterMinutes: 60, detailStaleAfterMinutes: 1440 });

vi.mock("@/features/fuelCards/useEfsCards", () => ({
  useEfsCard: () => ({ data, isPending: ref(false), isError: ref(false), error: ref(null), isFetching: ref(false), refetch: vi.fn() }),
}));
vi.mock("@/features/fuelCards/useCardControl", () => ({ useRefreshCard: () => ({ mutate: vi.fn(), isPending: ref(false) }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ admin: true, can: () => true, canView: () => true }) }));
vi.mock("vue-router", async (orig) => ({
  ...((await orig()) as object),
  useRoute: () => ({ params: { id: "c-1" }, query: {}, meta: {} }),
  useRouter: () => ({ push: vi.fn() }),
}));

const Page = (await import("./FuelCardDetailPage.vue")).default;

describe("FuelCardDetailPage — the card's facts", () => {
  it("pairs each fact with its label, draws a dash for what EFS has not set, and says Never in words", async () => {
    const w = mount(Page, { global: { stubs: { PageHeader: true, CardEffectiveConfig: true, CardOperationDrawer: true } } });
    await flushPromises();
    const pairs = Object.fromEntries(w.get("dl").findAll("dl > div").map((d) => [d.get("dt").text(), d.get("dd").text()]));
    expect(pairs).toEqual({
      Policy: "2",
      Unit: "654",
      "Driver ID": "—",
      "Driver name": "Dana Reyes",
      "Company reference": "—",
      "Hand entry": "DISALLOW",
      "Payroll status": "—",
      "Last used": "Never",
      "Last authorization": "—",
    });
    // The blank is the list's own dash (tertiary, not a value in the value's ink).
    expect(w.get("dl").findAll("dd")[2]!.find("span.text-ink-tertiary").exists()).toBe(true);
  });
});

/**
 * CCF4 (D-CCF9, plan W5): a disabled card action said why only in a hover `title`, which a tablet
 * never shows. The reason is now printed inside the menu item.
 */
describe("FuelCardDetailPage — a disabled action says why on screen", () => {
  it("prints the reason under the menu label, with no hover title", async () => {
    const before = data.value.capabilities;
    data.value.capabilities = {
      canLock: true, canUnlock: true, canDeactivate: true, canOverride: true, canSetPrompts: true,
      writeEntitlement: "confirmed", blockedBy: null, environment: "production", editableInfoIds: [],
      scopes: ["lock", "unlock", "deactivate", "override", "prompts"],
      capabilityStates: { card_lock: null, card_unlock: null, card_deactivate: null, override_grant: "not_promoted", override_clear: null, prompts_set: null },
    } as never;
    const w = mount(Page, {
      global: { stubs: { PageHeader: true, CardEffectiveConfig: true, CardOperationDrawer: true, KebabMenu: { template: "<div><slot /></div>" } } },
    });
    await flushPromises();
    const grant = w.findAll("button").find((b) => b.text().startsWith("Grant exception…"))!;
    expect(grant.attributes("disabled")).toBeDefined();
    expect(grant.attributes("title")).toBeUndefined();
    expect(grant.text()).toContain("This action has not been approved for this company yet. Ask your Silvicom 360 administrator.");
    data.value.capabilities = before;
    w.unmount();
  });
});
