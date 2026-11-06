import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADS_SETTINGS_UNSET, HIRING_PROFILE_V1, USER_ROLES, rolesThatCanView, rolesThatManage,
  type AdBrandKit, type AdBrief, type AuthContext, type UserRole,
} from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { postgrestFixture, type FixtureRow } from "../../../testing/postgrestFixture.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/ads/campaigns` (Track S, S1b) through the real app, the shipped gates and recruiting's real
 * `AdBriefSource` (wired in `app.ts`): an opening saved in recruiting's tables becomes the frozen brief of
 * an `ads_campaigns` row. The tables are an in-memory store; the primary key refuses a duplicate as 23505,
 * as Postgres does, so "the same Create twice" is the database's answer, not the test's say-so.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const OPENING = "60000000-0000-4000-8000-000000000001";
const PROFILE_V = "61000000-0000-4000-8000-000000000001";
const CONN = "62000000-0000-4000-8000-000000000001";
const KIT = "63000000-0000-4000-8000-000000000001";
const SV_OLD = "64000000-0000-4000-8000-000000000001";
const SV_NEW = "64000000-0000-4000-8000-000000000002";
const NEW_ID = "65000000-0000-4000-8000-000000000001";
const THEIRS = "65000000-0000-4000-8000-000000000009";

const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
const RECRUITER = rolesThatManage("recruitment").find((r) => r !== "admin")!;
const READ_ONLY = rolesThatCanView("recruitment").find((r) => !rolesThatManage("recruitment").includes(r))!;
const OUTSIDER = USER_ROLES.find((r) => !rolesThatCanView("recruitment").includes(r))!;
const as = (role: UserRole): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role });
let caller: AuthContext;

const area = { area_label: "Joliet, IL", area_latitude: 41.525, area_longitude: -88.0817, area_radius_miles: 75, area_reason: "The terminal's daily dispatch radius" };
const facts = (min: number) => ({ pay: { per: "mile", min_cents: min, max_cents: null }, home_time: "Home weekly", equipment: ["dry_van"], lanes: null, start_date: null });

/** A fixture kit — invented for the test, never a real brand value (Q-AD14 is the owner's). */
const KIT_BODY: AdBrandKit = {
  company_name: "Fixture Carrier", phone: null, colors: [{ name: "primary", hex: "#0B3D2E" }],
  logo: null, equipment_photos: [], overlays: { "4:5": { zone: null, text_color: "#FFFFFF", plate_color: "#0B3D2E" } },
  people_policy: "none", forbidden_marks: [],
};

let server: Server;
let baseUrl = "";
let db: SupabaseRecorder;
let tables: Record<string, FixtureRow[]>;

