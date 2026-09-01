import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import RequirementDrawer from "@/features/compliance/RequirementDrawer.vue";

/**
 * D7 — the §172.704(d) capture gap, closed and pinned. The provider ADDRESS and the training
 * MATERIALS are mandated on a training record and were capturable in no UI; this proves the drawer
 * now sends them (and notes) end-to-end in the recorded request body, not merely renders inputs.
 */
const calls: Array<{ path: string; init?: { body?: unknown } }> = [];
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init?: { body?: unknown }) => {
    calls.push({ path, init });
    return { ok: true, data: { id: "cert1", supersededId: null } };
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: () => ({}) } } }));

// The drawer's own surface is what we test; the SlideOver shell (teleporting dialog) is stubbed to
// render its slots inline.
const SlideOverStub = {
  template: "<div><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "description"],
};

function mountDrawer() {
  return mount(RequirementDrawer, {
    props: { open: true, driverId: "00000000-0000-4000-8000-0000000000d1", itemKey: "training_safety" },
    global: {
      plugins: [VueQueryPlugin],
      stubs: { SlideOver: SlideOverStub, teleport: true },
    },
  });
}

const setByPlaceholder = async (w: ReturnType<typeof mountDrawer>, ph: string, v: string) => {
  const el = w.find(`input[placeholder="${ph}"]`);
  expect(el.exists(), `input with placeholder "${ph}"`).toBe(true);
  await el.setValue(v);
};

describe("RequirementDrawer — §172.704(d) fields (D7)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    calls.length = 0;
  });

  it("records a hazmat training with provider address, materials and notes in the request body", async () => {
    const w = mountDrawer();

    await setByPlaceholder(w, "Who delivered it", "SafeHaul Training LLC");
    await setByPlaceholder(w, "Street, city, state", "12 Depot Rd, Joliet, IL");
    await setByPlaceholder(w, "Course name, manual, module…", "Function-specific module 3, 2026 manual");
    // Driven through the component rather than by typing into the input: the date field is a real
    // picker now (D-DS17), so its input holds a formatted `MM/dd/yyyy` display value while the wire
    // value stays ISO. What this test is about is the request BODY, so it sets the wire value.
    w.findComponent({ name: "AppDateField" }).vm.$emit("update:modelValue", "2026-01-15"); // Issued — satisfies `ready`
    await w.vm.$nextTick();
    const notes = w.findAll('input[placeholder="Optional"]').at(-1)!;
    await notes.setValue("Renewal due with the 2029 cycle");

    const save = w.findAll("button").find((b) => b.text().includes("Record it"))!;
    await save.trigger("click");
    await new Promise((r) => setTimeout(r));

    const cert = calls.find((c) => c.path === "/api/compliance/certifications");
    expect(cert, "certification create call").toBeDefined();
    expect(cert!.init?.body).toMatchObject({
      kind: "hazmat_training",
      trainingProviderName: "SafeHaul Training LLC",
      trainingProviderAddress: "12 Depot Rd, Joliet, IL",
      trainingMaterials: "Function-specific module 3, 2026 manual",
      notes: "Renewal due with the 2029 cycle",
      issuedAt: "2026-01-15",
    });
  });
});
