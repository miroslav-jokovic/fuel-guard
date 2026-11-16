import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

/**
 * Two-step sign-in, the page (INSTALLED-APP-PLAN IA-S1). What a person relies on: with an authenticator set
 * up they are asked for its code and let in when it is right; without one they are shown the QR code and the
 * key and it turns on with the first right code; a wrong code is said in words and nothing changes; a
 * half-finished set-up from an earlier visit does not block a new one; an admin who must keep it is not
 * offered Turn off; and a person the guard is holding here has Sign out but no "Not now".
 */
const mfa = vi.hoisted(() => ({
  listFactors: vi.fn(), getAuthenticatorAssuranceLevel: vi.fn(), enroll: vi.fn(), challengeAndVerify: vi.fn(), unenroll: vi.fn(),
}));
const session = vi.hoisted(() => ({
  secondFactor: null as null | Record<string, unknown>,
  syncFromClient: vi.fn(async () => {}), loadSurfaces: vi.fn(async () => {}), refresh: vi.fn(async () => {}), signOut: vi.fn(async () => {}),
}));
const push = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { mfa } }, DEV_BYPASS: false }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => session }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

import TwoStepPage from "./TwoStepPage.vue";

const VERIFIED = { id: "f-1", status: "verified", factor_type: "totp" };
const HALF = { id: "f-0", status: "unverified", factor_type: "totp" };
const OWED = { required: true, satisfied: false, has_factor: true, due_from: null, must_keep: false };

beforeEach(() => {
  for (const fn of Object.values(mfa)) fn.mockReset();
  for (const fn of [session.syncFromClient, session.loadSurfaces, session.refresh, session.signOut, push]) fn.mockClear();
  session.secondFactor = null;
  mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [] }, error: null });
  mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1" }, error: null });
  mfa.enroll.mockResolvedValue({ data: { id: "f-new", totp: { qr_code: "data:image/svg+xml;utf8,<svg/>", secret: "JBSWY3DPEHPK3PXP" } }, error: null });
  mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  mfa.unenroll.mockResolvedValue({ data: {}, error: null });
});
const mounted: VueWrapper[] = [];
afterEach(() => { for (const w of mounted.splice(0)) w.unmount(); });
async function render() {
  const w = mount(TwoStepPage);
  mounted.push(w);
  await flushPromises();
  return w;
}
const button = (w: VueWrapper, label: string) => w.findAll("button").find((b) => b.text().trim() === label);
const enter = async (w: VueWrapper, code: string) => {
  await w.find("input").setValue(code);
  await w.find("form").trigger("submit");
  await flushPromises();
};

describe("somebody with an authenticator who owes its code", () => {
  beforeEach(() => {
    session.secondFactor = OWED;
    mfa.listFactors.mockResolvedValue({ data: { totp: [VERIFIED], all: [VERIFIED] }, error: null });
  });

  it("is asked for the code, not shown a QR code, and nothing is set up again", async () => {
    const w = await render();
    expect(w.find('[data-testid="two-step-lead"]').text()).toBe("Enter the 6-digit code from your authenticator app.");
    expect(w.find("img").exists()).toBe(false);
    expect(mfa.enroll).not.toHaveBeenCalled();
    expect(mfa.unenroll).not.toHaveBeenCalled();
  });

  it("is let in by the right code: the store adopts the new session and the app opens", async () => {
    const w = await render();
    await enter(w, " 123456 ");
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "f-1", code: "123456" });
    expect(session.syncFromClient).toHaveBeenCalled();
    expect(session.loadSurfaces).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith({ name: "dashboard" });
  });

  it("is told a wrong code in words, and stays", async () => {
    mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: "Invalid TOTP code entered" } });
    const w = await render();
    await enter(w, "000000");
    expect(w.find("[role=alert]").text()).toBe("That code was not accepted. Enter the current 6-digit code from your authenticator app.");
    expect(push).not.toHaveBeenCalled();
    expect(session.syncFromClient).not.toHaveBeenCalled();
  });

  it("has Sign out and no way round, and is told what to do about a lost phone", async () => {
    const w = await render();
    expect(button(w, "Not now")).toBeUndefined();
    expect(button(w, "Back")).toBeUndefined();
    expect(w.text()).toContain("An admin of your company can remove it");
    await button(w, "Sign out")!.trigger("click");
    await flushPromises();
    expect(session.signOut).toHaveBeenCalled();
  });
});

describe("somebody without one", () => {
  it("is shown the QR code and the key, and it turns on with the first right code", async () => {
    const w = await render();
    expect(mfa.enroll).toHaveBeenCalledWith({ factorType: "totp", friendlyName: "Authenticator app", issuer: "Silvicom 360" });
    expect(w.find("img").attributes("src")).toContain("data:image/svg+xml");
    expect(w.find('[data-testid="two-step-secret"]').text()).toBe("JBSWY3DPEHPK3PXP");
    await enter(w, "654321");
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: "f-new", code: "654321" });
    expect(push).toHaveBeenCalledWith({ name: "dashboard" });
  });

  it("clears a set-up that was started and never finished, and never a finished one", async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [HALF] }, error: null });
    await render();
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "f-0" });
    expect(mfa.enroll).toHaveBeenCalledTimes(1);
  });

  it("may leave it for later when nothing requires it", async () => {
    const w = await render();
    await button(w, "Not now")!.trigger("click");
    expect(push).toHaveBeenCalledWith({ name: "dashboard" });
  });

  it("an admin past their date may not leave it for later", async () => {
    session.secondFactor = { required: true, satisfied: false, has_factor: false, due_from: null, must_keep: true };
    const w = await render();
    expect(w.find("img").exists()).toBe(true);
    expect(button(w, "Not now")).toBeUndefined();
  });

  it("says it could not prepare, with a way to retry, rather than a code box with nothing behind it", async () => {
    mfa.enroll.mockResolvedValue({ data: null, error: { message: "MFA enroll is disabled" } });
    const w = await render();
    expect(w.text()).toContain("Could not prepare two-step sign-in.");
    expect(w.find("form").exists()).toBe(false);
  });
});

describe("somebody who has it on", () => {
  beforeEach(() => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [VERIFIED], all: [VERIFIED] }, error: null });
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal2" }, error: null });
  });

  it("is told so, and can turn it off — with a new token afterwards", async () => {
    session.secondFactor = { ...OWED, satisfied: true };
    const w = await render();
    expect(w.text()).toContain("Two-step sign-in is on.");
    expect(w.find("form").exists()).toBe(false);
    await button(w, "Turn off two-step sign-in")!.trigger("click");
    await flushPromises();
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "f-1" });
    expect(session.refresh).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith({ name: "dashboard" });
  });

  it("is not offered Turn off when the role must keep it", async () => {
    session.secondFactor = { ...OWED, satisfied: true, must_keep: true };
    const w = await render();
    expect(button(w, "Turn off two-step sign-in")).toBeUndefined();
    expect(w.find('[data-testid="two-step-must-keep"]').text()).toBe("Admins are required to use it, so it cannot be turned off.");
  });
});