function store(name: string) {
  return (q: RecordedQuery): FixtureRow[] | { data: null; error: unknown } => {
    const rows = tables[name]!;
    if (q.write?.method === "insert") {
      const row = q.write.payload as FixtureRow;
      if (rows.some((r) => r.id === row.id)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      rows.push(row);
      return [row];
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

/** What storage answers a signing call with; a test replaces it to make storage fail. */
let signing: (paths: string[]) => { data: Array<{ path: string; signedUrl: string | null; error: string | null }> | null; error: { message: string } | null };

beforeEach(() => {
  caller = as(RECRUITER);
  tables = {
    recruiting_openings: [{ id: OPENING, org_id: ORG, status: "open", created_at: "2026-11-01T00:00:00Z" }],
    recruiting_opening_versions: [
      { id: "v1", org_id: ORG, opening_id: OPENING, version: 1, profile_version_id: PROFILE_V, title: "Class A regional driver", facts: facts(65), ...area },
      { id: "v2", org_id: ORG, opening_id: OPENING, version: 2, profile_version_id: PROFILE_V, title: "Class A regional driver", facts: facts(68), ...area },
    ],
    hiring_profile_versions: [{ id: PROFILE_V, org_id: ORG, requirements: HIRING_PROFILE_V1 }],
    ads_settings_versions: [
      { id: SV_OLD, org_id: ORG, version: 1, settings: settingsJson(), kill_switch: false, kill_reason: null, created_at: "2026-11-01T00:00:00Z", created_by_name: "Owner" },
      { id: SV_NEW, org_id: ORG, version: 2, settings: settingsJson(), kill_switch: false, kill_reason: null, created_at: "2026-11-02T00:00:00Z", created_by_name: "Owner" },
    ],
    ads_platform_connections: [{ id: CONN, org_id: ORG, provider: "simulator", status: "connected" }],
    ad_brand_kits: [{ id: KIT, org_id: ORG, name: "Main", archived_at: null, created_at: "2026-11-01T00:00:00Z" }],
    ad_brand_kit_versions: [{ id: "kv1", org_id: ORG, kit_id: KIT, version: 1, kit: KIT_BODY, created_by_name: "Owner", created_at: "2026-11-01T00:00:00Z" }],
    ads_campaigns: [{ id: THEIRS, org_id: OTHER, name: "Theirs", state: "review", brief_source: "recruiting_opening", brief_ref: "x", created_at: "2026-11-01T00:00:00Z" }],
    ads_creatives: [],
  };
  signing = (paths) => ({ data: paths.map((path) => ({ path, signedUrl: `https://store/${path}?token=t`, error: null })), error: null });
  db = createSupabaseRecorder({
    tables: Object.fromEntries(Object.keys(tables).map((t) => [t, store(t)])),
    storage: { createSignedUrls: (paths: string[]) => signing(paths) },
  });
  holder.client = db.client;
});

/** The caps themselves do not matter to a create; a saved version does (`settings_version_id` NOT NULL). */
const settingsJson = () => ADS_SETTINGS_UNSET;

const call = (method: string, path: string, body?: unknown) =>
  fetch(`${baseUrl}/api/ads/${path}`, {
    method, headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ask = (over: Record<string, unknown> = {}) => ({
  id: NEW_ID, brief_source: "recruiting_opening", brief_ref: OPENING, connection_id: CONN, brand_kit_id: KIT, ...over,
});
const created = () => tables.ads_campaigns!.filter((r) => r.org_id === ORG);
const campaignWrites = () => db.queries.filter((q) => q.table === "ads_campaigns" && q.write);

describe("POST /api/ads/campaigns — a campaign from an opening", () => {
  it("a recruiter creates a draft whose brief is the opening's newest version, frozen, under the settings in force", async () => {
    const res = await call("POST", "campaigns", ask());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: NEW_ID });
    const [row] = created();
    expect(row).toMatchObject({
      id: NEW_ID, org_id: ORG, connection_id: CONN, brand_kit_id: KIT, settings_version_id: SV_NEW,
      brief_source: "recruiting_opening", brief_ref: `${OPENING}@v2`, name: "Class A regional driver", created_by: `u-${RECRUITER}`,
    });
    const brief = row!.brief_snapshot as AdBrief;
    expect(brief.claims).toContainEqual({ kind: "money", cents: 68, per: "mile" });
    expect(brief.claims).not.toContainEqual({ kind: "money", cents: 65, per: "mile" });
    expect(row).not.toHaveProperty("state"); // 0537's default, `draft`: nothing at the door picks a state
    expectOrgScoped(db, ORG);
  });

  it("the same Create delivered twice makes one campaign and answers with it", async () => {
    expect((await call("POST", "campaigns", ask())).status).toBe(201);
    const again = await call("POST", "campaigns", ask());
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ id: NEW_ID });
    expect(created()).toHaveLength(1);
  });

  it("an id already used for another brief is refused, and nothing is written over it", async () => {
    tables.ads_campaigns!.push({ id: NEW_ID, org_id: ORG, brief_source: "recruiting_opening", brief_ref: "70000000-0000-4000-8000-000000000001@v1" });
    const res = await call("POST", "campaigns", ask());
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("id_taken");
    expect(campaignWrites().filter((q) => q.write!.method !== "insert")).toEqual([]);
  });

  it.each([
    ["a paused opening", () => { tables.recruiting_openings![0]!.status = "paused"; }, 409, "brief_unavailable"],
    ["another carrier's opening", () => { tables.recruiting_openings![0]!.org_id = OTHER; }, 409, "brief_unavailable"],
    ["an opening with nothing saved", () => { tables.recruiting_opening_versions = []; }, 409, "brief_unavailable"],
    ["a brief source nobody provides", () => {}, 400, "brief_source_unknown"],
    ["no settings ever saved", () => { tables.ads_settings_versions = []; }, 409, "settings_not_saved"],
    ["a failing connection", () => { tables.ads_platform_connections![0]!.status = "failing"; }, 409, "connection_unusable"],
    ["another carrier's connection", () => { tables.ads_platform_connections![0]!.org_id = OTHER; }, 409, "connection_unusable"],
    ["an archived brand kit", () => { tables.ad_brand_kits![0]!.archived_at = "2026-11-03T00:00:00Z"; }, 409, "brand_kit_unusable"],
    ["a brand kit with no saved version", () => { tables.ad_brand_kit_versions = []; }, 409, "brand_kit_unusable"],
  ])("%s is refused before any row is written", async (_name, arrange, status, code) => {
    arrange();
    const res = await call("POST", "campaigns", ask(code === "brief_source_unknown" ? { brief_source: "fuel_card_offer" } : {}));
    expect(res.status).toBe(status);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
    expect(campaignWrites()).toEqual([]);
  });

  it("who: the read-only role and an outsider cannot create; an outsider cannot read", async () => {
    caller = as(READ_ONLY);
    expect((await call("POST", "campaigns", ask())).status).toBe(403);
    expect((await call("GET", "campaigns")).status).toBe(200);
    caller = as(OUTSIDER);
    expect((await call("GET", "campaigns")).status).toBe(403);
    expect(campaignWrites()).toEqual([]);
  });
});

describe("GET /api/ads/campaigns(/:id) — the list and the review screen's read", () => {
  it("lists only this carrier's campaigns", async () => {
    await call("POST", "campaigns", ask());
    const body = (await (await call("GET", "campaigns")).json()) as { campaigns: Array<{ id: string }> };
    expect(body.campaigns.map((c) => c.id)).toEqual([NEW_ID]);
    expectOrgScoped(db, ORG);
  });

  it("reads one campaign with its brief and its own creatives, oldest first", async () => {
    await call("POST", "campaigns", ask());
    tables.ads_creatives = [
      { id: "c2", org_id: ORG, campaign_id: NEW_ID, state: "check_failed", last_error: "visual: a foreign logo", created_at: "2026-11-04T10:02:00Z" },
      { id: "c1", org_id: ORG, campaign_id: NEW_ID, state: "ready", last_error: null, created_at: "2026-11-04T10:01:00Z" },
      { id: "cx", org_id: ORG, campaign_id: "65000000-0000-4000-8000-000000000002", state: "ready", created_at: "2026-11-04T10:00:00Z" },
    ];
    const body = (await (await call("GET", `campaigns/${NEW_ID}`)).json()) as { campaign: { brief_snapshot: AdBrief; creatives: Array<{ id: string; last_error: string | null }> } };
    expect(body.campaign.brief_snapshot.ref).toBe(`${OPENING}@v2`);
    expect(body.campaign.creatives.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(body.campaign.creatives[1]?.last_error).toBe("visual: a foreign logo");
    expectOrgScoped(db, ORG);
  });

  it("hands the review screen a short-lived link to each image in this carrier's folder, and none outside it", async () => {
    await call("POST", "campaigns", ask());
    const asset = { format: "1:1", language: "en", sha256: "a".repeat(64), width: 1080, height: 1080 };
    tables.ads_creatives = [{
      id: "c1", org_id: ORG, campaign_id: NEW_ID, state: "ready", created_at: "2026-11-04T10:01:00Z",
      assets: [{ ...asset, path: `${ORG}/a.png` }, { ...asset, language: "es", path: `${OTHER}/b.png` }],
    }];
    const body = (await (await call("GET", `campaigns/${NEW_ID}`)).json()) as { campaign: { creatives: Array<{ assets: Array<{ url: string | null }> }> } };
    expect(body.campaign.creatives[0]!.assets.map((a) => a.url)).toEqual([`https://store/${ORG}/a.png?token=t`, null]);
    expect(db.storageCalls()).toEqual([{ bucket: "ad-assets", fn: "createSignedUrls", args: [[`${ORG}/a.png`], 600] }]);
  });

  it("an image storage could not sign gets no link, and the others keep theirs", async () => {
    await call("POST", "campaigns", ask());
    const asset = { format: "1:1", language: "en", sha256: "a".repeat(64), width: 1080, height: 1080 };
    tables.ads_creatives = [{ id: "c1", org_id: ORG, campaign_id: NEW_ID, state: "ready", created_at: "2026-11-04T10:01:00Z", assets: [{ ...asset, path: `${ORG}/a.png` }, { ...asset, language: "es", path: `${ORG}/gone.png` }] }];
    signing = (paths) => ({ data: paths.map((path) => (path.endsWith("gone.png") ? { path, signedUrl: null, error: "Object not found" } : { path, signedUrl: `https://store/${path}?token=t`, error: null })), error: null });
    const body = (await (await call("GET", `campaigns/${NEW_ID}`)).json()) as { campaign: { creatives: Array<{ assets: Array<{ url: string | null }> }> } };
    expect(body.campaign.creatives[0]!.assets.map((a) => a.url)).toEqual([`https://store/${ORG}/a.png?token=t`, null]);
  });

  it("when storage refuses to sign at all, the read fails rather than showing a campaign with no pictures", async () => {
    await call("POST", "campaigns", ask());
    tables.ads_creatives = [{ id: "c1", org_id: ORG, campaign_id: NEW_ID, state: "ready", created_at: "2026-11-04T10:01:00Z", assets: [{ format: "1:1", language: "en", sha256: "a".repeat(64), width: 1080, height: 1080, path: `${ORG}/a.png` }] }];
    signing = () => ({ data: null, error: { message: "storage down" } });
    expect((await call("GET", `campaigns/${NEW_ID}`)).status).toBe(500);
  });

  it("a campaign with no finished image asks storage for nothing", async () => {
    await call("POST", "campaigns", ask());
    tables.ads_creatives = [{ id: "c1", org_id: ORG, campaign_id: NEW_ID, state: "generating", created_at: "2026-11-04T10:01:00Z" }];
    expect((await call("GET", `campaigns/${NEW_ID}`)).status).toBe(200);
    expect(db.storageCalls()).toEqual([]);
  });

  it("another carrier's campaign is not found, and a malformed id is a bad request", async () => {
    expect((await call("GET", `campaigns/${THEIRS}`)).status).toBe(404);
    expect((await call("GET", "campaigns/not-an-id")).status).toBe(400);
  });
});
