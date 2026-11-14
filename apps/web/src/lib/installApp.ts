import { computed, ref } from "vue";
import { isIosDevice, isStandalone } from "@/lib/webPush";

/**
 * Putting Silvicom 360 on this device as an app (docs/plans/messaging/CHAT-WEB-PUSH-PLAN.md WP6, D-WP15).
 *
 * WHY THIS EXISTS. The site has been installable since WP2 (manifest + icons), and nothing said so. The owner
 * opened it on a phone on 2026-11-14 and saw no offer, which is what every phone does on its own:
 *   · Chrome, Edge and Samsung Internet on Android keep "Install app" inside the ⋮ menu and show nothing
 *     unless the page asks. What they give the page is `beforeinstallprompt` — an event to hold on to and
 *     `prompt()` from a press. It fires once per page load, early, so it is caught HERE, at import, by
 *     `listenForInstallOffer()` in `main.ts`; a component that mounted later would have missed it.
 *   · Safari on an iPhone or iPad has no such event and no API at all: the only way in is the person's own
 *     Share → Add to Home Screen. All the page can do is say so — and there it matters most, because an
 *     iPhone gets no chat notification until the site is opened from the Home Screen (D-WP5).
 *   · Firefox on Android has neither; it is offered nothing rather than steps that may not match its menu.
 *
 * WHAT IS OFFERED is a fact about the browser (`installWay`); WHETHER THE STRIP SHOWS is the person's choice
 * on top of it (`installStripShown`). "Not now" is kept per browser and is final for the strip — an offer
 * that returns every visit is the nag this must not become — while the account menu's "Install app" stays
 * for as long as the browser can still do it, so the answer is never lost.
 */

const DISMISSED_KEY = "fg.install.dismissed";

/** Chromium's event; not in lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  // A property, not a method signature: `lint:ui-adoption` reads a bare `prompt(` as the browser's dialog.
  prompt: () => Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallWay = "prompt" | "ios-steps";

/**
 * The two things an iPhone owner does, in the words the chat rail already used for them (D-WP5). One
 * definition: the rail's notification steps and the install strip read these, so they cannot drift.
 */
export const IOS_INSTALL_STEPS = [
  "Tap Share, then Add to Home Screen.",
  "Open Silvicom from your Home Screen and sign in.",
] as const;

const held = ref<BeforeInstallPromptEvent | null>(null);
const installed = ref(false);
const dismissed = ref(readDismissed());
/** The account menu's "Install app" brings the strip back for this page load, whatever was dismissed. */
const asked = ref(false);

/**
 * An iPhone or iPad looking at the site in a browser tab. Read once per page load: neither half can change
 * under a running page — the Home Screen copy is a separate load with its own storage.
 */
const iosTab = ref(readIosTab());
const handheld = ref(typeof navigator !== "undefined" && isHandheld());

function readIosTab(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  return isIosDevice() && !isStandalone();
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false; // Safari private mode throws on localStorage
  }
}

/** A phone or a tablet: where the strip offers itself. A PC has the address bar's own install icon. */
export function isHandheld(nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> = navigator): boolean {
  return isIosDevice(nav) || /Android/.test(nav.userAgent);
}

/** How this browser can install the app right now — null when it cannot, or already has. */
export const installWay = computed<InstallWay | null>(() => {
  if (installed.value) return null;
  if (held.value) return "prompt";
  return iosTab.value ? "ios-steps" : null;
});

/** The strip above the page: on a handheld that has not said "Not now", or anywhere once asked for. */
export const installStripShown = computed(() =>
  installWay.value !== null && (asked.value || (!dismissed.value && handheld.value)));

/** Call once, before the app mounts: the browser's offer comes early and only once per load. */
export function listenForInstallOffer(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    // Chrome on Android would otherwise show its own mini-bar on some versions and nothing on others;
    // holding the event makes the offer ours on all of them.
    e.preventDefault();
    held.value = e as BeforeInstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    installed.value = true;
    held.value = null;
  });
}

/**
 * Show the browser's own install dialog. The event is good for ONE prompt: whatever the answer, it is let go,
 * and Chromium fires a new one on a later load if the person said no.
 */
export async function installApp(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const e = held.value;
  if (!e) return "unavailable";
  held.value = null;
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === "accepted") installed.value = true;
    else dismissInstall(); // "Cancel" in the browser's dialog is the same answer as Not now
    return outcome;
  } catch {
    return "unavailable";
  }
}

export function dismissInstall(): void {
  dismissed.value = true;
  asked.value = false;
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch { /* the strip stays hidden for this load; the next one asks once more */ }
}

/** From the account menu: the strip, with its button or its steps, whatever was dismissed before. */
export function askToInstall(): void {
  asked.value = true;
}

/** Tests only: module state back to a fresh page load. */
export function resetInstallStateForTests(): void {
  held.value = null;
  installed.value = false;
  asked.value = false;
  dismissed.value = readDismissed();
  iosTab.value = readIosTab();
  handheld.value = isHandheld();
}
