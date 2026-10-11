import { describe, it, expect, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import SkipLink from "./SkipLink.vue";
import { MAIN_CONTENT_ID } from "@/lib/layout";

/**
 * The skip link (WCAG 2.4.1). On 2026-10-04 a keyboard reached Fuel Costs' "Export report" on its 48th Tab,
 * 40 of them the sidebar (design verdict 03, E8).
 */
describe("SkipLink", () => {
  afterEach(() => document.body.replaceChildren());

  it("moves focus into the page's main content, not only the scroll", async () => {
    const main = document.createElement("main");
    main.id = MAIN_CONTENT_ID;
    main.tabIndex = -1;
    document.body.append(main);
    const w = mount(SkipLink, { attachTo: document.body });
    expect(w.text()).toBe("Skip to main content");
    expect(w.attributes("href")).toBe(`#${MAIN_CONTENT_ID}`);
    await w.trigger("click");
    expect(document.activeElement).toBe(main);
    w.unmount();
  });

  it("is hidden until focused, and visible when it is", () => {
    const cls = mount(SkipLink).classes();
    expect(cls).toContain("sr-only");
    expect(cls).toContain("focus:not-sr-only");
  });
});

/**
 * The link is shown over the app shell only (its sidebar is the block bypassed), so the shell's `<main>` must
 * hold the target. The shell spells the id as a literal — it is at its 500-line budget and an import is a
 * line — so this holds it to the constant.
 */
describe("the layout the skip link is shown over", () => {
  const src = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");

  it("the shell's <main> is the focusable target", () => {
    const main = src("../layouts/AppShell.vue").match(/<main\s[^>]*>/)?.[0] ?? "";
    expect(main).toContain(`id="${MAIN_CONTENT_ID}"`);
    expect(main).toContain('tabindex="-1"');
  });

  it("App.vue shows the link over the shell and nowhere else", () => {
    const app = src("../App.vue");
    expect(app).toContain('<SkipLink v-if="isShellLayout" />');
    expect(app).toContain('const isShellLayout = computed(() => layout.value === undefined);');
  });
});
