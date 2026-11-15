import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
const SendDocumentsLink = (await import("./SendDocumentsLink.vue")).default;

/**
 * "Send a documents link" on the office's drawer (Q-AM19, 0608): one press, and the office reads back
 * where the link went — or that it did not go and the link to pass on by hand — and when it ends.
 */
const show = () => mount(SendDocumentsLink, { props: { invitationId: "inv 1" }, global: { plugins: [VueQueryPlugin] } });
const ok = (delivery: unknown) => ({ ok: true, data: { link: "https://app.test/apply/abc", expiresAt: "2026-11-28T15:00:00.000Z", delivery } });
const press = async (w: ReturnType<typeof show>) => { await w.find("button").trigger("click"); await flushPromises(); };

beforeEach(() => apiFetch.mockReset());

describe("sending a documents link", () => {
  it("posts for this application, and says where it was e-mailed and until when", async () => {
    apiFetch.mockResolvedValue(ok({ sent: true, email: "s@example.test", reason: null }));
    const w = show();
    await press(w);
    expect(apiFetch).toHaveBeenCalledWith("/api/recruitment/applications/inv%201/documents-link", { method: "POST" });
    const said = w.find("[data-documents-link-sent]").text();
    expect(said).toContain("E-mailed to s@example.test.");
    expect(said).toContain("It works until 11/28/2026.");
    expect((w.find("input").element as HTMLInputElement).value).toBe("https://app.test/apply/abc");
  });

  it("⚠ says it was NOT e-mailed when there is no address, and still shows the link to pass on", async () => {
    apiFetch.mockResolvedValue(ok({ sent: false, email: null, reason: "no_address" }));
    const w = show();
    await press(w);
    expect(w.find("[data-documents-link-sent]").text()).toMatch(/Not e-mailed: there is no e-mail address.*Read or text them the link below/);
    expect((w.find("input").element as HTMLInputElement).value).toBe("https://app.test/apply/abc");
  });

  it("says the e-mail did not go when the provider refused it", async () => {
    apiFetch.mockResolvedValue(ok({ sent: false, email: "s@example.test", reason: "send_failed" }));
    const w = show();
    await press(w);
    expect(w.find("[data-documents-link-sent]").text()).toContain("The e-mail did not go.");
  });

  it("⚠ shows the server's own sentence when it may not be sent, and no link", async () => {
    apiFetch.mockResolvedValue({ ok: false, error: { code: "already_filed", message: "This application is filed, and a photo sent now would not reach the file. Upload the document here instead." } });
    const w = show();
    await press(w);
    expect(w.find("[role='alert']").text()).toContain("Upload the document here instead.");
    expect(w.find("[data-documents-link-sent]").exists()).toBe(false);
  });

  it("drops the earlier link from the screen when a second send is refused: that link may no longer be the live one", async () => {
    apiFetch.mockResolvedValueOnce(ok({ sent: true, email: "s@example.test", reason: null }));
    const w = show();
    await press(w);
    expect(w.find("button").text()).toBe("Send a new link");
    apiFetch.mockResolvedValueOnce({ ok: false, error: { code: "link_changed", message: "That application changed while you were looking at it. Reload and try again." } });
    await press(w);
    expect(w.find("[data-documents-link-sent]").exists()).toBe(false);
    expect(w.find("[role='alert']").text()).toContain("Reload and try again.");
  });

  it("says each send replaces the last, before anything is pressed", () => {
    expect(show().text()).toContain("Each one you send replaces the last.");
  });
});
