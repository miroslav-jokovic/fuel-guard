import { describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { AuthContext, SectionClaim, UserRole } from "@silvicom/shared";
import { requireSection, requireAnySection } from "./auth.js";
import { closeTestServer } from "../testing/httpServer.js";

/**
 * The section gates (D-PERM3, EDITABLE-PERMISSIONS-PLAN.md P3).
 *
 * 71 route gates changed shape in this step, from `requireRole(...rolesThatManage("fuel"))` to
 * `requireSection("fuel")`. The rewrite is worth nothing if it changes who gets in, and a role list
 * spread across 32 files is exactly the kind of code where a wrong answer is invisible in review.
 * So the first two blocks below assert EQUIVALENCE for a caller with no overrides — every token in
 * existence on the day 0292 applies is in that state, and this is the proof that swapping the call
 * sites was behaviour-preserving.
 *
 * The rest is what the swap was FOR: the spread form computed its role list once, at module load,
 * from the compile-time constant. It could not have honoured an override however hard it tried.
 */
function serve(auth: Partial<AuthContext>, gate: express.RequestHandler) {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "u1", email: null, orgId: "org-1", ...auth } as AuthContext;
    next();
  });
  app.get("/x", gate, (_req, res) => res.json({ ok: true }));
  return app;
}

async function status(auth: Partial<AuthContext>, gate: express.RequestHandler): Promise<number> {
  const server: Server = await new Promise((resolve) => {
    const s = serve(auth, gate).listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`);
    return res.status;
  } finally {
    await closeTestServer(server);
  }
}

const as = (role: UserRole, sections: SectionClaim | null = null) => ({ role, sections });

describe("requireSection — equivalence with the role lists it replaced", () => {
  it("admits the roles that manage the section, and nobody else", async () => {
    // `fuel: manage` is admin + fleet_manager. A dispatcher holds `fuel: view` and must be refused
    // by a manage gate — the distinction 17 call sites depend on.
    expect(await status(as("admin"), requireSection("fuel"))).toBe(200);
    expect(await status(as("fleet_manager"), requireSection("fuel"))).toBe(200);
    expect(await status(as("dispatcher"), requireSection("fuel"))).toBe(403);
    expect(await status(as("recruiter"), requireSection("fuel"))).toBe(403);
  });

  it("admits view-holders at the view level, including the ones manage refuses", async () => {
    expect(await status(as("dispatcher"), requireSection("fuel", "view"))).toBe(200);
    expect(await status(as("auditor"), requireSection("fuel", "view"))).toBe(200);
    expect(await status(as("recruiter"), requireSection("fuel", "view"))).toBe(403);
  });

  it("refuses a caller with no role at all", async () => {
    expect(await status({ role: null }, requireSection("fuel", "view"))).toBe(403);
  });

  /**
   * The property the whole rollout rests on. Every token minted before migration 0292 has no
   * `sections` claim, so it must resolve to the shipped matrix — never to denial, which would lock
   * the product out for one token lifetime.
   */
  it("resolves to the shipped matrix for a token that predates the claim", async () => {
    expect(await status({ role: "safety_manager" }, requireSection("safety"))).toBe(200);
    expect(await status({ role: "safety_manager", sections: null }, requireSection("safety"))).toBe(200);
    expect(await status({ role: "safety_manager", sections: {} }, requireSection("safety"))).toBe(200);
  });
});

describe("requireSection — what the rewrite was for", () => {
  it("admits a role its org has WIDENED into a section it does not ship with", async () => {
    // A dispatcher ships with `safety: none`. The old spread form baked its role list at module
    // load and could not have honoured this however the org configured itself.
    expect(await status(as("dispatcher"), requireSection("safety", "view"))).toBe(403);
    expect(await status(as("dispatcher", { safety: "view" }), requireSection("safety", "view"))).toBe(200);
    expect(await status(as("dispatcher", { safety: "manage" }), requireSection("safety"))).toBe(200);
  });

  it("refuses a role its org has NARROWED out of a section it does ship with", async () => {
    expect(await status(as("dispatcher"), requireSection("dispatch"))).toBe(200);
    expect(await status(as("dispatcher", { dispatch: "none" }), requireSection("dispatch"))).toBe(403);
    expect(await status(as("dispatcher", { dispatch: "none" }), requireSection("dispatch", "view"))).toBe(403);
  });

  it("keeps view and manage distinct under an override — view does not imply manage", async () => {
    expect(await status(as("dispatcher", { safety: "view" }), requireSection("safety"))).toBe(403);
    expect(await status(as("dispatcher", { safety: "view" }), requireSection("safety", "view"))).toBe(200);
  });

  it("leaves untouched sections at their default, because the claim is sparse", async () => {
    const claim: SectionClaim = { safety: "manage" };
    expect(await status(as("dispatcher", claim), requireSection("dispatch"))).toBe(200);
    expect(await status(as("dispatcher", claim), requireSection("recruitment", "view"))).toBe(403);
  });

  /**
   * The locks, at the last layer that can decline to honour a row that should not exist. Such a
   * claim cannot be minted — the hook drops it, the endpoint refuses it and 0291's CHECK constraints
   * refuse the row behind it — so honouring one here would turn a bad row into an escalation.
   */
  it("ignores a claim that would narrow an admin, so an org cannot lock itself out", async () => {
    expect(await status(as("admin", { fuel: "none" }), requireSection("fuel"))).toBe(200);
  });

  it("ignores a claim granting the admin section, which is the escalation path", async () => {
    expect(await status(as("fleet_manager", { admin: "manage" }), requireSection("admin"))).toBe(403);
  });

  it("ignores a claim for a driver, who cannot reach the web dashboard anyway", async () => {
    expect(await status(as("driver", { fuel: "manage" }), requireSection("fuel"))).toBe(403);
  });
});

describe("requireAnySection", () => {
  const door = () => requireAnySection(["roster", "view"], ["recruitment", "view"]);

  it("opens on EITHER section, which is why it is not two chained gates", async () => {
    // A dispatcher holds `roster: view` and `recruitment: none`; a recruiter holds the reverse-ish
    // pair. Both must get in, and a stack of two `requireSection` calls would refuse both.
    expect(await status(as("dispatcher"), door())).toBe(200);
    expect(await status(as("recruiter"), door())).toBe(200);
  });

  it("refuses a caller holding neither", async () => {
    expect(await status(as("accountant"), door())).toBe(403);
  });

  it("opens on an override of either side", async () => {
    expect(await status(as("accountant", { roster: "view" }), door())).toBe(200);
    expect(await status(as("accountant", { recruitment: "view" }), door())).toBe(200);
  });

  it("declares itself to the route-gate fitness function", () => {
    // routeGates.test.ts walks the mounted middleware stacks and can only see a gate that says it is
    // one; an unmarked gate reads to it as an ungated route.
    expect((door() as unknown as { gateKind: string }).gateKind).toBe("role");
    expect((requireSection("fuel") as unknown as { gateKind: string }).gateKind).toBe("role");
  });
});
