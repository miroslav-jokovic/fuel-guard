import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

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

const InspectorForm = (await import("@/features/maintenance/InspectorForm.vue")).default;

describe("the submit path actually works", () => {
  it("is disabled until a name is typed, and typing enables it", async () => {
    const w = mount(InspectorForm);
    const submit = () => w.findAll("button").find((b) => b.text() === "Add inspector")!;
    expect(submit().attributes("disabled")).toBeDefined();

    await w.findAll('input')[0]!.setValue("George Gacev");
    expect(submit().attributes("disabled")).toBeUndefined();
  });

  it("sends what the API asks for, with the fields it requires", async () => {
    const w = mount(InspectorForm);
    await w.findAll('input')[0]!.setValue("George Gacev");
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

  it("emits `created` so the page can close the drawer and refresh", async () => {
    const w = mount(InspectorForm);
    await w.findAll('input')[0]!.setValue("George Gacev");
    await w.find("form").trigger("submit");
    await new Promise((r) => setTimeout(r, 0));
    expect(w.emitted("created")).toBeTruthy();
  });

  it("shows the API's reason when it refuses, rather than failing silently", async () => {
    create.mutateAsync.mockRejectedValueOnce(new Error("That inspector already exists"));
    const w = mount(InspectorForm);
    await w.findAll('input')[0]!.setValue("George Gacev");
    await w.find("form").trigger("submit");
    await new Promise((r) => setTimeout(r, 0));
    expect(w.text()).toContain("That inspector already exists");
  });
});
