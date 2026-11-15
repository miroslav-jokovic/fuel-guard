import { describe, expect, it } from "vitest";
import { deviceLabel } from "./deviceLabel.js";
import { memberSessionsResponseSchema, sessionDeviceLabel } from "./memberSessionsContract.js";

/**
 * Signed-in devices, the shared half (INSTALLED-APP-PLAN IA-S3): how a session's device is named from the user
 * agent the auth server recorded, and the list's shape.
 */
const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1";

describe("sessionDeviceLabel", () => {
  it("names a browser exactly as that browser names itself in the notifications list", () => {
    expect(sessionDeviceLabel(CHROME_WIN)).toBe("Chrome on Windows");
    expect(sessionDeviceLabel(SAFARI_IPHONE)).toBe("Safari on iPhone");
    for (const ua of [CHROME_WIN, SAFARI_IPHONE]) expect(sessionDeviceLabel(ua)).toBe(deviceLabel(ua));
  });

  it("keeps the name of something that is not a browser, instead of calling it one", () => {
    expect(sessionDeviceLabel("okhttp/4.12.0")).toBe("okhttp/4.12.0");
    expect(sessionDeviceLabel("Expo/1017 CFNetwork/1568 Darwin/24.4.0 (iPhone)")).toBe("Expo/1017 on iPhone");
    expect(sessionDeviceLabel("Dalvik/2.1.0 (Linux; U; Android 14; SM-S911U)")).toBe("Dalvik/2.1.0 on Android");
  });

  it("says so when there is no user agent, and never returns an endless one", () => {
    expect(sessionDeviceLabel(null)).toBe("Unknown device");
    expect(sessionDeviceLabel("   ")).toBe("Unknown device");
    expect(sessionDeviceLabel("x".repeat(500)).length).toBe(60);
  });
});

describe("the list", () => {
  const row = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", device: "Chrome on Windows", created_at: "2026-11-01T14:00:00+00:00", last_used_at: "2026-11-15T16:00:00+00:00", ip: null, current: true };
  it("holds a device with no address, and refuses one with no id", () => {
    expect(memberSessionsResponseSchema.safeParse({ sessions: [row] }).success).toBe(true);
    expect(memberSessionsResponseSchema.safeParse({ sessions: [{ ...row, id: "everything" }] }).success).toBe(false);
  });
});
