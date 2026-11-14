import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * The install offer (CHAT-WEB-PUSH-PLAN WP6, D-WP15), against fake browser parts: what each kind of device is
 * offered, that the browser's event is prompted once and from a press, that "Not now" is final for the strip
 * and not for the account menu, and that an installed app is offered nothing.
 */
/** What `GET /api/chat/push/devices` answers: the person's notification devices, or — null — a refusal. */
let deviceLabels: string[] | null = [];
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async () => deviceLabels === null
    ? { ok: false, status: 403, error: { code: "module_disabled", message: "" } }
    : { ok: true, status: 200, data: { devices: deviceLabels.map((device_label, i) => ({ id: String(i), device_label, created_at: "", last_seen_at: "", last_success_at: null, last_failure_at: null })) } }),
}));

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FIREFOX_ANDROID = "Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0";

let standalone = false;
function device(ua: string) {
  vi.stubGlobal("navigator", { userAgent: ua, maxTouchPoints: /Windows/.test(ua) ? 0 : 5, standalone });
  window.matchMedia = ((q: string) => ({ matches: standalone && q.includes("standalone") })) as unknown as typeof window.matchMedia;
}

/** Chromium's offer, as the browser dispatches it. */
function offer(outcome: "accepted" | "dismissed" = "accepted") {
  const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: ReturnType<typeof vi.fn>; userChoice: Promise<{ outcome: string }> };
  e.prompt = vi.fn(async () => undefined);
  e.userChoice = Promise.resolve({ outcome });
  window.dispatchEvent(e);
  return e;
}

async function load() {
  const lib = await import("@/lib/installApp");
  lib.resetInstallStateForTests();
  return lib;
}

// The repo's jsdom has no `localStorage` (useColorScheme.test.ts says why), so this suite installs one.
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

beforeEach(async () => {
  standalone = false;
  deviceLabels = [];
  localStorage.clear();
  const lib = await import("@/lib/installApp");
  if (!(globalThis as { __installListening?: boolean }).__installListening) {
    lib.listenForInstallOffer();
    (globalThis as { __installListening?: boolean }).__installListening = true;
  }
});
afterEach(() => vi.unstubAllGlobals());

describe("what a device is offered", () => {
  it("an Android phone whose browser offers an install gets the button, and the browser's own bar is held back", async () => {
    device(ANDROID);
    const lib = await load();
    expect(lib.installWay.value).toBeNull();
    const e = offer();
    expect(e.defaultPrevented).toBe(true);
    expect(lib.installWay.value).toBe("prompt");
    expect(lib.installStripShown.value).toBe(true);
  });

  it("an iPhone in a Safari tab gets the Home Screen steps; opened from the Home Screen it gets nothing", async () => {
    device(IPHONE);
    const lib = await load();
    expect(lib.installWay.value).toBe("ios-steps");
    expect(lib.installStripShown.value).toBe(true);
    standalone = true;
    device(IPHONE);
    const again = await load();
    again.askToInstall(); // even when asked for: there is nothing left to install
    expect(again.installWay.value).toBeNull();
    expect(again.installStripShown.value).toBe(false);
  });

  it("a browser with neither an offer nor Safari's Home Screen is offered nothing", async () => {
    device(FIREFOX_ANDROID);
    const lib = await load();
    expect(lib.installWay.value).toBeNull();
    expect(lib.installStripShown.value).toBe(false);
  });

  it("a PC is not shown the strip unasked, and gets it from the account menu", async () => {
    device(WINDOWS);
    const lib = await load();
    offer();
    expect(lib.installWay.value).toBe("prompt");
    expect(lib.installStripShown.value).toBe(false);
    lib.askToInstall();
    expect(lib.installStripShown.value).toBe(true);
  });
});

describe("installing", () => {
  it("prompts the browser's event once, and an accepted install ends the offer", async () => {
    device(ANDROID);
    const lib = await load();
    const e = offer("accepted");
    expect(await lib.installApp()).toBe("accepted");
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(lib.installWay.value).toBeNull();
    expect(await lib.installApp()).toBe("unavailable");
    expect(e.prompt).toHaveBeenCalledTimes(1);
  });

  it("cancelling the browser's dialog is Not now: the strip stays away on the next load's offer", async () => {
    device(ANDROID);
    const lib = await load();
    offer("dismissed");
    expect(await lib.installApp()).toBe("dismissed");
    const next = await load(); // a later page load
    offer();
    expect(next.installWay.value).toBe("prompt");
    expect(next.installStripShown.value).toBe(false);
  });

  it("the browser reporting the app installed ends the offer", async () => {
    device(ANDROID);
    const lib = await load();
    offer();
    window.dispatchEvent(new Event("appinstalled"));
    expect(lib.installWay.value).toBeNull();
  });
});

describe("Not now", () => {
  it("is kept for this browser, and the account menu still brings the strip back", async () => {
    device(IPHONE);
    const lib = await load();
    lib.dismissInstall();
    expect(lib.installStripShown.value).toBe(false);
    const next = await load();
    expect(next.installStripShown.value).toBe(false);
    expect(next.installWay.value).toBe("ios-steps");
    next.askToInstall();
    expect(next.installStripShown.value).toBe(true);
  });
});

describe("InstallAppBar", () => {
  it("on Android shows one Install button that opens the browser's dialog", async () => {
    device(ANDROID);
    await load();
    const e = offer();
    const Bar = (await import("@/components/InstallAppBar.vue")).default;
    const w = mount(Bar);
    const install = w.findAll("button").find((b) => b.text() === "Install");
    expect(install).toBeDefined();
    await install!.trigger("click");
    expect(e.prompt).toHaveBeenCalledTimes(1);
  });

  it("on an iPhone shows the Home Screen steps and no Install button, and Close removes it", async () => {
    device(IPHONE);
    const lib = await load();
    const Bar = (await import("@/components/InstallAppBar.vue")).default;
    const w = mount(Bar);
    expect(w.find("[data-testid='install-app-bar']").exists()).toBe(false); // nothing until the server has answered
    await flushPromises();
    for (const step of lib.IOS_INSTALL_STEPS) expect(w.text()).toContain(step);
    expect(w.findAll("button").map((b) => b.text())).toEqual(["Close"]);
    await w.find("button").trigger("click");
    await nextTick();
    expect(w.find("[data-testid='install-app-bar']").exists()).toBe(false);
  });

  it("on an iPhone whose owner already gets notifications on an iPhone, the strip never shows and stays away", async () => {
    device(IPHONE);
    deviceLabels = ["Chrome on Windows", "Safari on iPhone"];
    const lib = await load();
    const Bar = (await import("@/components/InstallAppBar.vue")).default;
    const w = mount(Bar);
    await flushPromises();
    expect(w.find("[data-testid='install-app-bar']").exists()).toBe(false);
    expect((await load()).installStripShown.value).toBe(false); // a later load does not ask again
    expect(lib.installWay.value).toBe("ios-steps"); // the account menu can still show the steps
  });

  it("another kind of device, or a server that will not say, leaves the steps showing", async () => {
    device(IPHONE);
    const Bar = (await import("@/components/InstallAppBar.vue")).default;
    for (const labels of [["Safari on iPad", "Chrome on Android", "Safari on Mac"], null]) {
      deviceLabels = labels;
      await load();
      const w = mount(Bar);
      await flushPromises();
      expect(w.find("[data-testid='install-app-bar']").exists()).toBe(true);
      w.unmount();
    }
  });
});
