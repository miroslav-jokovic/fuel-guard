import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { chatShortcutOf, useChatShortcuts, type ChatShortcut } from "./useChatShortcuts";

/**
 * The page's keys (CR2, D-CHATUI16): `/`, J and K are shortcuts only where nothing is being typed and
 * no modifier is held — a `/` typed into the composer is a slash, ⌘K is the browser's.
 */
const press = (key: string, over: Partial<Parameters<typeof chatShortcutOf>[0]> = {}) =>
  chatShortcutOf({ key, metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, target: document.body, ...over });

describe("chatShortcutOf", () => {
  it("reads / as the search, J and K as the next and the previous item, and nothing else", () => {
    expect(press("/")).toBe("search");
    expect(press("j")).toBe("next");
    expect(press("k")).toBe("previous");
    expect(press("J")).toBeNull();
    expect(press("Enter")).toBeNull();
  });

  it("stays out of the way while typing, inside a dialog or a menu, and under a modifier", () => {
    document.body.innerHTML = `<input /><textarea></textarea><div role="dialog"><button></button></div><div role="menu"><button></button></div>`;
    expect(press("/", { target: document.querySelector("input") })).toBeNull();
    expect(press("j", { target: document.querySelector("textarea") })).toBeNull();
    expect(press("j", { target: document.querySelector("[role='dialog'] button") })).toBeNull();
    expect(press("k", { target: document.querySelector("[role='menu'] button") })).toBeNull();
    expect(press("k", { metaKey: true })).toBeNull();
    expect(press("/", { ctrlKey: true })).toBeNull();
    expect(press("/", { defaultPrevented: true })).toBeNull();
    document.body.innerHTML = "";
  });
});

describe("useChatShortcuts", () => {
  it("hands each shortcut to the page while mounted, keeping the key from the browser, and not after", () => {
    const got: ChatShortcut[] = [];
    const w = mount(defineComponent({ setup() { useChatShortcuts((s) => got.push(s)); return {}; }, template: "<div />" }));
    const slash = new KeyboardEvent("keydown", { key: "/", cancelable: true });
    window.dispatchEvent(slash);
    expect(got).toEqual(["search"]);
    expect(slash.defaultPrevented).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    expect(got).toEqual(["search"]);
    w.unmount();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
    expect(got).toEqual(["search"]);
  });
});
