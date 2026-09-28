import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { VueQueryPlugin } from "@tanstack/vue-query";
import PurgeApplicantDrawer from "@/features/recruitment/PurgeApplicantDrawer.vue";

/**
 * "Delete permanently…" (Q-AW40, P2). The api checks the name, the role, the password and 0380 checks
 * the rest; what only this drawer decides is that the button stays dead until the admin has typed
 * WHICH person, that a password refusal becomes the prompt and then the same delete, and that a
 * delete that left something behind does not read as a clean success.
 */

const calls: Array<{ path: string; body?: unknown }> = [];
const answers = vi.hoisted(() => ({ queue: [] as unknown[] }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init?: { body?: unknown }) => {
    calls.push({ path, body: init?.body });
    return answers.queue.shift();
  }),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => toasts }));

const SlideOverStub = { template: "<div><slot /><slot name='footer' /></div>", props: ["open", "title", "description"] };
const StepUpStub = { template: "<div data-test='step-up'>{{ reason }}</div>", props: ["reason"], emits: ["confirmed", "cancel"] };
const APPLICANT = { driver_id: "d1", full_name: "Ana Plicant" };
const OK = { ok: true, data: { counts: { drivers: 1 }, storageRemoved: 3, storageNotRemoved: [], audited: true } };

function mountDrawer() {
  return mount(PurgeApplicantDrawer, {
    props: { applicant: APPLICANT },
    global: { plugins: [VueQueryPlugin], stubs: { SlideOver: SlideOverStub, StepUpPrompt: StepUpStub } },
  });
}
const deleteButton = (w: ReturnType<typeof mountDrawer>) => w.findAll("button").find((b) => b.text().includes("Delete"))!;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  setActivePinia(createPinia());
  calls.length = 0;
  answers.queue = [];
  toasts.success.mockClear();
  toasts.error.mockClear();
});

describe("the name is typed before anything can be deleted", () => {
  it("keeps Delete disabled until the name matches, and enabled on a case-and-space variant", async () => {
    const w = mountDrawer();
    expect(deleteButton(w).attributes("disabled")).toBeDefined();
    await w.find("input").setValue("Ana");
    expect(deleteButton(w).attributes("disabled")).toBeDefined();
    await w.find("input").setValue(" ana  plicant ");
    expect(deleteButton(w).attributes("disabled")).toBeUndefined();
  });

  it("sends the typed name to the applicant's purge, and says it is done", async () => {
    answers.queue = [OK];
    const w = mountDrawer();
    await w.find("input").setValue("Ana Plicant");
    await deleteButton(w).trigger("click");
    await flush();
    expect(calls).toEqual([{ path: "/api/recruitment/applicants/d1/purge", body: { confirm_name: "Ana Plicant" } }]);
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(w.emitted("close")).toHaveLength(1);
  });
});

describe("what the api answers", () => {
  it("turns a step-up refusal into the password prompt, not an error", async () => {
    answers.queue = [{ ok: false, error: { code: "step_up_required", message: "Confirm your password to continue." } }];
    const w = mountDrawer();
    await w.find("input").setValue("Ana Plicant");
    await deleteButton(w).trigger("click");
    await flush();
    expect(w.find("[data-test='step-up']").exists()).toBe(true);
    expect(toasts.error).not.toHaveBeenCalled();
    expect(w.emitted("close")).toBeUndefined();
  });

  it("re-runs the same delete once the password is confirmed", async () => {
    answers.queue = [{ ok: false, error: { code: "step_up_required", message: "Confirm." } }, OK];
    const w = mountDrawer();
    await w.find("input").setValue("Ana Plicant");
    await deleteButton(w).trigger("click");
    await flush();
    w.findComponent(StepUpStub).vm.$emit("confirmed");
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toEqual({ confirm_name: "Ana Plicant" });
    expect(toasts.success).toHaveBeenCalledTimes(1);
  });

  it("shows 0380's own sentence when the person was hired, and stays open", async () => {
    answers.queue = [{ ok: false, error: { code: "was_hired", message: "This person was hired." } }];
    const w = mountDrawer();
    await w.find("input").setValue("Ana Plicant");
    await deleteButton(w).trigger("click");
    await flush();
    expect(toasts.error).toHaveBeenCalledWith("Could not delete", "This person was hired.");
    expect(w.emitted("close")).toBeUndefined();
  });

  it("does not call a delete that left a file behind, or no audit row, a clean success", async () => {
    for (const data of [
      { counts: {}, storageRemoved: 2, storageNotRemoved: ["x/y.jpg"], audited: true },
      { counts: {}, storageRemoved: 3, storageNotRemoved: [], audited: false },
    ]) {
      toasts.success.mockClear();
      toasts.error.mockClear();
      answers.queue = [{ ok: true, data }];
      const w = mountDrawer();
      await w.find("input").setValue("Ana Plicant");
      await deleteButton(w).trigger("click");
      await flush();
      expect(toasts.success).not.toHaveBeenCalled();
      expect(toasts.error.mock.calls[0]![0]).toBe("Deleted, with something left over");
    }
  });
});
