import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { useToastStore } from "@/stores/toast";

/**
 * Adding somebody to the inspector register (B3).
 *
 * This file exists because the feature shipped and the owner could not add an inspector. A form
 * whose submit path is never exercised is a form nobody has actually used.
 */

const create = vi.hoisted(() => ({
  mutateAsync: vi.fn(async (_input: Record<string, unknown>) => "i-1"),
  isPending: { value: false },
}));
vi.mock("@/features/maintenance/useAnnualInspections", () => ({ useCreateInspector: () => create }));

const InspectorDrawer = (await import("@/features/maintenance/InspectorDrawer.vue")).default;

/**
 * The drawer's own surface is what is under test; `SlideOver` is the shell and is stubbed to render
 * both slots inline. The `#footer` slot is rendered too, on purpose — the submit button LIVES there
 * now (contract §6.2), so a stub that dropped it would hide the control this file exists to exercise.
 */
const SlideOverStub = {
  template: "<div><slot /><slot name='footer' /></div>",
  props: ["open", "title", "size", "description"],
};

const drawer = () =>
  mount(InspectorDrawer, { props: { open: true }, global: { stubs: { SlideOver: SlideOverStub } } });

const submitButton = (w: ReturnType<typeof drawer>) =>
  w.findAll("button").find((b) => b.text() === "Add inspector")!;

beforeEach(() => {
  setActivePinia(createPinia());
  create.mutateAsync.mockClear();
});

describe("the submit path actually works", () => {
  it("is disabled until a name is typed, and typing enables it", async () => {
    const w = drawer();
    expect(submitButton(w).attributes("disabled")).toBeDefined();

    await w.findAll("input")[0]!.setValue("George Gacev");
    expect(submitButton(w).attributes("disabled")).toBeUndefined();
  });

  it("sends what the API asks for, with the fields it requires", async () => {
    const w = drawer();
    await w.findAll("input")[0]!.setValue("George Gacev");
    await w.find("form").trigger("submit");

    expect(create.mutateAsync).toHaveBeenCalledTimes(1);
    const sent = create.mutateAsync.mock.calls[0]![0];
    expect(sent).toMatchObject({
      fullName: "George Gacev",
      qualificationBasis: "training_and_experience",
      brakeQualified: true,
    });
    // The API requires a real date; an empty string would be a 400 the reader cannot act on.
    expect(sent.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("the footer's button submits the body's form, which is the only thing holding them together", async () => {
    // §6.2 splits them deliberately: the body scrolls and the footer does not, so the two are
    // associated by `form="inspector-form"` rather than by nesting. If that attribute is ever
    // dropped, the drawer still LOOKS right and the button stops working.
    const w = drawer();
    await w.findAll("input")[0]!.setValue("George Gacev");

    expect(submitButton(w).attributes("form")).toBe("inspector-form");
    expect(w.find("form").attributes("id")).toBe("inspector-form");
  });

  it("emits `created` so the page can close the drawer and refresh", async () => {
    const w = drawer();
    await w.findAll("input")[0]!.setValue("George Gacev");
    await w.find("form").trigger("submit");
    await new Promise((r) => setTimeout(r, 0));
    expect(w.emitted("created")).toBeTruthy();
  });

  it("shows the API's reason when it refuses, as a toast rather than an inline banner", async () => {
    // `apps/web/CLAUDE.md`: mutation feedback is a toast, never an inline banner. This drawer used
    // to render an `AppCallout` under the fields, which put the failure below the fold of a body
    // that scrolls — the reader pressed Add, nothing appeared to happen, and the reason was
    // off-screen.
    create.mutateAsync.mockRejectedValueOnce(new Error("That inspector already exists"));
    const w = drawer();
    await w.findAll("input")[0]!.setValue("George Gacev");
    await w.find("form").trigger("submit");
    await new Promise((r) => setTimeout(r, 0));

    expect(w.text()).not.toContain("That inspector already exists");
    const toasts = useToastStore().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.variant).toBe("error");
    expect(toasts[0]!.message).toBe("That inspector already exists");
    expect(w.emitted("created")).toBeFalsy();
  });
});
