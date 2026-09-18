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
   * ⚠ A0b, and the reason the walk on 2026-09-17 ended in a lie. The limiter refused the
   * twenty-first request of the ceremony, `publicFetch` could not parse the plain-text 429, and the
   * driver was told their link was invalid — about a link that was fine and would work again within
   * the minute. The server answers in the API's envelope now; this is the client half.
   */
  it("tells a rate-limited stop apart from a fault, and stays on the same place", async () => {
    const c = started();
    await c.adopt();
    answer = () => Object.assign(new Error("slow down"), { code: "too_many_requests" });
    await c.sign();
    expect(c.rateLimited.value).toBe(true);
    expect(c.error.value).not.toBeNull();
    // ⚠ Same place, so pressing again retries THIS mark rather than skipping it — the one thing a
    // refusal must never do on a document somebody's job depends on.
    expect(c.current.value!.id).toBe("p03");
    expect(marked).toHaveLength(1);
  });

  /** Anything else is a fault, and must not borrow the limiter's "wait a minute" words. */
  it("does not call an ordinary failure rate-limited", async () => {
    const c = started();
    await c.adopt();
    answer = () => Object.assign(new Error("boom"), { code: "packet_mark_failed" });
    await c.sign();
    expect(c.error.value).not.toBeNull();
    expect(c.rateLimited.value).toBe(false);
  });

  /** And a retry that lands clears it, so the wait message cannot outlive the wait. */
  it("clears the rate-limited flag when the next attempt goes through", async () => {
    const c = started();
    await c.adopt();
    answer = () => Object.assign(new Error("slow down"), { code: "too_many_requests" });
    await c.sign();
    expect(c.rateLimited.value).toBe(true);
    answer = () => ({ signedCount: 1, complete: false });
    await c.sign();
    expect(c.rateLimited.value).toBe(false);
    expect(c.current.value!.id).toBe("p04");
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

/**
 * Coming back to a link that already adopted its marks (Q-PKT9, answered 2026-09-14).
 *
 * ⚠ **This is not a convenience.** `record_packet_mark` pinned the marks at the first stop, so a
 * resumed walk that asked the driver to type their name again and got `M. Varmeda` where
 * `Marija Varmeda` was pinned would be refused at the NEXT stop — with a message telling them to
 * "start again", which the ceremony does not offer and a half-signed packet could not do.
 */
describe("a resumed walk whose marks the server has already pinned", () => {
  const withAdopted = (
    adopted: { signature: string | null; initials: string | null } | null,
    signed: Record<string, string> = {},
  ) => usePacketCeremony(ref(TOKEN), ref(stopsFrom(signed)), { adopted: ref(adopted) });

  it("does not ask for anything the server has already pinned", async () => {
    const c = withAdopted({ signature: "Marija Varmeda", initials: "MV" });
    expect(c.adoptedName.value).toBe("Marija Varmeda");
    expect(c.adoptedInitials.value).toBe("MV");
    expect(c.alreadyAdopted.value).toBe(true);
    // And it starts without the driver typing a character.
    expect(await c.adopt()).toBe(true);
  });

  it("applies the pinned marks at the stops, each to its own kind", async () => {
    const c = withAdopted({ signature: "Marija Varmeda", initials: "MV" });
    await c.adopt();
    for (let i = 0; i < 22; i++) await c.sign();
    expect(marked.find((m) => m.placementId === "p03")!.signedName).toBe("Marija Varmeda");
    expect(marked.find((m) => m.placementId === "p05")!.signedName).toBe("MV");
  });

  /** A link nobody has signed on yet — the ordinary case — still asks for everything. */
  it("asks for both marks when nothing has been pinned", () => {
    const c = withAdopted(null);
    expect(c.adoptedName.value).toBe("");
    expect(c.alreadyAdopted.value).toBe(false);
  });

  it("asks for both when the server serves nulls", () => {
    const c = withAdopted({ signature: null, initials: null });
    expect(c.alreadyAdopted.value).toBe(false);
  });

  /**
   * ⚠ **A signature pinned with no initials yet is NOT fully adopted**, while an initials stop is
   * still outstanding. It is the state of a driver who got two stops in and stopped, and the screen
   * has to ask for the one mark that is missing rather than carry on without it.
   */
  it("still asks for initials when only the signature is pinned", () => {
    const c = withAdopted({ signature: "Marija Varmeda", initials: null });
    expect(c.needsInitials.value).toBe(true);
    expect(c.alreadyAdopted.value).toBe(false);
  });

  /**
   * ⚠ ...and is fully adopted once no initials stop is LEFT. A driver whose three initials places
   * were collected yesterday never has to produce initials again — holding them on the adoption
   * screen for a mark the packet no longer asks for would be the opposite of the fix.
   */
  it("is fully adopted with no initials when every initials stop is already collected", () => {
    const done = Object.fromEntries(
      driverPlacements().filter((p) => p.mark === "initials").map((p) => [p.id, "2026-09-14T11:00:00Z"]),
    );
    const c = withAdopted({ signature: "Marija Varmeda", initials: null }, done);
    expect(c.needsInitials.value).toBe(false);
    expect(c.alreadyAdopted.value).toBe(true);
  });
});

/**
 * A3 — what the stop is allowed to PROMISE about the mark.
 *
 * ⚠ **`currentShowsDrawing` is the client half of a named pair with `renderPacketOverlay`'s mark
 * loop**, so these tests are the client-side statement of one rule: *a drawing is a signature, and
 * `p05`, `p06` and `p09` do not ask for one*. The server half is pinned by
 * "puts the typed initials on the three pages that ask for initials, even in drawn mode".
 *
 * ⚠ The fixture WALKS to a real initials stop rather than asserting over a hand-made one, for this
 * file's stated reason: `p05` is the fourth place in the packet's own order, and a two-element
 * fixture would make "a stop takes initials" true by construction.
 */
describe("what the stop promises in drawn mode", () => {
  /** Adopt by drawing, staged successfully, standing on the first stop. */
  async function drawnCeremony(stage = vi.fn().mockResolvedValue(undefined)) {
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom()), { stage: stage as never });
    c.adoptedName.value = "Marija Varmeda";
    c.adoptedInitials.value = "MV";
    c.style.value = "drawn";
    c.markBlob.value = new Blob(["x"], { type: "image/png" });
    expect(await c.adopt()).toBe(true);
    return c;
  }

  /** Walk forward until the driver is standing on a stop of the given kind. */
  async function walkTo(
    c: Awaited<ReturnType<typeof drawnCeremony>>,
    kind: "signature" | "initials",
  ): Promise<void> {
    for (let i = 0; i < 22 && c.current.value?.mark !== kind; i++) await c.sign();
    expect(c.current.value?.mark, `never reached a ${kind} stop`).toBe(kind);
  }

  it("shows the drawing on a stop that takes a signature", async () => {
    const c = await drawnCeremony();
    await walkTo(c, "signature");
    expect(c.currentShowsDrawing.value).toBe(true);
  });

  /**
   * ⚠ **The defect.** This was TRUE at every stop for four days, which is what put a driver's full
   * autograph on the three lines the carrier captioned `Initials`.
   */
  it("shows the typed initials, not the drawing, on a stop that takes initials", async () => {
    const c = await drawnCeremony();
    await walkTo(c, "initials");
    expect(c.currentShowsDrawing.value).toBe(false);
    expect(c.markFor(c.current.value!)).toBe("MV");
  });

  it("never shows a drawing when the driver typed", async () => {
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom()));
    c.adoptedName.value = "Marija Varmeda";
    c.adoptedInitials.value = "MV";
    expect(await c.adopt()).toBe(true);
    expect(c.currentShowsDrawing.value).toBe(false);
  });
});

