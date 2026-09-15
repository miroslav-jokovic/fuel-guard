import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { driverPlacements } from "@silvicom/shared";
import { usePacketCeremony } from "./usePacketCeremony";
import type { ApplyPacketStop } from "@/features/apply/useApplication";

/**
 * The walk through the carrier's packet (P5, D-PKT6, D-PKT13).
 *
 * ⚠ **The fixture is the REAL inventory, not a hand-written pair of stops.** `driverPlacements()` is
 * what the server serves and what the ceremony walks, and the properties worth pinning here — page
 * 19's two stops being distinguishable, the count being 22, three of them asking for initials — are
 * exactly the ones a convenient two-element fixture would make vacuous
 * ([[prove-tests-fail-by-mutating]]: a fixture too uniform to discriminate).
 */

const TOKEN = "e".repeat(43);

const stopsFrom = (signed: Record<string, string> = {}): ApplyPacketStop[] =>
  driverPlacements().map((p) => ({ ...p, signedAt: signed[p.id] ?? null }));

const marked: Array<{ placementId: string; signedName: string }> = [];
let answer: (placementId: string) => { signedCount: number; complete: boolean } | Error;

/**
 * ⚠ The three capture calls are mocked too, though nothing here uses them: `stageCapture`'s default
 * io binds them at module load, so a partial mock of this module is an IMPORT-TIME crash rather than
 * a call-time one — `useSigningCeremony.test.ts` next door hit the same wall and says so. Every test
 * below injects its own `stage`.
 */
vi.mock("@/features/apply/useApplication", () => ({
  applyPacketMark: (_token: string, placementId: string, signedName: string) => {
    marked.push({ placementId, signedName });
    const a = answer(placementId);
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  },
  startApplicationCapture: vi.fn(),
  uploadCaptureBytes: vi.fn(),
  confirmApplicationCapture: vi.fn(),
}));

beforeEach(() => {
  marked.length = 0;
  answer = () => ({ signedCount: marked.length, complete: marked.length >= 22 });
});
afterEach(() => vi.clearAllMocks());

describe("adopting the mark", () => {
  it("refuses a name too short to be one", async () => {
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom()));
    c.adoptedName.value = "M";
    expect(await c.adopt()).toBe(false);
    expect(c.adopted.value).toBe(false);
  });

  /**
   * ⚠ D-PKT13 lets the driver DRAW instead of typing, and this is the half of that which could go
   * wrong silently: choosing "draw" and then not drawing would otherwise adopt an empty mark and put
   * nothing on twenty-two pages.
   */
  it("refuses to start a drawn signature that was never drawn", async () => {
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom()));
    c.adoptedName.value = "Marija Varmeda";
    c.style.value = "drawn";
    expect(await c.adopt()).toBe(false);
    expect(c.adopted.value).toBe(false);
  });

  it("starts once the drawing exists", async () => {
    const stage = vi.fn().mockResolvedValue(undefined);
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom()), { stage: stage as never });
    c.adoptedName.value = "Marija Varmeda";
    c.adoptedInitials.value = "MV";
    c.style.value = "drawn";
    c.markBlob.value = new Blob(["x"], { type: "image/png" });
    expect(await c.adopt()).toBe(true);
    expect(stage).toHaveBeenCalledOnce();
    expect(stage.mock.calls[0]![1]).toBe("signature_mark");
  });

  /**
   * ⚠ A8b/D-APP8, carried over deliberately: a PNG that will not upload must not stand between a
   * driver and twenty-two signatures. They have still signed — with the typed name, which is the
   * record on every row.
   */
  it("starts anyway when the drawing will not upload", async () => {
    const stage = vi.fn().mockRejectedValue(new Error("offline"));
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom()), { stage: stage as never });
    c.adoptedName.value = "Marija Varmeda";
    c.adoptedInitials.value = "MV";
    c.style.value = "drawn";
    c.markBlob.value = new Blob(["x"], { type: "image/png" });
    expect(await c.adopt()).toBe(true);
  });

  it("does not stage anything when the driver types", async () => {
    const stage = vi.fn();
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom()), { stage: stage as never });
    c.adoptedName.value = "Marija Varmeda";
    c.adoptedInitials.value = "MV";
    expect(await c.adopt()).toBe(true);
    expect(stage).not.toHaveBeenCalled();
  });
});

