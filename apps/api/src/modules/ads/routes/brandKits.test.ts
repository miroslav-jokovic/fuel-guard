import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { USER_ROLES, rolesThatCanView, rolesThatManage, type AdBrandKit, type AdPresetRecipe, type AuthContext, type UserRole } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { postgrestFixture, type FixtureRow } from "../../../testing/postgrestFixture.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/ads/brand-kits` and `/api/ads/presets` (C1) through the real app and the shipped gates. The four
 * tables are an in-memory store that enforces what 0537 enforces and a save depends on — `unique (parent,
 * version)` and `unique (org_id, key)` as 23505 — so "two saves at once" is the database's refusal, not
 * the test's say-so. Who may do what is read from the permission matrix, as `connections.test.ts` does.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const env = loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
const MANAGER = rolesThatManage("recruitment").find((r) => r !== "admin")!;
const OUTSIDER = USER_ROLES.find((r) => !rolesThatCanView("recruitment").includes(r))!;
const as = (role: UserRole): AuthContext => ({ userId: `u-${role}`, email: `${role}@x.test`, orgId: ORG, role });
let caller: AuthContext;

/** A fixture kit — invented for the test, never a real brand value (Q-AD14 is the owner's). */
const KIT: AdBrandKit = {
  company_name: "Fixture Carrier", phone: null, colors: [{ name: "primary", hex: "#0B3D2E" }],
  logo: null, equipment_photos: [], overlays: { "4:5": { zone: null, text_color: "#FFFFFF", plate_color: "#0B3D2E" } },
  people_policy: "none", forbidden_marks: [],
};
const RECIPE: AdPresetRecipe = {
  name: "Fixture preset", hook_formula: "Lead with the pay figure.", copy_slots: ["hook", "pay", "cta"],
  image_prompt_template: "An empty highway at {time_of_day}, no text, no logos, no lettering", image_slots: ["time_of_day"],
  starts_from: "text_only", shows_equipment: false, shows_people: false, motion_template: null, formats: ["4:5"],
};

let server: Server;
let baseUrl = "";
let db: SupabaseRecorder;
let tables: Record<string, FixtureRow[]>;
let objects: Map<string, Buffer>;
let seq = 0;
/** Runs just before an insert lands — where a test puts "another save got there first". */
let beforeInsert: ((table: string) => void) | null = null;

const UNIQUE: Record<string, string[]> = {
  ad_brand_kit_versions: ["kit_id", "version"],
  ad_concept_preset_versions: ["preset_id", "version"],
  ad_concept_presets: ["org_id", "key"],
};

/** Insert / select / delete over `tables`, refusing a duplicate on 0537's unique keys as Postgres does. */
function store(name: string) {
  return (q: RecordedQuery): FixtureRow[] | { data: null; error: unknown } => {
    const rows = tables[name]!;
    if (q.write?.method === "insert") {
      beforeInsert?.(name);
      const row: FixtureRow = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, created_at: `2026-11-03T10:00:${String(seq).padStart(2, "0")}Z`, archived_at: null, ...(q.write.payload as FixtureRow) };
      const key = UNIQUE[name];
      if (key && rows.some((r) => key.every((k) => r[k] === row[k]))) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      rows.push(row);
      return [row];
    }
    const hit = postgrestFixture(rows)({ ...q, ops: q.ops.filter((o) => q.write?.method !== "delete" || o.method !== "select") });
    if (q.write?.method === "delete") tables[name] = rows.filter((r) => !hit.includes(r));
    return hit;
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
  caller = as("admin");
  seq = 0;
  beforeInsert = null;
  objects = new Map();
  tables = { ad_brand_kits: [], ad_brand_kit_versions: [], ad_concept_presets: [], ad_concept_preset_versions: [] };
  db = createSupabaseRecorder({
    tables: Object.fromEntries(Object.keys(tables).map((t) => [t, store(t)])),
    storage: {
      createSignedUploadUrl: (key: string) => ({ data: { signedUrl: `https://storage.test/${key}` }, error: null }),
      download: (key: string) => objects.has(key) ? { data: new Blob([new Uint8Array(objects.get(key)!)]), error: null } : { data: null, error: { message: "Object not found" } },
      upload: (key: string, bytes: Buffer) => (objects.set(key, Buffer.from(bytes)), { data: { path: key }, error: null }),
      remove: (keys: string[]) => (keys.forEach((k) => objects.delete(k)), { data: [], error: null }),
    },
  });
  holder.client = db.client;
});

