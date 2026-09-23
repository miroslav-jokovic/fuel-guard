import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { loadEnv } from "../../../env.js";
import { mintStepUpToken, STEP_UP_TOKEN_HEADER } from "../../../lib/stepUpToken.js";

/**
 * The two doors onto a reset (0363, PASSWORD-RESET-PLAN.md): the public one and the admin's.
 *
 *  · THE PUBLIC `request` SAYS ONE THING. An address with an account, one without, and a driver's
 *    all get the same status and the same body — the enumeration a reset form is famous for.
 *  · THE ADMIN NEVER HOLDS THE LINK (D-PWR8). The success body is `{ sent, expiresAt }`, and a deploy
 *    with no mail refuses rather than falling back to "copy it yourself".
 *  · THE ADMIN DOOR IS STEP-UP GATED, and the real `requireFreshAuth` is mounted here — a mocked gate
 *    would pass with the gate deleted from the route.
 *  · IT IS ORG-SCOPED BEFORE IT IS ANYTHING ELSE: a user who is not a member of the caller's org is a
 *    404, with no reset issued.
 */
const ORG = "00000000-0000-4000-8000-00000000000a";
const ADMIN = "00000000-0000-4000-8000-000000000001";
const MEMBER = "00000000-0000-4000-8000-000000000002";
const DRIVER = "00000000-0000-4000-8000-000000000003";
const STRANGER = "00000000-0000-4000-8000-000000000009";

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  WEB_APP_URL: "https://app.example.test",
  MAIL_PROVIDER: "brevo",
  BREVO_API_KEY: "test-key",
} as NodeJS.ProcessEnv);
const locals = vi.hoisted(() => ({ env: null as unknown }));
const mails = vi.hoisted(() => ({ sent: [] as Array<{ to: string[]; text: string }> }));

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: locals.env }) }));
vi.mock("../../../lib/mailer.js", () => ({
  makeSender: () => async (m: { to: string[]; text: string }) => {
    mails.sent.push(m);
    return true;
  },
}));
vi.mock("../../../lib/audit.js", () => ({ writeAudit: vi.fn(async () => true) }));
vi.mock("../../../middleware/auth.js", async () => {
  const actual = await vi.importActual<typeof import("../../../middleware/auth.js")>("../../../middleware/auth.js");
  return {
    ...actual,
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
      req.auth = { userId: ADMIN, orgId: ORG, role: (req.header("x-test-role") ?? "admin") as "admin", email: "admin@example.test" };
      next();
    },
  };
});

const { publicPasswordResetRouter, __drainPasswordResetWork } = await import("./publicPasswordReset.js");
const { memberPasswordResetRouter } = await import("./memberPasswordReset.js");

async function call(
  base: string,
  router: () => express.Router,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const app = express();
  app.use(express.json());
  app.use(base, router());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  } finally {
    await closeTestServer(server);
  }
}

/** Memberships by user in ORG, answered on the filters the query actually applied. */
const roles: Record<string, string> = { [ADMIN]: "admin", [MEMBER]: "dispatcher", [DRIVER]: "driver" };

function seed(candidateRoles: string[] = ["dispatcher"]) {
  rec = createSupabaseRecorder({
    tables: {
      memberships: (q) => {
        const f = Object.fromEntries(q.filters().map((x) => [x.col, x.val]));
        const role = f.org_id === ORG ? roles[f.user_id as string] : undefined;
        return role ? [{ role }] : [];
      },
      password_resets: (q) => (q.write?.method === "insert" ? [{ id: "reset-1" }] : []),
    },
    rpc: (fn) =>
      fn === "password_reset_candidates"
        ? candidateRoles.map((role) => ({ user_id: MEMBER, org_id: ORG, role, joined_at: "2026-09-01T00:00:00Z" }))
        : null,
    auth: { getUserById: (id: unknown) => ({ data: { user: { id, email: "pavlin@silvicominc.com" } }, error: null }) },
  });
}

const stepUp = (): Record<string, string> => ({ [STEP_UP_TOKEN_HEADER]: mintStepUpToken(env, ADMIN, ORG)!.token });
const resetMember = (userId: string, headers: Record<string, string> = stepUp()) =>
  call("/api/members", memberPasswordResetRouter, `/${userId}/password-reset`, {}, headers);

beforeEach(() => {
  vi.clearAllMocks();
  mails.sent = [];
  locals.env = env;
  seed();
});

