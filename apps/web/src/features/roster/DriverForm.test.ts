import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import type { Driver } from "@silvicom/shared";
import DriverForm from "@/features/roster/DriverForm.vue";

/**
 * The claim warning (R6a, D-ROS4).
 *
 * On a row telematics owns — 282 of 287 live drivers when this was written — editing a name or a
 * phone claims the driver away from the sync PERMANENTLY, and editing the field back does not undo
 * it. That is the decision D-ROS1 is built on, so the person doing it has to be told BEFORE Save,
 * not in a toast afterwards.
 *
 * The warning has to be true of THIS edit, not of this driver: a permanent banner on every synced
 * row would be wallpaper, and wallpaper is what people stop reading.
 */
const driver = (over: Partial<Driver> = {}): Driver =>
  ({
    id: "d-1", org_id: "o", user_id: null, full_name: "Marcus Reyes", employee_id: "D-104",
    phone: "5558675309", status: "active", samsara_driver_id: "s-1", samsara_username: "marcus",
    current_hos_status: null, current_hos_vehicle: null, current_hos_at: null, current_location: null,
    app_username: null, app_access_enabled: null, created_at: "", updated_at: "", archived_at: null,
    identity_source: "samsara", ...over,
  }) as Driver;

const mountForm = (d: Driver | null) => mount(DriverForm, { props: { driver: d } });
const warning = (w: ReturnType<typeof mountForm>) =>
  w.findAll("p").find((p) => p.text().includes("claims"));

const typeInto = async (w: ReturnType<typeof mountForm>, index: number, value: string) => {
  await w.findAll("input")[index]!.setValue(value);
};

describe("DriverForm — the claim warning", () => {
  it("says nothing until something has actually changed", () => {
    expect(warning(mountForm(driver()))).toBeUndefined();
  });

  it("warns when an identity field changes on a telematics-owned row", async () => {
    const w = mountForm(driver());
    await typeInto(w, 0, "Marcus Reyez");
    expect(warning(w)?.text()).toContain("claims Marcus Reyes from the samsara sync");
    // …and says the part that matters: it does not undo.
    expect(warning(w)?.text()).toContain("does not undo");
  });

  it("does not warn for a field the sync does not own", async () => {
    // `employee_id` is the office's own; changing it claims nothing.
    const w = mountForm(driver());
    await typeInto(w, 1, "D-999");
    expect(warning(w)).toBeUndefined();
  });

  it("does not warn on a row the office already owns", async () => {
    const w = mountForm(driver({ identity_source: "manual" }));
    await typeInto(w, 0, "Marcus Reyez");
    expect(warning(w)).toBeUndefined();
  });

  it("does not warn when creating a driver, which claims nothing from anybody", async () => {
    const w = mountForm(null);
    await typeInto(w, 0, "New Person");
    expect(warning(w)).toBeUndefined();
  });

  it("goes away again if the edit is reverted before saving", async () => {
    const w = mountForm(driver());
    await typeInto(w, 0, "Marcus Reyez");
    expect(warning(w)).toBeDefined();
    await typeInto(w, 0, "Marcus Reyes");
    expect(warning(w)).toBeUndefined();
  });
});
