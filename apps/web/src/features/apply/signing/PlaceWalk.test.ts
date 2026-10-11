import { describe, it, expect, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import PlaceWalk from "@/features/apply/signing/PlaceWalk.vue";
import type { RailPlace } from "@/features/apply/signing/signingPlaces";

/**
 * The one walk the packet and the handbook are signed with (D-HB12). The viewer is stubbed as the
 * bytes would answer; `located` is what decides whether a place has a tag.
 */
const located = vi.hoisted(() => ({ ids: null as string[] | null, fail: false }));
vi.mock("@/features/apply/signing/SigningPageView.vue", () => ({
  default: {
    name: "SigningPageView",
    props: ["src", "page", "label", "places", "tagPlaceId"],
    emits: ["located", "loaded", "failed"],
    // Like the real viewer: the tag hangs only over a place the document named.
    data: () => ({ found: [] as string[] }),
    mounted(this: { $emit: (e: string, v?: unknown) => void; places: string[]; found: string[] }) {
      if (located.fail) return this.$emit("failed");
      const box = { left: 10, top: 10, width: 40, height: 3 };
      const pages: Record<string, number> = { p11a: 11, p11b: 11, p13: 13 };
      const ids = located.ids ?? this.places;
      this.found = ids;
      this.$emit("located", Object.fromEntries(ids.map((id) => [id, { page: pages[id] ?? 1, box }])));
      this.$emit("loaded", 31);
    },
    template: "<div data-viewer :data-src='src' :data-page='page' :data-tag='tagPlaceId'><slot v-if='tagPlaceId && found.includes(tagPlaceId)' name='tag' /></div>",
  },
}));

const PLACES: RailPlace[] = [
  { id: "p11a", page: 11, what: "Permission to ask previous employers" },
  { id: "p11b", page: 11, what: "Everything on this application is true" },
  { id: "p13", page: 13, what: "Your answers are true for 45 days" },
];

const mountIt = (signed: string[], currentId: string | null) =>
  mount(PlaceWalk, {
    props: {
      src: "/doc", label: "The application", places: PLACES, scope: "on the application",
      currentId, signedIds: new Set(signed), tagLabel: "Sign here", workingLabel: "Signing…", working: false,
    },
  });
const viewer = (w: ReturnType<typeof mountIt>) => w.find("[data-viewer]");
const signButtons = (w: ReturnType<typeof mountIt>) => w.findAll("button").filter((b) => b.text() === "Sign here");

describe("the one signing walk (D-HB12)", () => {
  it("opens the page the place is on and hangs the Sign here tag on it — the only way to sign while it is found", async () => {
    located.ids = null;
    located.fail = false;
    const w = mountIt([], "p11a");
    await flushPromises();
    expect(viewer(w).attributes("data-page")).toBe("11");
    expect(viewer(w).attributes("data-tag")).toBe("p11a");
    expect(signButtons(w)).toHaveLength(1);
    await signButtons(w)[0]!.trigger("click");
    expect(w.emitted("sign")).toHaveLength(1);
  });

  it("falls back to a plain Sign button when the document does not name the place, or does not load", async () => {
    located.ids = [];
    const unnamed = mountIt([], "p11a");
    await flushPromises();
    expect(signButtons(unnamed)).toHaveLength(1);
    expect(unnamed.find("[data-viewer] button").exists()).toBe(false);
    located.ids = null;
    located.fail = true;
    const failed = mountIt([], "p11a");
    await flushPromises();
    expect(signButtons(failed)).toHaveLength(1);
    located.fail = false;
  });

  it("lets the driver read another page, takes the tag away while they do, and brings them back", async () => {
    const w = mountIt([], "p11a");
    await flushPromises();
    w.findComponent({ name: "SigningPlaceRail" }).vm.$emit("look", "p13");
    await flushPromises();
    expect(viewer(w).attributes("data-page")).toBe("13");
    expect(viewer(w).attributes("data-tag")).toBeUndefined();
    expect(w.text()).toContain("You are reading page 13. The place you are signing is on page 11.");
    await w.findAll("button").find((b) => b.text() === "Take me back")!.trigger("click");
    expect(viewer(w).attributes("data-page")).toBe("11");
    expect(viewer(w).attributes("data-tag")).toBe("p11a");
  });

  /**
   * ⚠ decision A, as measured: the packet's copy is 635 KB, so it is fetched again only when the page
   * on screen holds a place signed since — p11a → p11b stays on page 11 (fetch), p11b → p13 leaves it (no fetch).
   */
  it("fetches the document again only when the page on screen holds a newly signed place", async () => {
    const w = mountIt([], "p11a");
    await flushPromises();
    expect(viewer(w).attributes("data-src")).toBe("/doc?v=0");
    await w.setProps({ signedIds: new Set(["p11a"]), currentId: "p11b" });
    await flushPromises();
    expect(viewer(w).attributes("data-src")).toBe("/doc?v=1");
    await w.setProps({ signedIds: new Set(["p11a", "p11b"]), currentId: "p13" });
    await flushPromises();
    expect(viewer(w).attributes("data-page")).toBe("13");
    expect(viewer(w).attributes("data-src")).toBe("/doc?v=1");
    // ...and looking back at page 11, which now holds a place the copy does not, fetches it then.
    w.findComponent({ name: "SigningPlaceRail" }).vm.$emit("look", "p11b");
    await flushPromises();
    expect(viewer(w).attributes("data-src")).toBe("/doc?v=2");
  });
});
