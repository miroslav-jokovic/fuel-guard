import { describe, it, expect, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import BaseModal from "./BaseModal.vue";
import { DIALOG_FOOTER_CLASS } from "./dialogFooter";

/**
 * The centred dialog's footer is the same row the drawer draws (`dialogFooter.ts`). Every chat dialog
 * passes its buttons bare, and until 2026-11-15 they sat at the left edge touching each other.
 */
let open: ReturnType<typeof mount> | null = null;
afterEach(() => {
  open?.unmount();
  open = null;
  document.body.innerHTML = "";
});

describe("the dialog's footer", () => {
  it("lays bare buttons out as the right-aligned row that wraps", async () => {
    open = mount(BaseModal, {
      props: { open: true, title: "A dialog" },
      slots: { footer: "<button>Cancel</button><button>Start</button>" },
      attachTo: document.body,
    });
    await nextTick();
    await nextTick();
    const el = document.querySelector('[data-test="dialog-footer"]');
    expect(el?.className.split(/\s+/)).toEqual(expect.arrayContaining(DIALOG_FOOTER_CLASS.split(" ")));
    expect(Array.from(el?.children ?? []).map((c) => c.textContent)).toEqual(["Cancel", "Start"]);
  });
});