describe("POST /api/public/password-reset/request", () => {
  it("answers an address with an account, one without, and a driver's with the same status and body", async () => {
    const answers: Array<{ status: number; json: unknown }> = [];
    for (const candidates of [["dispatcher"], [], ["driver"]]) {
      seed(candidates);
      answers.push(await call("/api/public/password-reset", publicPasswordResetRouter, "/request", { email: "pavlin@silvicominc.com" }));
      await __drainPasswordResetWork();
    }
    expect(answers[0]!.status).toBe(202);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    // …and only the first actually sent anything.
    expect(mails.sent).toHaveLength(1);
  });

  it("refuses a body that is not an email address before doing any work", async () => {
    const res = await call("/api/public/password-reset", publicPasswordResetRouter, "/request", { email: "not-an-address" });
    expect(res.status).toBe(400);
    expect(rec.queries).toHaveLength(0);
  });
});

describe("POST /api/public/password-reset/lookup and /redeem", () => {
  it("refuses an unknown token with the one dead-link answer", async () => {
    const res = await call("/api/public/password-reset", publicPasswordResetRouter, "/lookup", { token: "q".repeat(43) });
    expect(res).toMatchObject({ status: 404, json: { error: { code: "invalid_link" } } });
  });

  it("refuses a password shorter than the shared rule before touching the database", async () => {
    const res = await call("/api/public/password-reset", publicPasswordResetRouter, "/redeem", { token: "q".repeat(43), password: "short-pass" });
    expect(res.status).toBe(400);
    expect(rec.queries).toHaveLength(0);
  });
});

describe("POST /api/members/:userId/password-reset", () => {
  it("emails the member and answers WITHOUT the link", async () => {
    const res = await resetMember(MEMBER);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ sent: true, expiresAt: expect.any(String) });
    expect(JSON.stringify(res.json)).not.toContain("reset-password");
    expect(mails.sent[0]!.to).toEqual(["pavlin@silvicominc.com"]);
    const inserted = rec.forTable("password_resets").filter((q) => q.write?.method === "insert");
    expect(inserted.map((q) => q.write!.payload)).toEqual([
      expect.objectContaining({ user_id: MEMBER, org_id: ORG, requested_by: ADMIN, token_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    ]);
    expectOrgScoped(rec, ORG, {
      // Person-keyed by design (D-PWR4, passwordReset.ts header): the revoke of the previous live
      // link is by user_id across orgs, after the org-scoped membership read above has admitted them.
      exempt: ["password_resets"],
    });
  });

  it("needs a fresh password confirmation — without the step-up token it is refused and nothing is sent", async () => {
    const res = await resetMember(MEMBER, {});
    expect(res).toMatchObject({ status: 403, json: { error: { code: "step_up_required" } } });
    expect(mails.sent).toHaveLength(0);
    expect(rec.queries).toHaveLength(0);
  });

  it("is admin-only", async () => {
    const res = await resetMember(MEMBER, { ...stepUp(), "x-test-role": "dispatcher" });
    expect(res.status).toBe(403);
    expect(mails.sent).toHaveLength(0);
  });

  it("answers 404 for somebody who is not a member of the caller's org, and issues nothing", async () => {
    const res = await resetMember(STRANGER);
    expect(res.status).toBe(404);
    expect(rec.writtenRows("password_resets")).toHaveLength(0);
  });

  it("refuses a driver-app login and points at the Drivers page", async () => {
    const res = await resetMember(DRIVER);
    expect(res).toMatchObject({ status: 400, json: { error: { code: "roster_managed" } } });
    expect(mails.sent).toHaveLength(0);
  });

  it("refuses an office member whose address also holds a driver login elsewhere", async () => {
    seed(["dispatcher", "driver"]);
    const res = await resetMember(MEMBER);
    expect(res).toMatchObject({ status: 400, json: { error: { code: "not_resettable" } } });
    expect(mails.sent).toHaveLength(0);
  });

  it("refuses the admin's own account — that is what Forgot password is for", async () => {
    const res = await resetMember(ADMIN);
    expect(res).toMatchObject({ status: 400, json: { error: { code: "cannot_reset_self" } } });
  });

  it("refuses, rather than handing over a link, when the deploy has no mail", async () => {
    locals.env = { ...env, MAIL_PROVIDER: "none" };
    const res = await resetMember(MEMBER);
    expect(res).toMatchObject({ status: 503, json: { error: { code: "mail_disabled" } } });
    expect(rec.writtenRows("password_resets")).toHaveLength(0);
  });
});
