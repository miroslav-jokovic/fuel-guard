import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const save = vi.hoisted(() => vi.fn());
vi.mock("./ssnApi", () => ({ saveApplicantSsn: save }));
const SsnField = (await import("./SsnField.vue")).default;
const { emptyDraft } = await import("./draft");
const { APPLY_COPY } = await import("./strings");
const copy = APPLY_COPY.identity;

/**
 * The SSN in the form (Q-AM3, 0589). Pinned: it is saved by its own request with the nine digits, the
 * page then holds only the last four (the typed digits are cleared), a malformed number is refused
 * before anything leaves the phone, and a number already on file is shown masked with a way to change it.
 */
const mountWith = (over: Partial<ReturnType<typeof emptyDraft>> = {}) => {
  const draft = { ...emptyDraft(), ...over };
  const w = mount(SsnField, { props: { token: "tok", id: "ssn", modelValue: draft, "onUpdate:modelValue": () => {} } });
  return { w, draft };
};
const press = (w: ReturnType<typeof mount>, label: string) => w.findAll("button").find((b) => b.text() === label)!.trigger("click");

describe("the SSN field", () => {
  beforeEach(() => save.mockReset());

  it("saves the nine digits on their own, then holds only the last four", async () => {
    save.mockResolvedValue({ ok: true, last4: "6789" });
    const { w, draft } = mountWith();
    await w.find("input").setValue("123-45-6789");
    await press(w, copy.ssnSave);
    await flushPromises();
    expect(save).toHaveBeenCalledWith("tok", "123456789");
    expect(draft.ssn).toBe("");
    expect(draft.ssn_on_file).toBe("6789");
    expect(w.text()).toContain(copy.ssnSaved("6789"));
    expect(w.text()).not.toContain("12345");
  });

  it("refuses a number that is not nine digits, and sends nothing", async () => {
    const { w } = mountWith();
    await w.find("input").setValue("12345");
    await press(w, copy.ssnSave);
    await flushPromises();
    expect(save).not.toHaveBeenCalled();
    expect(w.text()).toContain(copy.ssnInvalid);
  });

  it("says so when the save fails, and keeps what was typed", async () => {
    save.mockRejectedValueOnce(Object.assign(new Error("offline"), { code: "network" }));
    const { w, draft } = mountWith();
    await w.find("input").setValue("123456789");
    await press(w, copy.ssnSave);
    await flushPromises();
    expect(w.text()).toContain(copy.ssnFailed);
    expect(draft.ssn).toBe("123456789");
    expect(draft.ssn_on_file).toBe("");
  });

  it("shows a number on file masked, with a way to change it", async () => {
    const { w } = mountWith({ ssn_on_file: "4321" });
    expect(w.find("input").exists()).toBe(false);
    expect(w.text()).toContain("•••-••-4321");
    await press(w, copy.ssnChange);
    expect(w.find("input").exists()).toBe(true);
  });
});
