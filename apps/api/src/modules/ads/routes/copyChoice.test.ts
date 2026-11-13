import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADS_SETTINGS_UNSET, AD_FORMATS, rolesThatCanView, rolesThatManage, type AuthContext, type UserRole } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { postgrestFixture, type FixtureRow } from "../../../testing/postgrestFixture.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { ART_DIRECTOR_EVAL, COPYWRITER_EVAL, loadFixtures } from "../workers/agentFixtures.js";

/**
 * A person chooses an ad's words (`POST /api/ads/campaigns/:id/creatives/:creativeId/words`, ADS-AD-LOOK-PLAN Q-ADL7)
 * through the real app, the real door (`campaigns/copyChoice.ts`), the real copy and overlay checks, the real
 * `ads_approvals` writer and the real `decideCreative`. The campaign's `regenerate` move is the one stand-in: its
 * own suite (`campaignMoves.test.ts`) runs it through the machine, and here it is enough to know it was asked for.
 */
const holder = vi.hoisted(() => ({ client: null as unknown, moves: [] as Array<{ event: string }> }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));
vi.mock("../campaigns/campaignDoors.js", async (orig) => ({
  ...(await orig<object>()),
  personMove: vi.fn(async (_a: unknown, _o: unknown, _actor: unknown, _c: unknown, ask: { event: string }) => {
    holder.moves.push(ask);
    return { kind: "moved", to: "composing" };
  }),
}));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const C = "70000000-0000-4000-8000-000000000001";
const CR = "71000000-0000-4000-8000-000000000001";
const KIT = "72000000-0000-4000-8000-000000000001";
const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
const RECRUITER = rolesThatManage("recruitment").find((r) => r !== "admin")!;
const READ_ONLY = rolesThatCanView("recruitment").find((r) => !rolesThatManage("recruitment").includes(r))!;
const as = (role: UserRole): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role });

// Real recorded copy (the copywriter's `age-floor`) and a real art recipe, so the checks run on model words.
const copyFx = loadFixtures(COPYWRITER_EVAL).find((f) => f.fixture.name === "age-floor")!.fixture;
const artFx = loadFixtures(ART_DIRECTOR_EVAL).find((f) => f.fixture.name === "tractor-on-highway")!.fixture;
const offered = (copyFx.recorded!.output as { candidates: Array<{ en: Record<string, string>; es: Record<string, string> }> }).candidates;
const RECIPE = { ...artFx.input.recipe, copy_slots: copyFx.input.recipe.copy_slots, overlay_slots: { headline: "hook", cta: "cta" } };
const KIT_BODY = { ...artFx.input.kit, overlays: Object.fromEntries(AD_FORMATS.map((f) => [f, { zone: null, text_color: "#FFFFFF", plate_color: "#0B3D2E" }])) };
const CANDIDATES = { ranked: offered.slice(0, 2).map((copy, i) => ({ copy, judged: null, total: null, offered_as: i })), chosen: 0, judge: null, offered: 3, passed: 2 };

let caller: AuthContext;
let server: Server;
let baseUrl = "";
let db: SupabaseRecorder;
let tables: Record<string, FixtureRow[]>;
let seq = 0;

const matching = (rows: FixtureRow[], q: RecordedQuery) =>
  rows.filter((r) => postgrestFixture([{ ...r }])({ ...q, ops: q.ops.filter((o) => o.method !== "select" && o.method !== "limit") }).length > 0);
function store(name: string) {
  return (q: RecordedQuery): FixtureRow[] => {
    const rows = tables[name]!;
    if (q.write?.method === "insert") {
      const row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, created_at: "2026-11-12T12:00:00Z", ...(q.write.payload as FixtureRow) };
      rows.push(row);
      return [row];
    }
    if (q.write?.method === "update") {
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
  holder.moves.length = 0;
  tables = {
    ads_campaigns: [{ id: C, org_id: ORG, state: "review", brief_snapshot: copyFx.input.brief, brand_kit_id: KIT, connection_id: "conn", state_changed_at: "2026-11-12T10:00:00Z", platform_refs: {} }],
    ads_creatives: [{ id: CR, org_id: ORG, campaign_id: C, state: "ready", preset_version_id: "pv-1", copy: offered[0], candidates: CANDIDATES }],
    ad_concept_preset_versions: [{ id: "pv-1", org_id: ORG, recipe: RECIPE }],
    ad_brand_kits: [{ id: KIT, org_id: ORG, name: "Main", archived_at: null, created_at: "2026-11-01T00:00:00Z" }],
    ad_brand_kit_versions: [{ id: "kv1", org_id: ORG, kit_id: KIT, version: 1, kit: KIT_BODY, created_by_name: "Owner", created_at: "2026-11-01T00:00:00Z" }],
    ads_copy_choices: [],
    ads_approvals: [],
    ads_actions: [],
    ads_settings_versions: [{ id: "sv1", org_id: ORG, version: 1, settings: ADS_SETTINGS_UNSET, kill_switch: false, kill_reason: null, created_at: "2026-11-01T00:00:00Z", created_by_name: "Owner" }],
  };
  db = createSupabaseRecorder({ tables: Object.fromEntries(Object.keys(tables).map((t) => [t, store(t)])) });
  holder.client = db.client;
});

