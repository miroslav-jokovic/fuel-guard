import { describe, it, expect, vi, beforeEach } from "vitest";
import { effectScope, ref } from "vue";
import { APPLICATION_RELEASE_ORDER, type AuthorizationPurpose, type SignatureAdoptionsView } from "@silvicom/shared";
import type { ApplyRelease } from "@/features/apply/useApplication";
import { usePermissionCeremony } from "./usePermissionCeremony";

/**
 * The permissions, each its own PDF, signed one at a time (A5, AF6).
 *
 * The property that matters is still A5's: it cannot sign MORE than one document per act and cannot
 * skip one. FCRA §604(b)(2) makes each instrument its own document, and a walk that let somebody jump
 * ahead would produce a half-signed set that looked complete. AF6 adds two: the adoption is the
 * packet's own (so a confirm step stands between the last keystroke and the first signature), and the
 * counter counts the fixed set of five, so it never renumbers under an applicant whose link refetched.
 * C3s1 (D-AW15) makes the adoption the LINK's: signature and initials, registered as adoptions rather
 * than staged for the packet, and pinned from the server once a permission has been signed with them.
 */

const signed = vi.hoisted(() => ({ fn: vi.fn() }));
/**
 * ⚠ The three capture calls are mocked too, though nothing here uses them: `stageCapture`'s default
 * io binds them at module load, so a partial mock is an import-time crash. Every test injects `stage`.
 */
vi.mock("@/features/apply/useApplication", () => ({
  signRelease: signed.fn,
  startApplicationCapture: vi.fn(),
  uploadCaptureBytes: vi.fn(),
  confirmApplicationCapture: vi.fn(),
}));

const release = (purpose: AuthorizationPurpose): ApplyRelease => ({
  purpose, version: "v1", title: `${purpose} title`, citation: "cite",
  body: `${purpose} body`, intent: `I authorize ${purpose}.`, draft: false,
});
const ALL = APPLICATION_RELEASE_ORDER.map(release);
type Adopted = { kind: string; text: string };

const run = (
  already: AuthorizationPurpose[] = [],
  adopt: (t: string, kind: string, text: string, blob: Blob) => Promise<unknown> = async () => undefined,
  adoptions: SignatureAdoptionsView | undefined = undefined,
) => {
  const alreadySigned = ref(already);
  const staged = vi.fn();
  const c = effectScope().run(() =>
    usePermissionCeremony(ref("t".repeat(43)), ref(ALL), alreadySigned, {
      adopt: adopt as never,
      adoptions: ref(adoptions),
      stage: staged as never,
    }),
  )!;
  return { c, alreadySigned, staged };
};

/** Adopt the default (styled) marks and confirm them — the two presses before the first document. */
async function start(c: ReturnType<typeof run>["c"]): Promise<void> {
  c.adoptedName.value = "Susan Godfrey";
  c.adoptedInitials.value = "SG";
  c.markBlob.value = new Blob(["styled"], { type: "image/png" });
  c.initialsBlob.value = new Blob(["styled initials"], { type: "image/png" });
  expect(await c.adopt()).toBe(true);
  c.confirm();
}

beforeEach(() => {
  signed.fn.mockReset();
  signed.fn.mockResolvedValue({ signedCount: 1, completed: false });
});

