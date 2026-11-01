import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ConfirmHost from "./ConfirmHost.vue";
import { useConfirm } from "../lists/confirm";

/** D-US7 — the product's confirm, in place of `window.confirm`. */
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);

describe("ConfirmHost", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
  });

  async function host() {
    const w = mount(ConfirmHost, { attachTo: document.body });
    await flushPromises();
    return w;
  }

  it("asks with the act's own verb and answers yes from that button", async () => {
    const w = await host();
    const answer = useConfirm()({ title: "Retire truck 811?", message: "Its history is kept.", confirmLabel: "Retire", tone: "danger" });
    await flushPromises();
    expect(document.body.textContent).toContain("Retire truck 811?");
    expect(document.body.textContent).toContain("Its history is kept.");
    expect(button("OK")).toBeUndefined();
    button("Retire")!.click();
    expect(await answer).toBe(true);
    w.unmount();
  });

  it("answers no from Cancel", async () => {
    const w = await host();
    const answer = useConfirm()({ title: "Delete this plan?", confirmLabel: "Delete", tone: "danger" });
    await flushPromises();
    button("Cancel")!.click();
    expect(await answer).toBe(false);
    w.unmount();
  });

  it("says no in the page's own word when it is given one", async () => {
    const w = await host();
    const answer = useConfirm()({ title: "¿Quitar este trabajo?", confirmLabel: "Quitar", cancelLabel: "Cancelar", tone: "danger" });
    await flushPromises();
    expect(button("Cancel")).toBeUndefined();
    button("Cancelar")!.click();
    expect(await answer).toBe(false);
    w.unmount();
  });

  it("answers the first question no when a second is asked, rather than stacking two dialogs", async () => {
    const w = await host();
    const ask = useConfirm();
    const first = ask({ title: "First?", confirmLabel: "Yes" });
    const second = ask({ title: "Second?", confirmLabel: "Go" });
    expect(await first).toBe(false);
    await flushPromises();
    expect(document.body.textContent).toContain("Second?");
    button("Go")!.click();
    expect(await second).toBe(true);
    w.unmount();
  });
});
