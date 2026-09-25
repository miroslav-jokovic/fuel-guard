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

const signed = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/features/apply/useApplication", () => ({
  signRelease: signed.fn,
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

/** Through the adoption and its confirm step, as an applicant would. */
async function adopt(w: ReturnType<typeof mountIt>): Promise<void> {
  const name = w.find("input");
  await name.setValue("Susan Godfrey");
  await flushPromises();
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