/**
 * A3 — the swallowed upload, which is now said out loud.
 *
 * ⚠ A8b still holds and each test asserts it in the same breath: the walk STARTS either way. What
 * changed is that a driver whose drawing did not survive is told, instead of signing twenty-two
 * places believing it did.
 */
describe("telling the driver the drawing did not save", () => {
  const drawing = (): Blob => new Blob(["x"], { type: "image/png" });

  it("says nothing when the drawing staged", async () => {
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom()), {
      stage: vi.fn().mockResolvedValue(undefined) as never,
    });
    c.adoptedName.value = "Marija Varmeda";
    c.adoptedInitials.value = "MV";
    c.style.value = "drawn";
    c.markBlob.value = drawing();
    expect(await c.adopt()).toBe(true);
    expect(c.drawnMarkFailed.value).toBe(false);
  });

  /**
   * ⚠ Both halves in one test on purpose: "told" without "still signs" would be a regression of A8b,
   * and "still signs" without "told" is the defect A3 exists to close. Splitting them would let
   * either half pass alone.
   */
  it("records the failure, and still lets the driver sign", async () => {
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom()), {
      stage: vi.fn().mockRejectedValue(new Error("offline")) as never,
    });
    c.adoptedName.value = "Marija Varmeda";
    c.adoptedInitials.value = "MV";
    c.style.value = "drawn";
    c.markBlob.value = drawing();
    expect(await c.adopt()).toBe(true);
    expect(c.drawnMarkFailed.value).toBe(true);
  });

  /**
   * ⚠ And the promise is withdrawn with it. A failed upload means `signatureMarkBytes` hands the
   * renderer nothing, so the TYPED name lands on all twenty-two — a screen still previewing the
   * drawing would be promising something no filed document will ever show.
   */
  it("stops promising the drawing once it has failed", async () => {
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom()), {
      stage: vi.fn().mockRejectedValue(new Error("offline")) as never,
    });
    c.adoptedName.value = "Marija Varmeda";
    c.adoptedInitials.value = "MV";
    c.style.value = "drawn";
    c.markBlob.value = drawing();
    await c.adopt();
    expect(c.current.value?.mark).toBe("signature");
    expect(c.currentShowsDrawing.value).toBe(false);
  });
});

