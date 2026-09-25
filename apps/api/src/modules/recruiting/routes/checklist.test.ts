import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { DRAFT_APPLYING_AS_SELECT } from "../applicantApplyingAs.js";

/**
 * Serving one applicant's checklist (B3) — who may read it, and what comes back.
 *
 * ⚠ The FOLD is pinned in `packages/shared/src/hiringChecklist.test.ts` and the READS in
 * `applicantChecklist.test.ts`. Nothing here re-checks either: this file is about the route, which
 * is a gate, a 404 and an envelope. Asserting step states through HTTP as well would be a third copy
 * of the same rules, and a third place for them to drift.
 */

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const DRIVER = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";

const ctx = (role: string): AuthContext =>
  ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role } as AuthContext);

const CTX: Record<string, AuthContext> = {
  admin: ctx("admin"),
  safety: ctx("safety_manager"),
  recruiter: ctx("recruiter"),
  auditor: ctx("auditor"),
  dispatcher: ctx("dispatcher"),
  driver: ctx("driver"),
};

let server: Server;
let baseUrl: string;

const call = (path: string, token?: string) =>
  fetch(`${baseUrl}/api/recruitment${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

const seed = (over: Record<string, unknown[]> = {}): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      drivers: [{ id: DRIVER, org_id: ORG, hire_date: null }],
      application_invitations: [],
      application_drafts: [],
      driver_authorizations: [],
      qualification_records: [],
      psp_requests: [],
      application_packet_marks: [],
      ...over,
    },
  });

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
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

describe("who may read a checklist", () => {
  /**
   * ⚠ `view`, not `manage`, and the AUDITOR is the case that proves it: `auditor` is the one role
   * with `recruitment: "view"` and not `manage`, so gating this on `manage` would refuse exactly the
   * reader a §391.51 hiring file exists for. Reading a checklist changes nothing, and every write it
   * summarises is already gated by the route that performs it, at the strength that act deserves.
   */
  it("lets everybody in the recruitment section read it, auditor included", async () => {
    for (const token of ["admin", "safety", "recruiter", "auditor"]) {
      holder.client = seed().client;
      const res = await call(`/applicants/${DRIVER}/checklist`, token);
      expect(res.status).toBe(200);
    }
  });

  it("refuses roles outside the section, and the unauthenticated", async () => {
    for (const token of ["dispatcher", "driver"]) {
      const rec = seed();
      holder.client = rec.client;
      expect((await call(`/applicants/${DRIVER}/checklist`, token)).status).toBe(403);
      // Refused in middleware: nothing about this applicant was read.
      expect(rec.queries).toHaveLength(0);
    }
    holder.client = seed().client;
    expect((await call(`/applicants/${DRIVER}/checklist`)).status).toBe(401);
  });
});

describe("what comes back", () => {
  it("carries the checklist, its counts and both readiness answers", async () => {
    holder.client = seed().client;
    const res = await call(`/applicants/${DRIVER}/checklist`, "recruiter");
    const body = (await res.json()) as {
      ok: boolean;
      checklist: {
        steps: Array<{ key: string; state: string }>;
        done: number;
        total: number;
        readyToTravel: { ok: boolean; unmeasured: string[] };
        readyToHire: { ok: boolean };
        next: string | null;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.checklist.steps.length).toBe(body.checklist.total);
    expect(body.checklist.done).toBe(0);
    expect(body.checklist.next).toBe("invitation_sent");
    // ⚠ The readiness answer names what it could not see rather than quietly saying yes — the one
    // thing about this response a client must not have to infer.
    expect(body.checklist.readyToTravel.ok).toBe(false);
    expect(body.checklist.readyToTravel.unmeasured).toContain("orientation_videos");
  });

  /**
   * ⚠ A 404 here is a MEMBERSHIP answer. The service role would read another org's driver happily,
   * so this is the check that makes every read after it safe to believe.
   */
  it("404s for a driver who is not this org's", async () => {
    const rec = seed({ drivers: [] });
    holder.client = rec.client;
    const res = await call(`/applicants/${DRIVER}/checklist`, "admin");
    expect(res.status).toBe(404);
    expect(rec.queries).toHaveLength(1);
  });

  /**
   * ⚠ No §391.21 answers, no date of birth, no licence number — by construction rather than by
   * filtering, because the fold reads the existence of rows and a set of record kinds. This asserts
   * the construction held: the draft's payload is never selected, so it can never be serialised.
   *
   * ⚠ **One key is read, by path, since Q-HM14** — `applying_as`, which decides how many places the
   * packet has. The assertion is therefore that the ONLY mention of `payload` is that one path: a
   * select that widened to `payload` or `payload->questionnaire` fails here exactly as before.
   */
  it("never selects the application's answers", async () => {
    // ⚠ Needs a live invitation, because the draft is keyed on one — without it the read is skipped
    // entirely and this test would pass by never happening.
    const rec = seed({
      application_invitations: [{
        id: "inv-1", org_id: ORG, driver_id: DRIVER, created_at: "2026-09-01T00:00:00Z",
        review_requested_at: null, approved_at: null, submitted_at: null,
      }],
    });
    holder.client = rec.client;
    await call(`/applicants/${DRIVER}/checklist`, "recruiter");
    const draftReads = rec.forTable("application_drafts");
    expect(draftReads).toHaveLength(1);
    const selected = draftReads[0]!.ops.find((o) => o.method === "select")?.args[0];
    expect(String(selected)).toContain(DRAFT_APPLYING_AS_SELECT);
    expect(String(selected).replace(DRAFT_APPLYING_AS_SELECT, "")).not.toContain("payload");
    expect(DRAFT_APPLYING_AS_SELECT).toMatch(/payload->questionnaire->>applying_as$/);
  });
});
