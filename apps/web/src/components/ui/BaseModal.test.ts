import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import BaseModal from "@/components/ui/BaseModal.vue";

// Headless UI's Dialog observes its panel; jsdom has no ResizeObserver. Without this the assertions
// all pass and the RUN still fails on unhandled rejections — the worst kind of green.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

/**
 * B5 — the centred dialog's two escape hatches, pinned. Headless UI closes on Escape and on a
 * click outside the panel; both must emit `close` or the modal is a trap. `printable` is what the
 * @media print rules in style.css key on — a renamed class would silently print a blank page.
 */
function mountModal(props: Record<string, unknown> = {}) {
  return mount(BaseModal, {
    props: { open: true, title: "A document", ...props },
    slots: { default: "<p>body</p>" },
    attachTo: document.body,
  });
}

describe("BaseModal (B5)", () => {
  it("emits close on Escape", async () => {
    const w = mountModal();
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await new Promise((r) => setTimeout(r));
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
  });

  it("emits close from the close button", async () => {
    const w = mountModal();
    await new Promise((r) => setTimeout(r)); // Headless UI portals after a tick
    const btn = document.querySelector('[aria-label="Close dialog"]') as HTMLElement;
    expect(btn).toBeTruthy();
    btn.click();
    await new Promise((r) => setTimeout(r));
    expect(w.emitted("close")).toBeTruthy();
    w.unmount();
  });

  it("applies .print-target only when printable", async () => {
    const w = mountModal({ printable: true });
    await new Promise((r) => setTimeout(r));
    expect(document.querySelector(".print-target")).toBeTruthy();
    w.unmount();
    const w2 = mountModal();
    await new Promise((r) => setTimeout(r));
    expect(document.querySelector(".print-target")).toBeFalsy();
    w2.unmount();
  });

  it("xl is max-w-4xl — the width a scanned card needs (why this exists beside SlideOver)", async () => {
    const w = mountModal({ size: "xl" });
    await new Promise((r) => setTimeout(r));
    expect(document.querySelector(".max-w-4xl")).toBeTruthy();
    w.unmount();
  });
});
