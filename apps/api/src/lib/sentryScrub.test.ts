import { describe, expect, it } from "vitest";
import { scrubSentryEvent, scrubString, keyIsPii } from "./sentryScrub.js";

describe("sentryScrub", () => {
  it("flags PII-bearing keys", () => {
    expect(keyIsPii("cdlNumber")).toBe(true);
    expect(keyIsPii("driver_license")).toBe(true);
    expect(keyIsPii("home_address")).toBe(true);
    expect(keyIsPii("medicalRegistryNumber")).toBe(true);
    expect(keyIsPii("loadId")).toBe(false);
  });

  it("redacts long numbers and base64 images inside free text", () => {
    expect(scrubString("CDL D1234567 on file")).toBe("CDL [redacted-number] on file");
    expect(scrubString("img=data:image/webp;base64,AAAABBBBCCCC==")).toBe("img=[redacted-image]");
  });

  it("redacts a CDL number carried in extra, whatever its shape", () => {
    const ev = scrubSentryEvent({
      message: "extraction failed for CDL 1234567",
      extra: { cdlNumber: "D1234567", loadId: "L1", nested: { dateOfBirth: "1980-01-01" } },
    });
    expect(ev.extra?.cdlNumber).toBe("[redacted]");
    expect((ev.extra?.nested as Record<string, unknown>).dateOfBirth).toBe("[redacted]");
    expect(ev.extra?.loadId).toBe("L1");
    expect(ev.message).toBe("extraction failed for CDL [redacted-number]");
  });

  it("drops request body + cookies and keeps only user.id", () => {
    const ev = scrubSentryEvent({
      request: { data: { bolBytes: "…" }, cookies: "session=abc", headers: { authorization: "Bearer x" } },
      user: { id: "u1", email: "a@b.com", ip_address: "1.2.3.4" },
    });
    expect(ev.request?.data).toBeUndefined();
    expect(ev.request?.cookies).toBeUndefined();
    expect(ev.user).toEqual({ id: "u1" });
  });
});