/**
 * ⚠ **The second adopted mark (D-PKT6, Q-PKT8).** Until 2026-09-14 this composable adopted one and
 * sent the full name to `p05`, `p06` and `p09`; the server would have refused a client that got it
 * right, because `record_packet_mark` pinned one name per link until migration 0340.
 */
describe("adopting the initials", () => {
  it("will not start while a stop that takes initials has none", async () => {
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom()));
    c.adoptedName.value = "Marija Varmeda";
    expect(await c.adopt()).toBe(false);
    expect(c.adopted.value).toBe(false);
  });

  it("starts once the initials are typed", async () => {
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom()));
    c.adoptedName.value = "Marija Varmeda";
    c.adoptedInitials.value = "MV";
    expect(await c.adopt()).toBe(true);
  });

  /**
   * ⚠ One character, not two. `applicationPacketMarkSchema` accepts `min(1)`, and somebody with one
   * legal name has one initial — a client refusing it would be inventing a rule the contract has not
   * got.
   */
  it("accepts a single initial", async () => {
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom()));
    c.adoptedName.value = "Marija Varmeda";
    c.adoptedInitials.value = "M";
    expect(await c.adopt()).toBe(true);
  });

  /**
   * ⚠ **Asked for only while one of the three is still outstanding**, and this is the case that says
   * why: a driver resuming a link that collected `p05`, `p06` and `p09` yesterday would be asked to
   * reproduce a mark the server has pinned, and a different keystroke would be refused (DR035).
   */
  it("does not ask for initials when every place that takes them is already collected", async () => {
    const done = Object.fromEntries(
      driverPlacements().filter((p) => p.mark === "initials").map((p) => [p.id, "2026-09-14T11:00:00Z"]),
    );
    expect(Object.keys(done)).toHaveLength(3);
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom(done)));
    expect(c.needsInitials.value).toBe(false);
    c.adoptedName.value = "Marija Varmeda";
    expect(await c.adopt()).toBe(true);
  });

  it("asks for them while a single one is left", async () => {
    const initials = driverPlacements().filter((p) => p.mark === "initials");
    const done = Object.fromEntries(initials.slice(1).map((p) => [p.id, "2026-09-14T11:00:00Z"]));
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom(done)));
    expect(c.needsInitials.value).toBe(true);
    c.adoptedName.value = "Marija Varmeda";
    expect(await c.adopt()).toBe(false);
  });
});

