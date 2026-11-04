import { describe, expect, it, vi } from "vitest";

/** The handler is where the ads settings reach recruiting's sweep (D-AD17). */
const ads = vi.hoisted(() => ({ uncontactedLeadMinutes: vi.fn(async () => 25), configuredAlertRecipients: vi.fn(async () => ["u-dana"]) }));
const recruiting = vi.hoisted(() => ({ sweepUncontactedLeads: vi.fn(), recruitingLeadSink: vi.fn() }));
vi.mock("../../modules/ads/index.js", () => ads);
vi.mock("../../modules/recruiting/index.js", () => recruiting);

import { leadUncontactedHandler } from "./leadUncontacted.js";
import type { JobContext, QueueJob } from "../types.js";

const ctx = { admin: { tag: "admin" }, env: {} } as unknown as JobContext;
const job = { id: "j1", org_id: "org-1", kind: "lead_uncontacted", payload: {}, attempts: 1, max_attempts: 5 } as unknown as QueueJob;

describe("leadUncontactedHandler", () => {
  it("sweeps this carrier at its own threshold, with its own list", async () => {
    recruiting.sweepUncontactedLeads.mockResolvedValue({ overdue: 1, rung: 1, contacted: 0, held: 0 });
    await expect(leadUncontactedHandler(ctx, job, vi.fn())).resolves.toMatchObject({ ok: true });
    const [admin, org, , deps] = recruiting.sweepUncontactedLeads.mock.calls[0]!;
    expect([admin, org, deps.minutes]).toEqual([ctx.admin, "org-1", 25]);
    await expect(deps.configured("org-1", "lead_uncontacted")).resolves.toEqual(["u-dana"]);
    expect(ads.configuredAlertRecipients).toHaveBeenCalledWith(ctx.admin, "org-1", "lead_uncontacted");
  });

  it("fails the job when the sweep cannot read", async () => {
    recruiting.sweepUncontactedLeads.mockRejectedValue(new Error("Could not read the uncontacted leads: down"));
    await expect(leadUncontactedHandler(ctx, job, vi.fn())).rejects.toThrow(/uncontacted leads/);
  });
});
