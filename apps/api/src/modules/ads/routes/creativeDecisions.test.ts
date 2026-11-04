import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, USER_ROLES, rolesThatCanView, rolesThatManage, type AuthContext, type UserRole } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { postgrestFixture, type FixtureRow } from "../../../testing/postgrestFixture.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * A person approves or rejects one creative (`POST /api/ads/campaigns/:id/creatives/:creativeId/decision`, Track S
 * S1d) through the real app, the real `ads_approvals` writer and Track W's real `decideCreative`. The store applies
 * an UPDATE's filters, so the creative's `state = 'ready'` compare-and-set is the store's answer, not the test's;
 * `beforeUpdate` is where "someone else decided first" happens.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const C = "70000000-0000-4000-8000-000000000001";
const CR = "71000000-0000-4000-8000-000000000001";
const CR2 = "71000000-0000-4000-8000-000000000002";
const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
const RECRUITER = rolesThatManage("recruitment").find((r) => r !== "admin")!;
const READ_ONLY = rolesThatCanView("recruitment").find((r) => !rolesThatManage("recruitment").includes(r))!;
const OUTSIDER = USER_ROLES.find((r) => !rolesThatCanView("recruitment").includes(r))!;
const as = (role: UserRole): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role });

let caller: AuthContext;
let server: Server;
let baseUrl = "";
let db: SupabaseRecorder;
let tables: Record<string, FixtureRow[]>;
let seq = 0;
let beforeUpdate: (() => void) | null = null;

const matching = (rows: FixtureRow[], q: RecordedQuery) =>
  rows.filter((r) => postgrestFixture([{ ...r }])({ ...q, ops: q.ops.filter((o) => o.method !== "select" && o.method !== "limit") }).length > 0);

function store(name: string) {
  return (q: RecordedQuery): FixtureRow[] => {
    const rows = tables[name]!;
    if (q.write?.method === "insert") {
      const row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, ...(q.write.payload as FixtureRow) };
      rows.push(row);
      return [row];
    }
    if (q.write?.method === "update") {
      beforeUpdate?.();
      beforeUpdate = null;
      const hit = matching(rows, q);
      for (const r of hit) Object.assign(r, q.write.payload as object);
      return hit.map((r) => ({ id: r.id }));
    }
    return postgrestFixture(rows)(q);
  };
}

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async () => caller;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

beforeEach(() => {
  caller = as(RECRUITER);
  seq = 0;
  beforeUpdate = null;
  tables = {
    ads_campaigns: [{ id: C, org_id: ORG, state: "review", connection_id: "conn", state_changed_at: "2026-11-04T10:00:00Z", platform_refs: {} }],
    ads_creatives: [
      { id: CR, org_id: ORG, campaign_id: C, state: "ready" },
      { id: CR2, org_id: ORG, campaign_id: C, state: "ready" },
    ],
    ads_approvals: [],
    ads_actions: [],
    ads_settings_versions: [{ id: "sv1", org_id: ORG, version: 1, settings: ADS_SETTINGS_UNSET, kill_switch: false, kill_reason: null, created_at: "2026-11-01T00:00:00Z", created_by_name: "Owner" }],
  };
  db = createSupabaseRecorder({ tables: Object.fromEntries(Object.keys(tables).map((t) => [t, store(t)])) });
  holder.client = db.client;
});