describe("before the first document", () => {
  it("adopts once, then asks for a confirmation, then shows the first document", async () => {
    const { c } = run();
    expect(c.state.value).toBe("adopting");
    c.adoptedName.value = "Susan Godfrey";
    c.adoptedInitials.value = "SG";
    expect(await c.adopt()).toBe(true);
    expect(c.state.value).toBe("confirming");
    c.confirm();
    expect(c.state.value).toBe("signing");
    expect(c.current.value?.purpose).toBe(APPLICATION_RELEASE_ORDER[0]);
    expect(signed.fn).not.toHaveBeenCalled();
  });

  it("refuses a name that is not one", async () => {
    const { c } = run();
    c.adoptedName.value = " ";
    expect(await c.adopt()).toBe(false);
    expect(c.state.value).toBe("adopting");
  });

  /** D-AW15: screen 13 asks for the initials too, though no permission takes them. */
  it("asks for initials, and will not start without them", async () => {
    const { c } = run();
    expect(c.needsInitials.value).toBe(true);
    c.adoptedName.value = "Susan Godfrey";
    expect(await c.adopt()).toBe(false);
  });

  /**
   * Both marks are REGISTERED as the link's adoptions (C3s1), each with its own typed text — never
   * staged into the packet's capture slots, which A11 prunes at 90 days.
   */
  it("registers the signature and the initials as adoptions, each with its own text, and stages nothing", async () => {
    const adopted: Adopted[] = [];
    const { c, staged } = run([], async (_t, kind, text) => adopted.push({ kind, text }));
    await start(c);
    expect(adopted).toEqual([
      { kind: "signature", text: "Susan Godfrey" },
      { kind: "initials", text: "SG" },
    ]);
    expect(staged).not.toHaveBeenCalled();
  });

  /** A8b: a PNG that will not upload must not stand between an applicant and five signatures. */
  it("still starts when the picture fails to stage, and says so", async () => {
    const { c } = run([], async () => { throw new Error("storage down"); });
    await start(c);
    expect(c.state.value).toBe("signing");
    expect(c.drawnMarkFailed.value).toBe(true);
    expect(c.initialsMarkFailed.value).toBe(true);
  });
});

describe("signing the documents", () => {
  it("signs the document on screen, one request, with the typed name, then moves on", async () => {
    const { c } = run();
    await start(c);
    await c.signCurrent();
    expect(signed.fn).toHaveBeenCalledTimes(1);
    expect(signed.fn).toHaveBeenCalledWith("t".repeat(43), APPLICATION_RELEASE_ORDER[0], "Susan Godfrey");
    expect(c.current.value?.purpose).toBe(APPLICATION_RELEASE_ORDER[1]);
    expect(c.position.value).toBe(2);
  });

  /** Only a 201 advances: a document that did not land cannot be walked past. */
  it("stays on a document whose signature did not go through", async () => {
    const { c } = run();
    await start(c);
    signed.fn.mockRejectedValueOnce(Object.assign(new Error("network"), { code: "sign_failed" }));
    await c.signCurrent();
    expect(c.current.value?.purpose).toBe(APPLICATION_RELEASE_ORDER[0]);
    expect(c.error.value).toBe("network");
  });

  it("moves on from a double-tap the server already recorded, and stops on unpublished wording", async () => {
    const { c } = run();
    await start(c);
    signed.fn.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "release_already_signed" }));
    await c.signCurrent();
    expect(c.current.value?.purpose).toBe(APPLICATION_RELEASE_ORDER[1]);
    signed.fn.mockRejectedValueOnce(Object.assign(new Error("draft"), { code: "disclosure_not_final" }));
    await c.signCurrent();
    expect(c.carrierProblem.value).toBe(true);
    expect(c.current.value?.purpose).toBe(APPLICATION_RELEASE_ORDER[1]);
  });

  it("is complete after the last one, and not before", async () => {
    const { c } = run();
    await start(c);
    for (let i = 0; i < APPLICATION_RELEASE_ORDER.length; i += 1) {
      expect(c.complete.value).toBe(false);
      await c.signCurrent();
    }
    expect(c.complete.value).toBe(true);
    expect(c.state.value).toBe("done");
    // Each request names ITS document, in order — not five signatures on the first one.
    expect(signed.fn.mock.calls.map((call) => call[1])).toEqual([...APPLICATION_RELEASE_ORDER]);
  });

  /** A5's word: the typed name, once adopted, is what every document is signed in. */
  it("locks the signature once a document carries it", async () => {
    const { c } = run();
    await start(c);
    expect(c.canChange("signature")).toBe(true);
    await c.signCurrent();
    expect(c.canChange("signature")).toBe(false);
  });
});

