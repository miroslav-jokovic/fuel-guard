import type { NextFunction, Request, Response } from "express";

/**
 * `Permissions-Policy` — which device features a page from this server may ask the browser for
 * (security audit 2026-11-15, finding 6; docs/plans/messaging/INSTALLED-APP-PLAN.md D-IA6).
 *
 * helmet does not send this header, so until now the answer was "whatever the browser defaults to": any
 * script that ever ran in the page — ours, or one that got in — could prompt for the microphone or the
 * location. The policy below turns OFF everything the app does not use and leaves the three it does to this
 * origin only, so a framed document can never borrow them.
 *
 * WHAT THE APP USES (measured: `git grep` over `apps/web/src` and `packages/ui/src`, 2026-11-15):
 *   · camera            — `getUserMedia`, video only: the shop's barcode camera, the licence scan on the
 *                         applicant's page, document capture. No call asks for audio.
 *   · screen-wake-lock  — the scanning screens keep the display on.
 *   · clipboard-write   — "Copy link" and its kin (`navigator.clipboard.writeText`).
 * Nothing calls geolocation, the microphone, screen capture, payment, or a USB / serial / Bluetooth / HID /
 * MIDI device.
 *
 * ⚠ ADD HERE BEFORE USING. A feature set to `()` fails in the browser as a refused permission with no
 * server-side trace — the same shape as the `frame-src` defect of 2026-09-19 (`appHttp.ts`): invisible in
 * `vite` and `preview:local`, which do not send this header. Anything not named below keeps the browser's
 * default, so a feature this list has never heard of is not broken by it.
 */
export const PERMISSIONS_POLICY: Readonly<Record<string, "self" | "none">> = {
  camera: "self",
  "screen-wake-lock": "self",
  "clipboard-write": "self",
  microphone: "none",
  geolocation: "none",
  "display-capture": "none",
  payment: "none",
  usb: "none",
  serial: "none",
  bluetooth: "none",
  hid: "none",
  midi: "none",
};

export const PERMISSIONS_POLICY_HEADER = Object.entries(PERMISSIONS_POLICY)
  .map(([feature, who]) => `${feature}=(${who === "self" ? "self" : ""})`)
  .join(", ");

export function permissionsPolicy(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY_HEADER);
  next();
}
