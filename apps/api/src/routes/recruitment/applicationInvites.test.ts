import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@fuelguard/shared";
import { createApp } from "../../app.js";
import { loadEnv } from "../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../testing/httpServer.js";

/**
 * Inviting an applicant. The interesting assertions are all about the token: it is returned exactly
 * once, it never reaches the database in the clear, and it never reaches the audit log at all.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

/**
 * The mailer, mocked at the module boundary on `applicationNudgeSweep.test.ts`'s precedent — the
 * alternative is a test that either hits Resend or asserts nothing about whether the mail went.
 * `ok` is flipped per test to exercise the failure path, which is the half that matters most here.
 */
const mailer = vi.hoisted(() => ({
  ok: true,
  fn: vi.fn(async () => ({ ok: mailer.ok, provider: "resend", status: mailer.ok ? 200 : 422, detail: "boom" })),
}));
vi.mock("../../lib/mailer.js", () => ({ sendEmail: mailer.fn }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

const ctx = (role: string): AuthContext =>
  ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);
const CTX: Record<string, AuthContext> = {
  admin: ctx("admin"),
  recruiter: ctx("recruiter"),
  safety: ctx("safety_manager"),
  dispatcher: ctx("dispatcher"),
  auditor: ctx("auditor"),
};

let server: Server;
let baseUrl: string;

const call = (path: string, init: RequestInit & { token?: string } = {}) =>
  fetch(`${baseUrl}/api/recruitment${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

const seed = (status = "applicant"): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      drivers: [{ id: DRIVER, status }],
      application_invitations: [{ id: "inv-1", driver_id: DRIVER, expires_at: "2099-01-01T00:00:00Z" }],
      audit_logs: [],
    },
  });

const BODY = JSON.stringify({ driver_id: DRIVER, email: "s@example.test" });

beforeAll(async () => {
  // MAIL_PROVIDER has to be something other than "none", or the route short-circuits before the
  // mocked sender and every assertion below would pass by never sending anything. The `mail_disabled`
  // case gets its own app, further down, for exactly that reason.
  const app = createApp(
    loadEnv({ NODE_ENV: "test", MAIL_PROVIDER: "resend", RESEND_API_KEY: "test-key" } as NodeJS.ProcessEnv),
  );
  app.locals.verifyToken = async (t: string): Promise<AuthContext> => {
    const found = CTX[t];
    if (!found) throw new Error("bad token");
    return found;
  };
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => closeTestServer(server));

describe("creating an invitation", () => {
  it("returns the only copy of the link and stores only a hash", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("/application-invites", { method: "POST", token: "recruiter", body: BODY });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { link: string };
    const token = body.link.split("/apply/")[1]!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = rec.writtenRows("application_invitations")[0]!;
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    // The plaintext must appear nowhere in what was written.
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("keeps the token and its hash out of the audit log", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("/application-invites", { method: "POST", token: "recruiter", body: BODY });
    const token = ((await res.json()) as { link: string }).link.split("/apply/")[1]!;

    const audit = rec.writtenRows("audit_logs")[0]!;
    expect(audit.action).toBe("compliance.application_invited");
    const serialised = JSON.stringify(audit);
    expect(serialised).not.toContain(token);
    // An audit log is the last place a credential should be recoverable from — including by
    // fingerprint, which is what a hash is.
    expect(serialised).not.toMatch(/[0-9a-f]{64}/);
  });

  it("gives two invitations two different tokens", async () => {
    const links: string[] = [];
    for (let i = 0; i < 2; i++) {
      holder.client = seed().client;
      const res = await call("/application-invites", { method: "POST", token: "recruiter", body: BODY });
      links.push(((await res.json()) as { link: string }).link);
    }
    expect(links[0]).not.toBe(links[1]);
  });

  /** An application is what somebody submits BEFORE they are hired. */
  it("refuses to send the form to someone already driving here", async () => {
    const rec = seed("active");
    holder.client = rec.client;
    const res = await call("/application-invites", { method: "POST", token: "recruiter", body: BODY });
    expect(res.status).toBe(409);
    expect(rec.writtenRows("application_invitations")).toHaveLength(0);
  });

  it("scopes every read to the caller's org", async () => {
    const rec = seed();
    holder.client = rec.client;
    await call("/application-invites", { method: "POST", token: "recruiter", body: BODY });
    // `organizations` is exempt and is the textbook case for it: the read is
    // `.eq("id", orgId)` — a lookup by the tenant's own primary key, whose ownership was established
    // by `requireOrg` before the handler ran. There is no `org_id` column on that table to filter on.
    // It is read for the carrier's NAME, which is what the applicant sees in the email subject.
    expectOrgScoped(rec, ORG, { exempt: ["organizations"] });
  });

  /**
   * D (2026-08-22) — the half of A11b that never shipped.
   *
   * This route stored `email` in a column from the day it shipped and never imported a mailer, so
   * the FIRST invitation a driver ever receives was a recruiter copying a link into their own mail
   * client. The abandonment nudge — the SECOND email — has been sending since A10.
   */
  describe("the invitation is actually sent", () => {
    it("emails the applicant and reports where it went", async () => {
      mailer.ok = true;
      mailer.fn.mockClear();
      const rec = seed();
      holder.client = rec.client;
      const res = await call("/application-invites", { method: "POST", token: "recruiter", body: BODY });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { link: string; delivery: { sent: boolean; email: string | null } };
      expect(body.delivery).toEqual({ sent: true, email: "s@example.test", reason: null });
      expect(mailer.fn).toHaveBeenCalledTimes(1);
    });

    /**
     * ⚠ The assertion this route most needs. The token is not stored and not re-derivable, so an
     * invitation that rolled back because a mail provider was rate-limited would leave the applicant
     * with nothing and the recruiter with no way to recover it. The row exists, the audit row exists,
     * the link comes back, and the failure is REPORTED rather than raised.
     */
    it("still creates the invitation, and still returns the link, when the send fails", async () => {
      mailer.ok = false;
      const rec = seed();
      holder.client = rec.client;
      const res = await call("/application-invites", { method: "POST", token: "recruiter", body: BODY });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { link: string; delivery: { sent: boolean; reason: string | null } };
      expect(body.delivery.sent).toBe(false);
      expect(body.delivery.reason).toBe("send_failed");
      expect(body.link).toContain("/apply/");
      expect(rec.writtenRows("application_invitations")).toHaveLength(1);
      expect(rec.writtenRows("audit_logs")).toHaveLength(1);
      mailer.ok = true;
    });

    it("does not try to send when no address was given", async () => {
      mailer.fn.mockClear();
      const rec = seed();
      holder.client = rec.client;
      const res = await call("/application-invites", {
        method: "POST",
        token: "recruiter",
        body: JSON.stringify({ driver_id: DRIVER }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { delivery: { sent: boolean; reason: string | null } };
      expect(body.delivery).toEqual({ sent: false, email: null, reason: "no_address" });
      expect(mailer.fn).not.toHaveBeenCalled();
    });

    /**
     * `mail_disabled` and `send_failed` are distinguished on purpose: the first is an admin's problem
     * (the org has no mail provider) and the second is the applicant's address. A UI that said
     * "could not send" to both would send somebody to the wrong person.
     */
    it("says mail_disabled rather than send_failed when no provider is configured", async () => {
      mailer.fn.mockClear();
      const quiet = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
      quiet.locals.verifyToken = async (t: string): Promise<AuthContext> => CTX[t]!;
      const rec = seed();
      holder.client = rec.client;
      const srv = quiet.listen(0);
      try {
        const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/recruitment/application-invites`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: "Bearer recruiter" },
          body: BODY,
        });
        const body = (await res.json()) as { delivery: { reason: string | null } };
        expect(body.delivery.reason).toBe("mail_disabled");
        expect(mailer.fn).not.toHaveBeenCalled();
      } finally {
        await closeTestServer(srv);
      }
    });
  });

});

describe("who may invite", () => {
  it("admits the section's managers", async () => {
    for (const token of ["admin", "recruiter", "safety"]) {
      holder.client = seed().client;
      expect((await call("/application-invites", { method: "POST", token, body: BODY })).status).toBe(201);
    }
  });

  it("refuses a dispatcher, a read-only auditor and the unauthenticated", async () => {
    for (const token of ["dispatcher", "auditor"]) {
      holder.client = seed().client;
      expect((await call("/application-invites", { method: "POST", token, body: BODY })).status).toBe(403);
    }
    holder.client = seed().client;
    expect((await call("/application-invites", { method: "POST", body: BODY })).status).toBe(401);
  });
});

describe("revoking", () => {
  it("closes an open invitation and audits it", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await call("/application-invites/inv-1/revoke", { method: "POST", token: "recruiter" });
    expect(res.status).toBe(200);
    expect(rec.writtenRows("audit_logs")[0]!.action).toBe("compliance.application_invite_revoked");
  });
});
