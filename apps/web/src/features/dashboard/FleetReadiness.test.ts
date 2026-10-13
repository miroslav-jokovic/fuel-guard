import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";

/**
 * F11 (US6b): the readiness checklist is a verdict over three reads. Before, a failed read was an
 * empty fleet, and an empty fleet was "0/0" with a green tick on every row — what a fleet with
 * nothing left to set up looks like.
 */
const reads = vi.hoisted(() => ({
  vehicles: [] as unknown[],
  drivers: [] as unknown[],
  vehiclesFail: false,
  refetchVehicles: vi.fn(),
  refetchDrivers: vi.fn(),
}));
const query = (data: unknown, fail: boolean, refetch: () => void) => ({
  data: ref(fail ? undefined : data),
  isLoading: ref(false),
  isError: ref(fail),
  isFetching: ref(false),
  refetch,
});
vi.mock("@/composables/useVehicles", () => ({
  useVehiclesQuery: () => query(reads.vehicles, reads.vehiclesFail, reads.refetchVehicles),
}));
vi.mock("@/composables/useDrivers", () => ({ useDriversQuery: () => query(reads.drivers, false, reads.refetchDrivers) }));
vi.mock("@/composables/useOrgSettings", () => ({
  useOrgSettingsQuery: () => query({ notification_emails: ["ops@x.test"], notifications_enabled: true }, false, vi.fn()),
}));
vi.mock("@/composables/useOpens", () => ({ useOpens: () => () => true }));

import FleetReadiness from "./FleetReadiness.vue";

const global = { stubs: { RouterLink: { props: ["to"], template: "<a><slot /></a>" } } };
const ready = { id: "v1", status: "active", tank_capacity_gal: 200, baseline_mpg: 6.5, samsara_vehicle_id: "s1", samsara_fuel_percent: 50 };

beforeEach(() => {
  Object.assign(reads, { vehicles: [], drivers: [], vehiclesFail: false });
  reads.refetchVehicles.mockClear();
  reads.refetchDrivers.mockClear();
});

describe("FleetReadiness", () => {
  it("says the readiness could not be loaded, and Retry asks only the read that failed", async () => {
    reads.vehiclesFail = true;
    const w = mount(FleetReadiness, { global });
    expect(w.text()).toContain("Could not load the fleet readiness.");
    expect(w.text()).not.toContain("All set");
    expect(w.text()).not.toContain("0/0");
    await w.findAll("button").find((b) => b.text() === "Retry")!.trigger("click");
    expect(reads.refetchVehicles).toHaveBeenCalledTimes(1);
    expect(reads.refetchDrivers).not.toHaveBeenCalled();
  });

  it("does not call an empty roster set up — a row with nothing to count reads None yet", () => {
    const w = mount(FleetReadiness, { global });
    expect(w.text()).not.toContain("All set");
    expect(w.text()).not.toContain("0/0");
    expect(w.text()).toContain("None yet");
  });

  it("says All set when every row is complete", () => {
    reads.vehicles = [ready];
    reads.drivers = [{ id: "d1", status: "active", samsara_driver_id: "sd1" }];
    expect(mount(FleetReadiness, { global }).text()).toContain("All set");
  });
});
