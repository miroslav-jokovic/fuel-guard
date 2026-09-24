import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { AppInput } from "@silvicom/ui";
import ApplicantIdentityCorrection from "@/features/recruitment/ApplicantIdentityCorrection.vue";

/**
 * The office's correction of an applicant's date of birth and licence (AF3, D-AF8).
 *
 * What it must do: show what is on file, let a manager of the recruitment section correct it through
 * the invitation's one writer, and show a reader the values and no button.
 */

const calls = vi.hoisted(() => ({ list: [] as Array<{ url: string; body: unknown }> }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (url: string, opts?: { method?: string; body?: unknown }) => {
    calls.list.push({ url, body: opts?.body });
    return { ok: true, data: { ok: true } };
  }),
}));

const role = vi.hoisted(() => ({ value: "recruiter" as string }));
vi.mock("@/stores/session", () => ({
  useSessionStore: () => ({
    get role() {
      return role.value;
    },
  }),
}));

const INVITATION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ON_FILE = { date_of_birth: "1980-04-02", cdl_number: "PA334554", cdl_state: "PA" };

const mountIt = (identity: typeof ON_FILE | null = ON_FILE) =>
  mount(ApplicantIdentityCorrection, {
    props: { invitationId: INVITATION, driverId: "driver-1", identity },
    global: { plugins: [VueQueryPlugin] },
  });

const button = (w: ReturnType<typeof mountIt>, label: string) =>
  w.findAll("button").find((b) => b.text() === label);

beforeEach(() => {
  setActivePinia(createPinia());
  calls.list.length = 0;
  role.value = "recruiter";
});

describe("the office's identity correction", () => {
  it("shows what is on file, the date as the product writes dates", () => {
    const text = mountIt().text();
    expect(text).toContain("04/02/1980");
    expect(text).toContain("PA334554");
  });

  it("posts the correction to this invitation's identity route, with the values the office typed", async () => {
    const w = mountIt();
    await button(w, "Correct")!.trigger("click");
    await w.findAllComponents(AppInput)[0]!.find("input").setValue("PA999000");
    await button(w, "Save")!.trigger("click");
    await flushPromises();

    expect(calls.list).toHaveLength(1);
    expect(calls.list[0]!.url).toBe(`/api/recruitment/applications/${INVITATION}/identity`);
    expect(calls.list[0]!.body).toEqual({ ...ON_FILE, cdl_number: "PA999000" });
  });

  it("sends nothing the schema would refuse", async () => {
    const w = mountIt();
    await button(w, "Correct")!.trigger("click");
    await w.findAllComponents(AppInput)[0]!.find("input").setValue("   ");
    await button(w, "Save")!.trigger("click");
    await flushPromises();
    expect(calls.list).toHaveLength(0);
  });

  /** ⚠ The route refuses a reader with a 403; the button is not offered to somebody it would refuse. */
  it("offers a reader the values and no way to change them", () => {
    role.value = "auditor";
    const w = mountIt();
    expect(w.text()).toContain("PA334554");
    expect(button(w, "Correct")).toBeUndefined();
  });

  it("says nothing is on file yet, rather than showing blanks", () => {
    expect(mountIt(null).text()).toContain("Not given yet");
  });
});
