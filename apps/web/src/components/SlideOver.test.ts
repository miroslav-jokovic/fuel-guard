import { describe, it, expect, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { DIALOG_FOOTER_CLASS } from "@silvicom/ui";
import SlideOver from "./SlideOver.vue";

/**
 * The drawer's width, which is the only thing about it a caller chooses.
 *
 * ⚠ `xl` was added 2026-09-11 for the application review — a drawer holding a whole §391.21 document
 * rather than a form. Without a pin, a size that no test names is a size the next refactor collapses
 * back into `lg`, and the symptom is sixty label-and-value rows wrapping at the reviewer's desk
 * rather than anything failing.
 */

/** ⚠ The dialog teleports to the body, so the panel is read from the document rather than the
 *  wrapper — and only after a tick, because the transition mounts it asynchronously. */
const widthOf = async (size?: "md" | "lg" | "xl"): Promise<string> => {
  open = mount(SlideOver, {
    props: { open: true, title: "A drawer", ...(size ? { size } : {}) },
    attachTo: document.body,
  });
  await nextTick();
  await nextTick();
  return (
    Array.from(document.querySelectorAll("div"))
      .map((el) => el.className)
      .find((c) => c.includes("w-screen")) ?? ""
  );
};

let open: ReturnType<typeof mount> | null = null;
afterEach(() => {
  open?.unmount();
  open = null;
  document.body.innerHTML = "";
});

describe("how wide the drawer opens", () => {
  it("defaults to md — a form, which is what most callers put in it", async () => {
    expect(await widthOf()).toContain("max-w-md");
  });

  it("lg for a longer form", async () => {
    expect(await widthOf("lg")).toContain("max-w-lg");
  });

  it("xl for a whole document, which is what the application review is", async () => {
    expect(await widthOf("xl")).toContain("max-w-4xl");
  });
});

/**
 * The footer's layout is the drawer's (`DIALOG_FOOTER_CLASS`), not each caller's. Until 2026-11-15
 * the slot was a plain block and forty-odd drawers wrote the same row themselves; the one that forgot
 * shipped with its buttons at the left edge, touching.
 */
describe("the drawer's footer", () => {
  const footer = async (slots: Record<string, string>) => {
    open = mount(SlideOver, { props: { open: true, title: "A drawer" }, slots, attachTo: document.body });
    await nextTick();
    await nextTick();
    return document.querySelector('[data-test="dialog-footer"]');
  };

  it("lays bare buttons out as the right-aligned row that wraps, with no wrapper from the caller", async () => {
    const el = await footer({ footer: "<button>Cancel</button><button>Save</button>" });
    expect(el?.className.split(/\s+/)).toEqual(expect.arrayContaining(DIALOG_FOOTER_CLASS.split(" ")));
    expect(DIALOG_FOOTER_CLASS.split(" ")).toEqual(expect.arrayContaining(["flex", "flex-wrap", "justify-end", "gap-3"]));
    expect(Array.from(el?.children ?? []).map((c) => c.textContent)).toEqual(["Cancel", "Save"]);
  });

  it("draws no footer bar for a drawer that has no footer", async () => {
    expect(await footer({})).toBeNull();
  });
});
