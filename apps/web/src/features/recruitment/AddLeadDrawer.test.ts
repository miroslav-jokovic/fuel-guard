import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createPinia, setActivePinia } from "pinia";
import { useToastStore } from "@/stores/toast";
import AddLeadDrawer from "./AddLeadDrawer.vue";

/** Adding a lead by hand (E4b4) over a stubbed `apiFetch`: what is refused here, and what is sent. */
const api = vi.hoisted(() => ({
  writes: [] as Array<{ path: string; body: unknown }>,
  openings: null as unknown,
  write: null as unknown,
}));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
    if (init?.method !== "POST") return api.openings;
    api.writes.push({ path, body: init.body });
    return api.write;
  }),
}));

const SlideOverStub = { props: ["open"], template: "<div v-if='open'><slot /><footer><slot name='footer' /></footer></div>" };
const OPENINGS = [
  { id: "60000000-0000-4000-8000-000000000001", status: "open", current: { title: "Tanker driver" } },
  { id: "60000000-0000-4000-8000-000000000002", status: "closed", current: { title: "Old route" } },
  { id: "60000000-0000-4000-8000-000000000003", status: "open", current: null },
];

async function settle() {
  for (let i = 0; i < 5; i++) {
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
  }
}
async function render() {
  const w = mount(AddLeadDrawer, {
    props: { open: true },
    global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]], stubs: { SlideOver: SlideOverStub } },
  });
  await settle();
  return w;
}
const field = (w: Awaited<ReturnType<typeof render>>, test: string) => w.find(`[data-test="${test}"]`);
const submit = async (w: Awaited<ReturnType<typeof render>>) => {
  await field(w, "add-form").trigger("submit");
  await settle();
};
async function fill(w: Awaited<ReturnType<typeof render>>) {
  await field(w, "channel").setValue("walk_in");
  await field(w, "name").setValue("Ray Driver");
}

beforeEach(() => {
  setActivePinia(createPinia());
  api.writes = [];
  api.openings = { ok: true, data: { openings: OPENINGS } };
  api.write = { ok: true, data: { lead_id: "lead-new", stored: "new" } };
});

describe("adding a lead", () => {
  it("offers every manual channel, and only openings still open with a title", async () => {
    const w = await render();
    expect(field(w, "channel").findAll("option").map((o) => o.text())).toEqual(["Choose…", "Phone call", "Walk-in", "Referral", "Pasted post"]);
    expect(field(w, "opening").findAll("option").map((o) => o.text())).toEqual(["No opening", "Tanker driver"]);
  });

  it("sends what was typed, tells the page which lead it made", async () => {
    const w = await render();
    await fill(w);
    await field(w, "phone").setValue(" (708) 236-5732 ");
    await field(w, "opening").setValue(OPENINGS[0]!.id);
    await field(w, "note").setValue("Met at the yard");
    await submit(w);
    expect(api.writes).toEqual([{
      path: "/api/recruitment/leads",
      body: { channel: "walk_in", full_name: "Ray Driver", phone: "(708) 236-5732", email: null, opening_id: OPENINGS[0]!.id, note: "Met at the yard" },
    }]);
    expect(w.emitted("added")).toEqual([["lead-new"]]);
  });

  it("refuses with neither a phone nor an email, in the schema's words", async () => {
    const w = await render();
    await fill(w);
    await submit(w);
    expect(api.writes).toEqual([]);
    expect(w.text()).toContain("A phone number or an email is needed");
  });

  it("refuses a mistyped phone even beside a good email, which the api would store as nothing", async () => {
    const w = await render();
    await fill(w);
    await field(w, "phone").setValue("12");
    await field(w, "email").setValue("ray@example.com");
    await submit(w);
    expect(api.writes).toEqual([]);
    expect(w.text()).toContain("That phone number doesn't look right.");
  });

  it("names what is missing, and says nothing before the first try", async () => {
    const w = await render();
    expect(w.text()).not.toContain("Enter their name.");
    await submit(w);
    expect(w.text()).toContain("Choose how they came in.");
    expect(w.text()).toContain("Enter their name.");
  });

  it("a double press adds one lead", async () => {
    const w = await render();
    await fill(w);
    await field(w, "email").setValue("ray@example.com");
    const form = field(w, "add-form");
    await Promise.all([form.trigger("submit"), form.trigger("submit")]);
    await settle();
    expect(api.writes).toHaveLength(1);
  });

  it("a failed read of the openings does not stop the form", async () => {
    api.openings = { ok: false, error: { message: "boom" } };
    const w = await render();
    expect(w.text()).toContain("You can add the lead without one.");
    await fill(w);
    await field(w, "email").setValue("ray@example.com");
    await submit(w);
    expect(api.writes).toHaveLength(1);
  });

  it("a refusal stays on the form and says the api's sentence", async () => {
    api.write = { ok: false, error: { message: "Could not store this lead." } };
    const w = await render();
    await fill(w);
    await field(w, "email").setValue("ray@example.com");
    await submit(w);
    expect(w.emitted("added")).toBeUndefined();
    expect(useToastStore().toasts[0]!.message).toBe("Could not store this lead.");
  });
});
