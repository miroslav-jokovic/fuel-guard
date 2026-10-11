import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { driverPlacements } from "@silvicom/shared";
import PacketCeremony from "@/features/apply/signing/PacketCeremony.vue";

/**
 * The packet on the one signing walk (D-HB12): the stop's page opened, the Sign here tag on its line,
 * and the tag is what signs. The viewer is stubbed as the bytes would answer (`PlaceWalk.test.ts`).
 */
vi.mock("@/features/apply/signing/SigningPageView.vue", () => ({
  default: {
    name: "SigningPageView",
    props: ["src", "page", "label", "places", "tagPlaceId"],
    emits: ["located", "loaded", "failed"],
    mounted(this: { $emit: (e: string, v?: unknown) => void; places: string[] }) {
      const box = { left: 10, top: 10, width: 40, height: 3 };
      const pageOf = Object.fromEntries(driverPlacements(null).map((p) => [p.id, p.page]));
      this.$emit("located", Object.fromEntries(this.places.map((id) => [id, { page: pageOf[id], box }])));
      this.$emit("loaded", 31);
    },
    template: "<div data-viewer :data-src='src' :data-page='page' :data-tag='tagPlaceId'><slot v-if='tagPlaceId' name='tag' /></div>",
  },
}));

const fetchMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);
const TOKEN = "t".repeat(43);
const stops = () => driverPlacements(null).map((p) => ({ ...p, signedAt: null }));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ ok: true, signedCount: 1, complete: false }) });
});

describe("the packet on the one signing walk (D-HB12)", () => {
  it("opens the first stop's page, tags its line, and signs from the tag", async () => {
    const w = mount(PacketCeremony, {
      props: { token: TOKEN, stops: stops(), carrier: "Silvicom Inc", adoptions: { signature: "Susan Godfrey", initials: "SG" } },
    });
    await flushPromises();
    await w.findAll("button").find((b) => b.text() === "Use it")!.trigger("click");
    await flushPromises();
    const first = stops()[0]!;
    const viewer = w.find("[data-viewer]");
    expect(viewer.attributes("data-page")).toBe(String(first.page));
    expect(viewer.attributes("data-tag")).toBe(first.id);
    await viewer.find("button").trigger("click");
    await flushPromises();
    const marks = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/mark"));
    expect(marks).toHaveLength(1);
    expect(JSON.parse(String((marks[0]![1] as RequestInit).body)).placement_id).toBe(first.id);
  });
});