function call(method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}/api/ads/${path}`, {
    method,
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const adWrites = () => db.queries.filter((q) => q.table.startsWith("ad_") && q.write);
const adQueriesScoped = () => expectOrgScoped({ ...db, queries: db.queries.filter((q) => q.table.startsWith("ad_")) } as SupabaseRecorder, ORG);

describe("/api/ads brand kits and presets — who may do what", () => {
  it("anyone who can see recruitment reads kits and presets; an outsider cannot", async () => {
    caller = as(MANAGER);
    expect((await call("GET", "brand-kits")).status).toBe(200);
    expect((await call("GET", "presets")).status).toBe(200);
    caller = as(OUTSIDER);
    expect((await call("GET", "brand-kits")).status).toBe(403);
    expect((await call("GET", "presets")).status).toBe(403);
  });

  it("only an admin uploads, saves a kit or saves a preset — a manager of recruitment may not", async () => {
    caller = as(MANAGER);
    for (const [path, body] of [
      ["brand-kits/assets/upload-url", {}],
      ["brand-kits/assets", { upload_id: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b" }],
      ["brand-kits", { kit_id: null, name: "Main", kit: KIT }],
      ["presets", { key: "P1", enabled: true, recipe: RECIPE }],
    ] as const) expect((await call("POST", path, body)).status, path).toBe(403);
    expect(adWrites()).toEqual([]);
    expect(db.storageCalls()).toEqual([]);
  });
});

describe("a save is a new version, never an edit", () => {
  it("makes a kit at version 1, adds version 2 on the next save, and reads back the newest with who saved it", async () => {
    const first = await call("POST", "brand-kits", { kit_id: null, name: "Main", kit: KIT });
    expect(first.status).toBe(201);
    const { parent_id, version } = await first.json() as { parent_id: string; version: number };
    expect(version).toBe(1);
    const second = await call("POST", "brand-kits", { kit_id: parent_id, kit: { ...KIT, company_name: "Fixture Carrier Inc." } });
    expect(await second.json()).toMatchObject({ parent_id, version: 2 });
    expect(tables.ad_brand_kit_versions!.map((v) => [v.version, (v.kit as AdBrandKit).company_name, v.created_by_name])).toEqual([[1, "Fixture Carrier", expect.any(String)], [2, "Fixture Carrier Inc.", expect.any(String)]]);
    expect(adWrites().every((q) => q.write!.method === "insert")).toBe(true);
    const { brand_kits } = await (await call("GET", "brand-kits")).json() as { brand_kits: Array<{ name: string; current: { version: number; body: AdBrandKit } }> };
    expect(brand_kits).toEqual([expect.objectContaining({ name: "Main", current: expect.objectContaining({ version: 2, body: expect.objectContaining({ company_name: "Fixture Carrier Inc." }) }) })]);
    adQueriesScoped();
  });

  it("refuses a second save that read the same version (409) and keeps one version 2", async () => {
    const { parent_id } = await (await call("POST", "brand-kits", { kit_id: null, name: "Main", kit: KIT })).json() as { parent_id: string };
    // Another save writes version 2 after this save read "newest is 1" and before its own insert lands.
    beforeInsert = (t) => {
      if (t !== "ad_brand_kit_versions") return;
      beforeInsert = null;
      tables.ad_brand_kit_versions!.push({ id: "other", org_id: ORG, kit_id: parent_id, version: 2, kit: KIT, created_by: "u-x", created_by_name: "X", created_at: "2026-11-03T10:00:00Z" });
    };
    const res = await call("POST", "brand-kits", { kit_id: parent_id, kit: KIT });
    expect(res.status).toBe(409);
    expect(tables.ad_brand_kit_versions!.filter((v) => v.version === 2)).toHaveLength(1);
  });

  it("removes a kit it just made when that kit's version 1 is refused, so no kit is left with no version", async () => {
    beforeInsert = (t) => {
      if (t !== "ad_brand_kit_versions") return;
      beforeInsert = null;
      const made = tables.ad_brand_kits!.at(-1)!;
      // A colliding version 1 — the only way to make the database refuse this insert from a test.
      tables.ad_brand_kit_versions!.push({ id: "other", org_id: ORG, kit_id: made.id, version: 1, kit: KIT, created_by: "u-x", created_by_name: "X", created_at: "2026-11-03T10:00:00Z" });
    };
    expect((await call("POST", "brand-kits", { kit_id: null, name: "Main", kit: KIT })).status).toBe(409);
    expect(tables.ad_brand_kits).toEqual([]);
  });

  it("refuses a new version of another org's kit, and of an archived kit", async () => {
    tables.ad_brand_kits!.push({ id: "11111111-1111-4111-8111-111111111111", org_id: "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", name: "Theirs", archived_at: null });
    expect((await call("POST", "brand-kits", { kit_id: "11111111-1111-4111-8111-111111111111", kit: KIT })).status).toBe(404);
    tables.ad_brand_kits!.push({ id: "22222222-2222-4222-8222-222222222222", org_id: ORG, name: "Old", archived_at: "2026-11-01T00:00:00Z" });
    expect((await call("POST", "brand-kits", { kit_id: "22222222-2222-4222-8222-222222222222", kit: KIT })).status).toBe(409);
    expect(tables.ad_brand_kit_versions).toEqual([]);
  });

  it("refuses a kit naming a logo nobody uploaded here, and writes no kit row", async () => {
    const logo = { sha256: "a".repeat(64), format: "png", source_format: "png", width: 10, height: 10, byte_size: 100 };
    const res = await call("POST", "brand-kits", { kit_id: null, name: "Main", kit: { ...KIT, logo } });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ sha256: ["a".repeat(64)] });
    expect(tables.ad_brand_kits).toEqual([]);
  });

  it("uploads a logo, then saves a kit naming it", async () => {
    const { upload_id } = await (await call("POST", "brand-kits/assets/upload-url", {})).json() as { upload_id: string };
    objects.set(`${ORG}/incoming/${upload_id}`, await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).png().toBuffer());
    const accepted = await call("POST", "brand-kits/assets", { upload_id });
    expect(accepted.status).toBe(200);
    const { asset } = await accepted.json() as { asset: AdBrandKit["logo"] };
    expect((await call("POST", "brand-kits", { kit_id: null, name: "Main", kit: { ...KIT, logo: asset } })).status).toBe(201);
  });

  it("answers 422 naming the format when the uploaded .png is a PDF", async () => {
    const { upload_id } = await (await call("POST", "brand-kits/assets/upload-url", {})).json() as { upload_id: string };
    objects.set(`${ORG}/incoming/${upload_id}`, Buffer.from("%PDF-1.4\n%%EOF\n"));
    const res = await call("POST", "brand-kits/assets", { upload_id });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: "unsupported_format" } });
  });

  it("makes a preset on its first save, versions it after, and records `enabled` on each version", async () => {
    expect(await (await call("POST", "presets", { key: "P1", enabled: true, recipe: RECIPE })).json()).toMatchObject({ version: 1 });
    expect(await (await call("POST", "presets", { key: "P1", enabled: false, recipe: RECIPE })).json()).toMatchObject({ version: 2 });
    expect(tables.ad_concept_presets).toHaveLength(1);
    const { presets } = await (await call("GET", "presets")).json() as { presets: Array<{ key: string; current: { version: number; enabled: boolean } }> };
    expect(presets).toEqual([expect.objectContaining({ key: "P1", current: expect.objectContaining({ version: 2, enabled: false }) })]);
    adQueriesScoped();
  });

  it("refuses a new version of an archived preset (409), writing no version", async () => {
    tables.ad_concept_presets!.push({ id: "33333333-3333-4333-8333-333333333333", org_id: ORG, key: "P2", archived_at: "2026-11-01T00:00:00Z" });
    expect((await call("POST", "presets", { key: "P2", enabled: true, recipe: RECIPE })).status).toBe(409);
    expect(tables.ad_concept_preset_versions).toEqual([]);
  });

  it("refuses a recipe whose template names a slot it does not declare (400), writing nothing", async () => {
    const res = await call("POST", "presets", { key: "P1", enabled: true, recipe: { ...RECIPE, image_slots: [] } });
    expect(res.status).toBe(400);
    expect(adWrites()).toEqual([]);
  });
});
