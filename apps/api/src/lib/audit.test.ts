import { describe, expect, it, vi } from "vitest";
import { writeAudit } from "./audit.js";

const entry = { orgId: "org-1", action: "test.event", entity: "test", entityId: "row-1" };

describe("writeAudit", () => {
  it("retries once and reports success when the audit insert recovers", async () => {
    const insert = vi.fn()
      .mockResolvedValueOnce({ error: { message: "temporary" } })
      .mockResolvedValueOnce({ error: null });
    const admin = { from: () => ({ insert }) } as never;
    await expect(writeAudit(admin, entry)).resolves.toBe(true);
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("reports an audit outage after bounded retries instead of pretending it succeeded", async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: "down" } });
    const admin = { from: () => ({ insert }) } as never;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(writeAudit(admin, entry)).resolves.toBe(false);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      "[audit] write failed after retry",
      expect.objectContaining({ action: entry.action, orgId: entry.orgId, error: "down" }),
    );
    error.mockRestore();
  });
});
