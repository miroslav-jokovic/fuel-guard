import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref, type Ref } from "vue";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import type { LiveMapVehicle, VehicleMapState } from "@silvicom/shared";

/**
 * D-LM31 — when the card asks the API which truck place a truck is at. Every request here is a HERE
 * Browse call on the server the first time a fix is seen, so what is pinned is when it is NOT asked:
 * a moving truck, an offline one, and the 5-second board poll repeating a parked truck's fix.
 */
const calls: string[] = [];
const reply = vi.fn();
vi.mock("@/lib/api", () => ({
  apiFetch: async (url: string) => {
    calls.push(url);
    return reply(url);
  },
}));

const { useVehiclePlace } = await import("./useVehiclePlace");

const TRUCK = "11111111-2222-4333-8444-000000000001";
const truck = (state: VehicleMapState, lat = 41.4808, lng = -88.0801, id = TRUCK): LiveMapVehicle =>
  ({ vehicleId: id, state, position: { lat, lng } }) as unknown as LiveMapVehicle;
const PILOT = { name: "Pilot", kind: "truck_stop" as const, distanceMeters: 72 };

let mounted: VueWrapper | null = null;
function probe(vehicle: Ref<LiveMapVehicle | null>) {
  let result!: ReturnType<typeof useVehiclePlace>;
  const C = defineComponent({ setup: () => { result = useVehiclePlace(vehicle); return () => h("div"); } });
  mounted = mount(C, { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } });
  return () => result.value;
}

beforeEach(() => {
  mounted?.unmount();
  mounted = null;
  calls.length = 0;
  reply.mockImplementation(async (url: string) => {
    const id = url.split("/")[4];
    return { ok: true, data: { ok: true, data: { vehicleId: id, place: PILOT } } };
  });
});

describe("useVehiclePlace (D-LM31)", () => {
  it("asks about a parked truck and answers the place", async () => {
    const place = probe(ref(truck("parked")));
    await flushPromises();
    expect(calls).toEqual([`/api/livemap/vehicles/${TRUCK}/place`]);
    expect(place()).toEqual(PILOT);
  });

  it("never asks about a moving or an offline truck, or about no truck", async () => {
    for (const v of [truck("moving"), truck("offline"), null]) {
      const place = probe(ref(v));
      await flushPromises();
      expect(place()).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  it("does not ask again when the board repeats a parked truck's fix, or jitters it a few metres", async () => {
    const v = ref<LiveMapVehicle | null>(truck("parked"));
    probe(v);
    await flushPromises();
    v.value = truck("parked");
    await flushPromises();
    v.value = truck("parked", 41.48079, -88.08009);
    await flushPromises();
    expect(calls).toHaveLength(1);
  });

  it("asks again once the truck has driven to another stop, and drops the old place while it drives", async () => {
    const v = ref<LiveMapVehicle | null>(truck("parked"));
    const place = probe(v);
    await flushPromises();
    v.value = truck("moving", 41.6, -88.2);
    await flushPromises();
    expect(place()).toBeNull();
    v.value = truck("stopped", 41.7, -88.3);
    await flushPromises();
    expect(calls).toHaveLength(2);
  });

  it("shows nothing, and does not retry, when the lookup fails", async () => {
    reply.mockResolvedValue({ ok: false, data: { ok: false, error: { message: "Could not look up where this truck is" } } });
    const place = probe(ref(truck("stopped")));
    await flushPromises();
    await new Promise((r) => setTimeout(r, 50));
    await flushPromises();
    expect(place()).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