describe("the walk", () => {
  const started = (signed: Record<string, string> = {}) => {
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom(signed)));
    c.adoptedName.value = "Marija Varmeda";
    c.adoptedInitials.value = "MV";
    return c;
  };

  it("opens on the packet's first place and counts against the whole document", async () => {
    const c = started();
    await c.adopt();
    expect(c.current.value!.id).toBe("p03");
    expect(c.total.value).toBe(22);
    expect(c.position.value).toBe(1);
  });

  it("walks all twenty-two in the packet's own page order", async () => {
    const c = started();
    await c.adopt();
    for (let i = 0; i < 22; i++) await c.sign();
    expect(marked.map((m) => m.placementId)).toEqual(driverPlacements().map((p) => p.id));
    const pages = marked.map((m) => driverPlacements().find((p) => p.id === m.placementId)!.page);
    expect(pages).toEqual([...pages].sort((a, b) => a - b));
    expect(c.complete.value).toBe(true);
  });

  /**
   * D-PKT13: the marks are adopted once and applied at every place — and there are TWO of them
   * (D-PKT6, Q-PKT8), each going only where the carrier's paper asks for it.
   */
  it("sends the signature to the nineteen places that take one, and the initials to the three", async () => {
    const c = started();
    await c.adopt();
    for (let i = 0; i < 22; i++) await c.sign();

    const byKind = (kind: string) =>
      marked.filter((m) => driverPlacements().find((p) => p.id === m.placementId)!.mark === kind);
    expect(byKind("initials").map((m) => m.placementId)).toEqual(["p05", "p06", "p09"]);
    expect(new Set(byKind("initials").map((m) => m.signedName))).toEqual(new Set(["MV"]));
    expect(byKind("signature")).toHaveLength(19);
    expect(new Set(byKind("signature").map((m) => m.signedName))).toEqual(new Set(["Marija Varmeda"]));
  });

  /**
   * ⚠ The initials are not derived from the name ANYWHERE — D-PKT6's *"a ceremony that derived them
   * from the typed name would be inventing a mark the signer never made"*. Initials that share no
   * letter with the name make a derivation impossible to mistake for a pass.
   */
  it("sends exactly what the driver typed, never an abbreviation of the name", async () => {
    const c = started();
    c.adoptedInitials.value = "ZQ";
    await c.adopt();
    for (let i = 0; i < 22; i++) await c.sign();
    const p05 = marked.find((m) => m.placementId === "p05")!;
    expect(p05.signedName).toBe("ZQ");
  });

  /**
   * ⚠ Page 19 carries its signature line twice, and the two stops are identical in every field but
   * the id. A ceremony keyed on anything else would sign one of them twice and leave the other blank
   * — on a page the carrier's paper has two lines on.
   */
  it("visits both of page 19's places, as two distinct stops", async () => {
    const c = started();
    await c.adopt();
    for (let i = 0; i < 22; i++) await c.sign();
    const p19 = marked.filter((m) => m.placementId.startsWith("p19"));
    expect(p19.map((m) => m.placementId)).toEqual(["p19a", "p19b"]);
  });

  it("cannot be walked past a place that did not land", async () => {
    const c = started();
    await c.adopt();
    answer = () => new Error("network");
    await c.sign();
    expect(c.current.value!.id).toBe("p03");
    expect(c.position.value).toBe(1);
    expect(c.error.value).not.toBeNull();
  });

  /** A double-tap, or the same link open twice. The mark exists; move on. */
  it("moves on when the server says the place is already marked", async () => {
    const c = started();
    await c.adopt();
    answer = () => Object.assign(new Error("already"), { code: "packet_mark_already_made" });
    await c.sign();
    expect(c.current.value!.id).toBe("p04");
    expect(c.error.value).toBeNull();
  });

  /**
   * ⚠ **Completion is the SERVER's count, not the end of this file's array.** A stop collected in
   * another tab means the client's list is not the document's, and a ceremony that declared itself
   * finished on reaching its own last element would be reporting on the wrong thing.
   */
  it("finishes when the server says the packet is complete, not when the list runs out", async () => {
    const c = started();
    await c.adopt();
    answer = () => ({ signedCount: 22, complete: true });
    await c.sign();
    expect(c.complete.value).toBe(true);
    expect(marked).toHaveLength(1);
  });
});

describe("coming back to a half-signed packet", () => {
  it("opens on the first place not yet collected", async () => {
    const c = usePacketCeremony(
      ref(TOKEN),
      ref(stopsFrom({ p03: "2026-09-14T11:00:00Z", p04: "2026-09-14T11:01:00Z" })),
    );
    c.adoptedName.value = "Marija Varmeda";
    c.adoptedInitials.value = "MV";
    await c.adopt();
    expect(c.current.value!.id).toBe("p05");
  });

  /**
   * ⚠ The counter keeps counting the PACKET. A driver who signed two places yesterday is on place
   * three today, not place one — renumbering under somebody who is watching a count is exactly how a
   * progress indicator stops being trusted.
   */
  it("counts a resumed walk against the whole packet", async () => {
    const c = usePacketCeremony(
      ref(TOKEN),
      ref(stopsFrom({ p03: "2026-09-14T11:00:00Z", p04: "2026-09-14T11:01:00Z" })),
    );
    c.adoptedName.value = "Marija Varmeda";
    c.adoptedInitials.value = "MV";
    await c.adopt();
    expect(c.position.value).toBe(3);
    expect(c.total.value).toBe(22);
    expect(c.collected.value).toHaveLength(2);
  });

  it("is already done when every place was collected before", () => {
    const all = Object.fromEntries(driverPlacements().map((p) => [p.id, "2026-09-14T11:00:00Z"]));
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom(all)));
    expect(c.complete.value).toBe(true);
    expect(c.state.value).toBe("done");
  });
});