describe("the counter and a resumed link", () => {
  /**
   * ⚠ The stranded-cursor lesson: the link refetches (window focus), and the documents this session
   * signed arrive back as `alreadySigned`. A counter over what is LEFT would jump from "3 of 6" to
   * "1 of 4" under the applicant; a counter over the fixed six does not move.
   */
  it("counts the fixed six, and does not renumber when the link refetches", async () => {
    const { c, alreadySigned } = run();
    await start(c);
    await c.signCurrent();
    await c.signCurrent();
    expect(c.position.value).toBe(3);
    expect(c.total.value).toBe(6);
    alreadySigned.value = [APPLICATION_RELEASE_ORDER[0]!, APPLICATION_RELEASE_ORDER[1]!];
    expect(c.position.value).toBe(3);
    expect(c.current.value?.purpose).toBe(APPLICATION_RELEASE_ORDER[2]);
  });

  /**
   * ⚠ A resumed applicant starts at the first unsigned document and can still TYPE their name. The
   * link serves which permissions are signed and not the name they were signed in, so pinning on the
   * earlier ones would disable an empty field and leave them no way to sign the rest.
   */
  it("resumes at the first unsigned document with the name still editable", async () => {
    const { c } = run([APPLICATION_RELEASE_ORDER[0]!, APPLICATION_RELEASE_ORDER[1]!]);
    expect(c.collected.value).toHaveLength(2);
    expect(c.canChange("signature")).toBe(true);
    await start(c);
    expect(c.current.value?.purpose).toBe(APPLICATION_RELEASE_ORDER[2]);
    expect(c.position.value).toBe(3);
  });

  /**
   * C3s1: a driver who adopted and left BEFORE signing anything meets the form with their own marks in
   * it, still changeable — the server allows a new adoption until one is used (`adoption_in_use`).
   */
  it("seeds a link's unused adoption into the form, and leaves it changeable", () => {
    const { c } = run([], undefined, { signature: "Susan Godfrey", initials: "SG" });
    expect(c.state.value).toBe("adopting");
    expect(c.alreadyAdopted.value).toBe(false);
    expect(c.adoptedName.value).toBe("Susan Godfrey");
    expect(c.adoptedInitials.value).toBe("SG");
    expect(c.canChange("signature")).toBe(true);
    // The picture exists on the server, so the screens say it is kept rather than previewing the name.
    expect(c.markCarriedOver.value).toBe(true);
    expect(c.initialsCarriedOver.value).toBe(true);
  });

  /**
   * And once permissions were signed with it, the adoption is what the server pins: the resumed panel,
   * nothing re-sent, and the count of documents that carry it is the walk's — earlier visits included.
   */
  it("carries a used adoption on without asking or sending it again", async () => {
    const adopt = vi.fn();
    const { c } = run(
      [APPLICATION_RELEASE_ORDER[0]!, APPLICATION_RELEASE_ORDER[1]!],
      adopt,
      { signature: "Susan Godfrey", initials: "SG" },
    );
    expect(c.alreadyAdopted.value).toBe(true);
    expect(c.canChange("signature")).toBe(false);
    expect(c.placesWithMark("signature")).toBe(2);
    expect(await c.adopt()).toBe(true);
    expect(c.state.value).toBe("signing");
    expect(adopt).not.toHaveBeenCalled();
    expect(c.drawnMarkFailed.value).toBe(false);
    await c.signCurrent();
    expect(signed.fn).toHaveBeenCalledWith("t".repeat(43), APPLICATION_RELEASE_ORDER[2], "Susan Godfrey");
  });

  /** The name changed and the new adoption did not save: back to the adoption, never a dead end. */
  it("takes the driver back to adopt when the server says the name is not the adopted one", async () => {
    const { c } = run();
    await start(c);
    signed.fn.mockRejectedValueOnce(
      Object.assign(new Error("Make it again"), { code: "adoption_name_mismatch" }),
    );
    await c.signCurrent();
    expect(c.state.value).toBe("adopting");
    expect(c.error.value).toBe("Make it again");
    expect(c.current.value?.purpose).toBe(APPLICATION_RELEASE_ORDER[0]);
  });
});
