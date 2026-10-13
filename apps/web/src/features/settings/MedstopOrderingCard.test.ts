import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import type { MedstopConnectionStatus, MedstopOrderingInput } from "@silvicom/shared";

/**
 * Settings › Med-Stop › Ordering tests (UX3, 0468). Pinned: ordering cannot be switched on without the
 * office's e-mail and phone (the contact every order carries instead of the driver's), and the phone
 * is sent as the ten digits the database holds, whatever punctuation was typed.
 */
const sent = vi.hoisted(() => ({ inputs: [] as MedstopOrderingInput[] }));
vi.mock("@/features/settings/useMedstopConnection", () => ({
  useSaveMedstopOrdering: () => ({ isPending: ref(false), mutateAsync: async (i: MedstopOrderingInput) => void sent.inputs.push(i) }),
}));
import MedstopOrderingCard from "./MedstopOrderingCard.vue";

const status = (over: Partial<MedstopConnectionStatus> = {}): MedstopConnectionStatus => ({
  hasKey: true, enabled: true, schedulerOn: true, syncHours: 1, keyExpiresOn: null, lastSyncedAt: null, lastError: null,
  ordersEnabled: false, orderContactEmail: null, orderContactPhone: null, ...over,
});
const mountCard = (s: MedstopConnectionStatus) => {
  setActivePinia(createPinia());
  return mount(MedstopOrderingCard, { props: { status: s } });
};
const click = async (w: ReturnType<typeof mountCard>, label: string) => {
  await w.findAll("button").find((b) => b.text() === label)!.trigger("click");
  await flushPromises();
};

beforeEach(() => (sent.inputs = []));

describe("MedstopOrderingCard", () => {
  it("refuses to switch ordering on without the office contact", async () => {
    const w = mountCard(status());
    await click(w, "Switch ordering on");
    expect(sent.inputs).toEqual([]);
    expect(w.text()).toContain("Ordering needs the office's e-mail and phone");
  });

  it("switches on with the contact, the phone reduced to ten digits", async () => {
    const w = mountCard(status());
    await w.find('input[type="email"]').setValue("der@silvicom.test");
    await w.find('input[type="tel"]').setValue("+1 (312) 555-0100");
    await click(w, "Switch ordering on");
    expect(sent.inputs).toEqual([{ enabled: true, email: "der@silvicom.test", phone: "3125550100" }]);
  });

  it("switches off without asking for anything", async () => {
    const w = mountCard(status({ ordersEnabled: true, orderContactEmail: "der@silvicom.test", orderContactPhone: "3125550100" }));
    await click(w, "Switch ordering off");
    expect(sent.inputs).toEqual([{ enabled: false, email: "der@silvicom.test", phone: "3125550100" }]);
  });
});