const call = (path: string, body: unknown) =>
  fetch(`${baseUrl}/api/ads/campaigns/${path}`, {
    method: "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;
const creative = (id = CR) => tables.ads_creatives!.find((c) => c.id === id)!;
const decisions = () => tables.ads_approvals!.filter((a) => a.kind !== "withdraw");
const withdrawals = () => tables.ads_approvals!.filter((a) => a.kind === "withdraw");

describe("POST …/creatives/:id/decision — a person's decision, recorded, then the creative moves", () => {
  it("a recruiter approves a ready ad: one approve_creative row naming it, then the ad is approved", async () => {
    const res = await call(`${C}/creatives/${CR}/decision`, { decision: "approve" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "approved" });
    expect(creative().state).toBe("approved");
    expect(decisions()).toEqual([expect.objectContaining({ kind: "approve_creative", creative_id: CR, campaign_id: C, approved_by: `u-${RECRUITER}`, settings_version_id: "sv1" })]);
    // `user_profiles` is keyed by the caller's own user id (`displayNameFor`): a person's name, not org data.
    expectOrgScoped(db, ORG, { exempt: ["user_profiles"] });
  });

  it("a rejection needs a reason, and is recorded with it", async () => {
    expect((await call(`${C}/creatives/${CR}/decision`, { decision: "reject" })).status).toBe(400);
    expect(tables.ads_approvals).toEqual([]);
    expect((await call(`${C}/creatives/${CR}/decision`, { decision: "reject", reason: "The truck is the wrong colour" })).status).toBe(200);
    expect(creative().state).toBe("rejected");
    expect(decisions()).toEqual([expect.objectContaining({ kind: "reject_creative", reason: "The truck is the wrong colour" })]);
  });

  it("the same decision pressed twice answers the same and records nothing new", async () => {
    await call(`${C}/creatives/${CR}/decision`, { decision: "approve" });
    const again = await call(`${C}/creatives/${CR}/decision`, { decision: "approve" });
    expect(again.status).toBe(200);
    expect(tables.ads_approvals).toHaveLength(1);
  });

  it("someone else decided between our check and our move: our row is withdrawn, theirs stands", async () => {
    beforeUpdate = () => { creative().state = "rejected"; };
    const res = await call(`${C}/creatives/${CR}/decision`, { decision: "approve" });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("not_ready");
    expect(creative().state).toBe("rejected");
    const [mine] = decisions();
    expect(withdrawals()).toEqual([expect.objectContaining({ withdraws_id: mine!.id, reason: "did not apply: not_ready" })]);
  });

  it("a campaign no longer in review takes no decision and records none", async () => {
    tables.ads_campaigns![0]!.state = "approved";
    const res = await call(`${C}/creatives/${CR}/decision`, { decision: "approve" });
    expect(await code(res)).toBe("campaign_not_in_review");
    expect(tables.ads_approvals).toEqual([]);
  });

  it("an ad still being made takes no decision and records none", async () => {
    creative().state = "checking";
    expect(await code(await call(`${C}/creatives/${CR}/decision`, { decision: "approve" }))).toBe("not_ready");
    expect(tables.ads_approvals).toEqual([]);
  });

  it("another carrier's campaign, or an ad of another campaign, is not found", async () => {
    tables.ads_campaigns![0]!.org_id = OTHER;
    expect((await call(`${C}/creatives/${CR}/decision`, { decision: "approve" })).status).toBe(404);
    tables.ads_campaigns![0]!.org_id = ORG;
    creative().campaign_id = "70000000-0000-4000-8000-000000000009";
    expect((await call(`${C}/creatives/${CR}/decision`, { decision: "approve" })).status).toBe(404);
    expect(tables.ads_approvals).toEqual([]);
  });

  it("who: a read-only role and an outsider cannot decide", async () => {
    for (const role of [READ_ONLY, OUTSIDER]) {
      caller = as(role);
      expect((await call(`${C}/creatives/${CR}/decision`, { decision: "approve" })).status).toBe(403);
    }
    expect(creative().state).toBe("ready");
  });
});

describe("POST …/moves {creatives_approved} — the campaign is approved only once an ad is", () => {
  it("with no ad approved yet, it is refused and the campaign stays in review", async () => {
    const res = await call(`${C}/moves`, { event: "creatives_approved" });
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("no_approved_creative");
    expect(tables.ads_campaigns![0]!.state).toBe("review");
  });

  it("after one ad is approved, the campaign moves to approved", async () => {
    await call(`${C}/creatives/${CR}/decision`, { decision: "approve" });
    const res = await call(`${C}/moves`, { event: "creatives_approved" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "approved" });
  });
});
