import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { APPLICATION_RELEASE_ORDER, PERMISSION_SIGNATURE_DESTINATION, type AuthorizationPurpose } from "@silvicom/shared";
import type { ApplyRelease } from "@/features/apply/useApplication";
import SigningCeremony from "@/features/apply/signing/SigningCeremony.vue";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The permissions screen (AF6, D-AF2): each permission as its PDF, signed on the box it names.
 *
 * pdfjs cannot run in this environment, so `pdfDocument.ts` is replaced by a document that answers
 * the four questions the viewer asks: how many pages, where the named box is, what size a page is,
 * and render. What is pinned is the screen's side of the bargain: the tag appears on the box when the
 * document names one, a tap signs THAT document and nothing else, and a document that fails or names
 * no box falls back to its words and a plain button, so nobody is ever left without a way to sign.
 */

const signed = vi.hoisted(() => ({ fn: vi.fn(), report: vi.fn(), adopt: vi.fn() }));
// Screen 13's own request, apart from the screen reports that share `publicFetch` (C3s1).
vi.mock("@/features/apply/signing/adoptMark", () => ({ adoptMark: signed.adopt }));
vi.mock("@/features/apply/useApplication", () => ({
  signRelease: signed.fn,
  publicFetch: signed.report,
  startApplicationCapture: vi.fn(),
  uploadCaptureBytes: vi.fn(),
  confirmApplicationCapture: vi.fn(),
}));

const pdf = vi.hoisted(() => ({ mode: "tagged" as "tagged" | "no-box" | "fails", srcs: [] as string[] }));
vi.mock("@/features/apply/signing/pdfDocument", () => ({
  loadPdfDocument: async (src: string) => {
    pdf.srcs.push(src);
    if (pdf.mode === "fails") throw new Error("document 500");
    const page = {
      view: [0, 0, 612, 792],
      getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
      render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
      cleanup: () => undefined,
    };
    return {
      task: { destroy: async () => undefined },
      doc: {
        numPages: 2,
        getPage: async () => page,
        getDestination: async (name: string) =>
          pdf.mode === "tagged" && name === PERMISSION_SIGNATURE_DESTINATION
            ? [{ num: 9 }, { name: "XYZ" }, 54, 300, null]
            : null,
        getPageIndex: async () => 1,
      },
    };
  },
}));

beforeAll(() => {
  // jsdom lays nothing out; the viewer draws at the width its frame has, so give it one.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 600 });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  window.scrollTo = vi.fn() as never;
});

const release = (purpose: AuthorizationPurpose): ApplyRelease => ({
  purpose, version: "v1", title: `${purpose} title`, citation: "cite",
  body: `${purpose} body words`, intent: `I authorize ${purpose}.`, draft: false,
});

const TOKEN = "t".repeat(43);
const mountIt = () =>
  mount(SigningCeremony, {
    props: { token: TOKEN, releases: APPLICATION_RELEASE_ORDER.map(release), alreadySigned: [], carrier: "Silvicom Inc" },
  });

const click = async (w: ReturnType<typeof mountIt>, text: string) => {
  const b = w.findAll("button").find((x) => x.text().includes(text));
  expect(b, `a button saying "${text}"`).toBeTruthy();
  await b!.trigger("click");
  await flushPromises();
};

/** Through the adoption and its confirm step, as an applicant would: the name, then the initials. */
/**
 * Type both marks, then wait for "Use this" to light up. ⚠ Waited for, not flushed once: the button
 * holds while the styled marks are still being drawn (`PacketMarkStyles`'s `rendering`), and the first
 * test in the file pays for the faces' cold import — one `flushPromises` was a timing guess that
 * failed the moment the button started waiting.
 */
async function typeMarks(w: ReturnType<typeof mountIt>): Promise<void> {
  const [name, initials] = w.findAll("input");
  await name!.setValue("Susan Godfrey");
  await initials!.setValue("SG");
  await vi.waitFor(async () => {
    await flushPromises();
    const use = w.findAll("button").find((b) => b.text() === APPLY_COPY.permissions.adoption.adoptAction);
    expect(use?.attributes("disabled")).toBeUndefined();
  });
}

async function adopt(w: ReturnType<typeof mountIt>): Promise<void> {
  await typeMarks(w);
  await click(w, APPLY_COPY.permissions.adoption.adoptAction);
  await click(w, APPLY_COPY.permissions.adoption.confirmAction);
}

beforeEach(() => {
  signed.fn.mockReset();
  signed.fn.mockResolvedValue({ signedCount: 1, completed: false });
  pdf.mode = "tagged";
  pdf.srcs = [];
});