/**
 * A3 — the adoption screen must not turn into the RESUMED screen while somebody is filling it in.
 *
 * ⚠ **Found by rendering, not by this suite**, and the suite could not have found it as it was
 * written: `alreadyAdopted` read the same refs the input boxes are bound to, so a first-time
 * applicant who typed a name and initials flipped the component to the resumed panel — the Type/Draw
 * control gone, the signature pad unmounted, the drawing in it destroyed, and *"You adopted this when
 * you started"* said to somebody adopting it right then. For a driver who chose to DRAW it was fatal:
 * the name field is above the pad, so the pad vanished before they reached it and the mark silently
 * became the typed one.
 *
 * ⚠ The discriminating input is `options.adopted` — **null for a first-time link** — which is exactly
 * what the old computation ignored. A fixture that always passed a pin could not tell the two apart.
 */
describe("a first-time link is not a resumed one", () => {
  it("stays on the adoption screen while the applicant types a name and initials", () => {
    // ⚠ No `adopted` option at all: this link has pinned nothing, which is the common case.
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom()));
    expect(c.alreadyAdopted.value).toBe(false);

    c.adoptedName.value = "Marija Varmeda";
    expect(c.alreadyAdopted.value).toBe(false);

    // ⚠ The keystroke that used to swap the screen out from under them.
    c.adoptedInitials.value = "MV";
    expect(c.alreadyAdopted.value).toBe(false);
  });

  /**
   * ⚠ And the other direction, so the fix cannot be "always false": a link the server HAS pinned is
   * still recognised as resumed, which is the whole of Q-PKT9 and must not regress.
   */
  it("still recognises a link the server has already pinned", () => {
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom()), {
      adopted: ref({ signature: "Marija Varmeda", initials: "MV" }),
    });
    expect(c.alreadyAdopted.value).toBe(true);
  });

  /**
   * ⚠ The case that proves it reads the PIN and not the boxes: the boxes are full, the server has
   * pinned nothing. Under the old computation this was `true` — and it is the defect exactly.
   */
  it("is not resumed when the boxes are full but the server pinned nothing", () => {
    const c = usePacketCeremony(ref(TOKEN), ref(stopsFrom()), { adopted: ref(null) });
    c.adoptedName.value = "Marija Varmeda";
    c.adoptedInitials.value = "MV";
    expect(c.alreadyAdopted.value).toBe(false);
  });
});
