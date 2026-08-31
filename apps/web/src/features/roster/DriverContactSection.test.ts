import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { DRIVER_INLINE_EDITABLE, type DriverDetail } from "@silvicom/shared";
import DriverContactSection from "@/features/roster/DriverContactSection.vue";

/**
 * The record page's in-place editor (D-ROS2, §6 Q4/Q8).
 *
 * What matters here is not that a form saves — it is WHICH fields it offers and WHAT it sends. The
 * list comes from `@silvicom/shared` so the roster drawer and this section cannot both claim a field,
 * and the patch carries only what changed so an audit row does not report six edits for one.
 */
const save = vi.hoisted(() => ({
  isPending: { value: false },
  mutateAsync: vi.fn(async () => ({ driver: {}, claimedFromTelematics: false, stampedTerminationDate: false })),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/composables/useDrivers", () => ({ useUpdateDriverProfile: () => save }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => toast }));

const driver = (over: Record<string, unknown> = {}) =>
  ({
    id: "d-1", full_name: "Marcus Reyes", phone_alt: "5550001111",
    emergency_contact_name: "Ana", emergency_contact_phone: "5552223333",
    emergency_contact_relation: "Sister", eld_id: "ELD-9", ...over,
  }) as unknown as DriverDetail;

const mountSection = (d: DriverDetail | null = driver()) =>
  mount(DriverContactSection, { props: { driver: d } });

describe("DriverContactSection", () => {
  it("offers exactly the shared list, so the two editing surfaces cannot drift", () => {
    const w = mountSection();
    expect(w.findAll("input")).toHaveLength(DRIVER_INLINE_EDITABLE.length);
  });

  it("offers no field the roster drawer owns", () => {
    // The drawer edits name, employee id, phone and status, and warns before it claims a row. A
    // second editor for any of them would be one with no warning.
    const labels = mountSection().text();
    for (const owned of ["Employee ID", "Full name", "Status"]) {
      expect(labels).not.toContain(owned);
    }
  });

  it("cannot be saved until something changes", async () => {
    const w = mountSection();
    const button = w.findAll("button").find((b) => b.text() === "Save")!;
    expect(button.attributes("disabled")).toBeDefined();

    await w.findAll("input")[0]!.setValue("5559998888");
    expect(w.findAll("button").find((b) => b.text() === "Save")!.attributes("disabled")).toBeUndefined();
  });

  it("sends only the field that changed, not the whole set", async () => {
    const w = mountSection();
    await w.findAll("input")[0]!.setValue("5559998888");
    await w.findAll("button").find((b) => b.text() === "Save")!.trigger("click");

    // Six fields in the form, one in the patch: an audit row saying "six fields changed" for a single
    // typed digit is how an audit log stops being read.
    expect(save.mutateAsync).toHaveBeenCalledWith({
      id: "d-1",
      input: { phone_alt: "5559998888" },
    });
  });

  it("clears a field to null rather than to an empty string", async () => {
    // `""` in a nullable text column is a value that reads as present and prints as nothing.
    save.mutateAsync.mockClear();
    const w = mountSection();
    await w.findAll("input")[0]!.setValue("");
    await w.findAll("button").find((b) => b.text() === "Save")!.trigger("click");
    expect(save.mutateAsync).toHaveBeenCalledWith({ id: "d-1", input: { phone_alt: null } });
  });
});