describe("the permissions, as documents", () => {
  it("asks for a signature in the permissions' words, not the packet's", () => {
    const text = mountIt().text();
    expect(text).toContain("needs you to sign 6 permissions");
    expect(text).not.toMatch(/places on their own form/);
  });

  /** Screen 13 (D-AW15, C3s1): the initials are adopted here too, once, for the application's pages. */
  it("adopts the signature AND the initials, and says where the initials are kept", async () => {
    const w = mountIt();
    const copy = APPLY_COPY.permissions.adoption;
    expect(w.text()).toContain(copy.adoptHeadingWithInitials);
    expect(w.text()).toContain(copy.initialsLabel);
    await typeMarks(w);
    await click(w, copy.adoptAction);
    // The packet's sentence names pages off its stops; this screen has none, and must not say "undefined".
    expect(w.text()).toContain(copy.confirmInitialsWhere([]));
    expect(w.text()).not.toContain("undefined");
  });

  it("will not start without the initials", async () => {
    const w = mountIt();
    await w.findAll("input")[0]!.setValue("Susan Godfrey");
    await flushPromises();
    const start = w.findAll("button").find((b) => b.text() === APPLY_COPY.permissions.adoption.adoptAction)!;
    expect(start.attributes("disabled")).toBeDefined();
  });

  it("shows the first permission as its PDF, and puts the Sign here tag on the box it names", async () => {
    const w = mountIt();
    await adopt(w);
    expect(pdf.srcs.at(-1)).toBe(`/api/public/application/${TOKEN}/permission/${APPLICATION_RELEASE_ORDER[0]}.pdf`);
    expect(w.text()).toContain(APPLY_COPY.permissions.counter(1, 6));
    // The box is on the second page (`getPageIndex` → 1), at 54pt in and 492pt down a 792pt sheet.
    const tag = w.findAll("button").find((b) => b.text() === APPLY_COPY.permissions.signHere)!;
    expect(tag.exists()).toBe(true);
    const box = tag.element.parentElement as HTMLElement;
    expect(box.style.left).toBe(`${(54 / 612) * 100}%`);
    expect(box.style.top).toBe(`${(492 / 792) * 100}%`);
    const pages = w.findAll("canvas");
    expect(pages).toHaveLength(2);
    expect(pages[1]!.element.parentElement!.contains(box)).toBe(true);
    // The words are one tap away, not on the screen beside the document.
    expect(w.find("details").text()).toContain(`${APPLICATION_RELEASE_ORDER[0]} body words`);
  });

  it("signs the document the tag is on, and only that one, then opens the next", async () => {
    const w = mountIt();
    await adopt(w);
    await click(w, APPLY_COPY.permissions.signHere);
    expect(signed.fn).toHaveBeenCalledTimes(1);
    expect(signed.fn).toHaveBeenCalledWith(TOKEN, APPLICATION_RELEASE_ORDER[0], "Susan Godfrey");
    expect(w.text()).toContain(APPLY_COPY.permissions.counter(2, 6));
    expect(pdf.srcs.at(-1)).toContain(`/permission/${APPLICATION_RELEASE_ORDER[1]}.pdf`);
  });

  it("finishes after the sixth, and says so to the page", async () => {
    const w = mountIt();
    await adopt(w);
    for (let i = 0; i < 6; i += 1) await click(w, APPLY_COPY.permissions.signHere);
    expect(signed.fn).toHaveBeenCalledTimes(6);
    expect(w.emitted("done")).toHaveLength(1);
  });
});

/**
 * ⚠ A document that will not load must never stand between an applicant and five federally-required
 * signatures. Both ways it can fail — the fetch, and a document that names no box — end in the same
 * place: the words, and a plain button that signs.
 */
describe("when the document cannot carry the tag", () => {
  it.each(["fails", "no-box"] as const)("falls back to the words and a plain button (%s)", async (mode) => {
    pdf.mode = mode;
    const w = mountIt();
    await adopt(w);
    expect(w.text()).toContain(APPLY_COPY.permissions.unavailable);
    expect(w.text()).toContain(`${APPLICATION_RELEASE_ORDER[0]} body words`);
    expect(w.findAll("button").some((b) => b.text() === APPLY_COPY.permissions.signHere)).toBe(false);
    await click(w, APPLY_COPY.permissions.signAction);
    expect(signed.fn).toHaveBeenCalledWith(TOKEN, APPLICATION_RELEASE_ORDER[0], "Susan Godfrey");
  });
});

/**
 * AW14 (C3d3a): each permission is its own screen in the reports, and adopting the signature is not
 * one of them — ⚠ while the adoption shows, the ceremony already points at the first permission, so
 * a name read from that alone would report the adoption as `ceremony.fcra_disclosure`.
 */
describe("the screen reports", () => {
  it("names the adoption `ceremony` and each permission by its own name", async () => {
    signed.report.mockReset();
    signed.report.mockResolvedValue({ ok: true });
    const { defineComponent, h } = await import("vue");
    const { provideScreenEvents } = await import("@/features/apply/useScreenEvents");
    const { ref } = await import("vue");
    const ApplyScreenMark = (await import("@/features/apply/ApplyScreenMark.vue")).default;
    // As `ApplyPhaseRouter` places it: the branch's name first, the ceremony's own screens inside it.
    const Page = defineComponent({
      setup() {
        provideScreenEvents(ref(TOKEN));
        return () => [
          h(ApplyScreenMark, { name: "ceremony" }),
          h(SigningCeremony, {
            token: TOKEN, releases: APPLICATION_RELEASE_ORDER.map(release), alreadySigned: [], carrier: "Silvicom Inc",
          }),
        ];
      },
    });
    const w = mount(Page);
    await flushPromises();
    await adopt(w as never);
    await click(w as never, APPLY_COPY.permissions.signHere);
    window.dispatchEvent(new Event("pagehide"));
    await flushPromises();
    const screens = signed.report.mock.calls
      .flatMap(([, init]) => (JSON.parse(String((init as RequestInit).body)) as { events: { screen: string }[] }).events)
      .map((e) => e.screen);
    expect(screens).toEqual([
      "ceremony",
      `ceremony.${APPLICATION_RELEASE_ORDER[0]}`,
      `ceremony.${APPLICATION_RELEASE_ORDER[1]}`,
    ]);
    w.unmount();
  });
});