const choose = (body: unknown) => fetch(`${baseUrl}/api/ads/campaigns/${C}/creatives/${CR}/words`, {
  method: "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const creative = () => tables.ads_creatives![0]!;
const choices = () => tables.ads_copy_choices!;

describe("POST …/creatives/:id/words — a person chooses an ad's words (Q-ADL7)", () => {
  it("picking another offered copy as it is: the choice is recorded, the ad is rejected for that reason, and the campaign regenerates", async () => {
    const res = await choose({ from_candidate: 1, copy: offered[1] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ replaced: CR });
    expect(choices()).toEqual([expect.objectContaining({ replaces_creative_id: CR, campaign_id: C, from_candidate: 1, edited_slots: [], copy: offered[1], chosen_by: `u-${RECRUITER}` })]);
    expect(creative().state).toBe("rejected");
    expect(tables.ads_approvals).toEqual([expect.objectContaining({ kind: "reject_creative", creative_id: CR, reason: expect.stringContaining("words were chosen by a person") })]);
    expect(holder.moves).toEqual([expect.objectContaining({ event: "regenerate" })]);
    // `user_profiles` is keyed by the caller's own user id (`displayNameFor`): a person's name, not org data.
    expectOrgScoped(db, ORG, { exempt: ["user_profiles"] });
  });

  it("an edited line is recorded as edited, measured against the copy the person started from", async () => {
    const copy = { en: { ...offered[0]!.en, cta: "Apply in two minutes." }, es: offered[0]!.es };
    expect((await choose({ from_candidate: null, copy })).status).toBe(200);
    expect(choices()[0]).toMatchObject({ from_candidate: null, edited_slots: ["cta"] });
  });

  it("words that state what the brief does not are refused with the line named, and nothing is written", async () => {
    const copy = { en: { ...offered[0]!.en, hook: "$0.95 a mile for Class A OTR drivers." }, es: offered[0]!.es };
    const res = await choose({ from_candidate: 0, copy });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string }; copy: Array<{ slot: string; language: string; kind: string }> };
    expect(body.error.code).toBe("words_refused");
    expect(body.copy).toEqual([expect.objectContaining({ slot: "hook", language: "en", kind: "money_not_in_brief" })]);
    expect([choices().length, tables.ads_approvals!.length, holder.moves.length, creative().state]).toEqual([0, 0, 0, "ready"]);
  });

  it("a headline the image cannot hold is refused by the overlay's own check before anything is written", async () => {
    const long = "Class A OTR drivers, this is the run you have been waiting for all along";
    const copy = { en: { ...offered[0]!.en, hook: long }, es: { ...offered[0]!.es, hook: long } };
    const res = await choose({ from_candidate: 0, copy });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { overlay: Array<{ format: string; findings: Array<{ kind: string }> }> };
    expect(body.overlay.length).toBeGreaterThan(0);
    expect(choices()).toEqual([]);
  });

  it("every slot of the preset, in both languages, or nothing: a missing line is refused by name", async () => {
    const { cta: _gone, ...rest } = offered[0]!.en;
    const res = await choose({ from_candidate: 0, copy: { en: rest, es: offered[0]!.es } });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("slots_mismatch");
  });

  it("the same choice pressed again finishes what the first began; a different one is refused", async () => {
    await choose({ from_candidate: 1, copy: offered[1] });
    tables.ads_campaigns![0]!.state = "composing";
    expect((await choose({ from_candidate: 1, copy: offered[1] })).status).toBe(200);
    expect(choices()).toHaveLength(1);
    const other = await choose({ from_candidate: 0, copy: offered[0] });
    expect(((await other.json()) as { error: { code: string } }).error.code).toBe("chosen_differently");
  });

  it("an ad that is not waiting for review, or a campaign that is not, takes no choice", async () => {
    creative().state = "approved";
    expect(((await (await choose({ from_candidate: 1, copy: offered[1] })).json()) as { error: { code: string } }).error.code).toBe("not_ready");
    creative().state = "ready";
    tables.ads_campaigns![0]!.state = "approved";
    expect(((await (await choose({ from_candidate: 1, copy: offered[1] })).json()) as { error: { code: string } }).error.code).toBe("campaign_not_in_review");
    expect(choices()).toEqual([]);
  });

  it("a person who can only view the campaign cannot choose its words", async () => {
    caller = as(READ_ONLY);
    expect((await choose({ from_candidate: 1, copy: offered[1] })).status).toBe(403);
    expect(choices()).toEqual([]);
  });
});
