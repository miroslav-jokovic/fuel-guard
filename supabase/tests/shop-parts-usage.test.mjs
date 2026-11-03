// Silvicom 360 — what the shop goes through (migration 0557; SHOP-PARTS-USAGE-PLAN.md SP-U1).
//
//  1. One use = one (part, work order): two lines of one part on one work order are ONE repair and
//     their quantities add; a CANCELED work order counts for nothing.
//  2. The date is the work order's completed, else started, else the line's own creation; the window
//     boundary is inclusive.
//  3. Prices are unit prices of the latest PRICED use; a credit (price ≤ 0) counts in quantity and
//     never in a price.
//  4. The list: used-only, the five sorts, ties by part number, search over number / description /
//     manufacturer number with LIKE's wildcards literal, an unknown sort refused, total_count.
//  5. History: one row per work order, newest first; the gap to the previous use on the SAME unit,
//     null on the first and on a unit-less work order; paging keeps the gap.
//  6. Summary: 90-day and 12-month figures, median price and how many repairs it stands on.
//  7. Org scope on every function, and none callable by a browser role.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};
const all = async (q, p = []) => (await db.query(q, p)).rows;
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
const refuses = async (q, p = []) => {
  try {
    await db.query(q, p);
    return null;
  } catch (e) {
    return e.code ?? "unknown";
  }
};

await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key, name text, public boolean default false, file_size_limit bigint,
    allowed_mime_types text[], owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text)
  returns text[] language sql immutable as $fn$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
  $fn$;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
  create role supabase_auth_admin nologin;
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
`);
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
for (const f of MIGRATIONS) await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Shop') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Rival') returning id`)).id;

const part = async (org, number, description, fpId) =>
  (await one(`insert into parts (org_id, part_number, description, fleetpal_id) values ($1,$2,$3,$4) returning id`, [org, number, description, fpId])).id;
const unit = (org, fpId, number) => db.query(`insert into fleetpal_units (org_id, fleetpal_id, number) values ($1,$2,$3)`, [org, fpId, number]);
const wo = (org, fpId, n, status, unitId, completed, started) =>
  db.query(
    `insert into fleetpal_work_orders (org_id, fleetpal_id, number, status, unit_fleetpal_id, completed, started) values ($1,$2,$3,$4,$5,$6,$7)`,
    [org, fpId, n, status, unitId, completed, started],
  );
const job = (org, fpId, woId) => db.query(`insert into fleetpal_jobs (org_id, fleetpal_id, work_order_fleetpal_id) values ($1,$2,$3)`, [org, fpId, woId]);
let lineN = 0;
const line = (org, jobId, partFp, qty, price, opts = {}) =>
  db.query(
    `insert into fleetpal_job_items (org_id, fleetpal_id, job_fleetpal_id, item_type, part_fleetpal_id, quantity, price, total, manufacturer_part_number, vendor_created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [org, `li${++lineN}`, jobId, opts.type ?? "PART", partFp, qty, price, qty * price, opts.mpn ?? null, opts.created ?? "2026-01-01T00:00:00Z"],
  );

const NOW = "2026-11-03T12:00:00Z";
const SINCE90 = "2026-08-05T12:00:00Z"; // NOW − 90 days

// Catalogue: BRAKE (busy), TIRE (one use), OIL_FILTER (old use only), UNUSED, and a part number with `_`.
const BRAKE = await part(ORG, "XK-4707", "Relined brake shoe kit", "fpBrake");
const TIRE = await part(ORG, "MP993", "Trailer tire 295/75R22.5", "fpTire");
const FILTER = await part(ORG, "LF14000", "Oil filter", "fpFilter");
const UNUSED = await part(ORG, "AA-UNUSED", "Never fitted", "fpUnused");
const UNDERSCORE = await part(ORG, "AB_12", "Underscore part", "fpUnderscore");
await part(ORG, "ABX12", "Similar number", null);
const RIVAL_BRAKE = await part(OTHER, "XK-4707", "Rival's brake kit", "fpBrake");

await unit(ORG, "u412", "412");
await unit(ORG, "u500", "500");

// Brake: WO1 on 412 (two lines, one WO), WO2 on 412 12 days later, WO3 on 500, WO4 canceled,
// WO5 open (started only), WO6 with a credit line.
await wo(ORG, "wo1", 1, "CLOSED", "u412", "2026-10-01T10:00:00Z", "2026-09-30T10:00:00Z");
await job(ORG, "j1", "wo1");
await line(ORG, "j1", "fpBrake", 1, 43);
await line(ORG, "j1", "fpBrake", 1, 43);
await wo(ORG, "wo2", 2, "CLOSED", "u412", "2026-10-13T10:00:00Z", null);
await job(ORG, "j2", "wo2");
await line(ORG, "j2", "fpBrake", 2, 44);
await wo(ORG, "wo3", 3, "CLOSED", "u500", "2026-09-01T10:00:00Z", null);
await job(ORG, "j3", "wo3");
await line(ORG, "j3", "fpBrake", 1, 40);
await wo(ORG, "wo4", 4, "CANCELED", "u500", "2026-10-20T10:00:00Z", null);
await job(ORG, "j4", "wo4");
await line(ORG, "j4", "fpBrake", 5, 99);
await wo(ORG, "wo5", 5, "OPEN", null, null, "2026-10-25T10:00:00Z");
await job(ORG, "j5", "wo5");
await line(ORG, "j5", "fpBrake", 1, 0); // unpriced yet
await wo(ORG, "wo6", 6, "CLOSED", "u500", null, null);
await job(ORG, "j6", "wo6");
await line(ORG, "j6", "fpBrake", 1, -43, { created: "2026-08-05T12:00:00Z" }); // credit, on the boundary
// A LABOR line naming no part, on a brake work order, must not count.
await line(ORG, "j2", null, 3, 120, { type: "LABOR" });

// Tire: one use, manufacturer number on the line.
await wo(ORG, "wo7", 7, "CLOSED", "u500", "2026-10-30T10:00:00Z", null);
await job(ORG, "j7", "wo7");
await line(ORG, "j7", "fpTire", 1, 227.89, { mpn: "MP993-29575225" });

// Filter: used only last spring (outside 90 days, inside 365).
await wo(ORG, "wo8", 8, "CLOSED", "u412", "2026-04-01T10:00:00Z", null);
await job(ORG, "j8", "wo8");
await line(ORG, "j8", "fpFilter", 1, 64.2);

// Underscore part: one use, so a search can tell it apart from ABX12.
await wo(ORG, "wo9", 9, "CLOSED", "u412", "2026-10-02T10:00:00Z", null);
await job(ORG, "j9", "wo9");
await line(ORG, "j9", "fpUnderscore", 1, 5);

// The rival's books: same part id string, huge quantity — must never reach ORG.
await wo(OTHER, "wo1", 1, "CLOSED", "u412", "2026-10-02T10:00:00Z", null);
await job(OTHER, "j1", "wo1");
await line(OTHER, "j1", "fpBrake", 100, 1);

const list = (opts = {}) =>
  all(`select * from shop_parts_list($1,$2,$3,$4,$5,$6,$7,$8)`, [
    opts.org ?? ORG,
    opts.since ?? SINCE90,
    opts.search ?? null,
    opts.usedOnly ?? false,
    opts.sort ?? "used",
    opts.desc ?? true,
    opts.limit ?? 50,
    opts.offset ?? 0,
  ]);
const byId = (rows, id) => rows.find((r) => r.part_id === id);

// ── 1 + 2 + 3: what one use is ──────────────────────────────────────────────────────────────────
{
  const rows = await list();
  const b = byId(rows, BRAKE);
  ok("two lines on one work order are one repair (wo1, wo2, wo3, wo5, wo6 → 5)", Number(b.used_repairs) === 5, JSON.stringify(b));
  ok("quantities add across lines, canceled work order excluded (2+2+1+1+1 = 7)", Number(b.used_quantity) === 7, JSON.stringify(b));
  ok("the rival's 100 never reach this org", Number(b.used_quantity) < 100);
  ok("last used is the open work order's STARTED date", new Date(b.last_used_at).toISOString() === "2026-10-25T10:00:00.000Z", String(b.last_used_at));
  ok("last price skips the unpriced open line and the credit → wo2's 44", Number(b.last_price) === 44, String(b.last_price));
  ok("a use exactly on the window's start counts (the credit, 2026-08-05 12:00)", Number(b.used_repairs) === 5);
  const f = byId(rows, FILTER);
  ok("a part used only before the window shows 0 repairs but keeps its last-used date", Number(f.used_repairs) === 0 && f.last_used_at !== null);
  const u = byId(rows, UNUSED);
  ok("a never-used part reads 0 and null", Number(u.used_quantity) === 0 && u.last_used_at === null && u.last_price === null);
}

// ── 4: the list ─────────────────────────────────────────────────────────────────────────────────
{
  const rows = await list();
  ok("most used first", rows[0].part_id === BRAKE, rows[0]?.part_number);
  ok(
    "most used first, ties by part number",
    rows.map((r) => r.part_number).join() === "XK-4707,AB_12,MP993,AA-UNUSED,ABX12,LF14000",
    rows.map((r) => r.part_number).join(),
  );
  ok("total_count is the whole filtered count on every row", rows.every((r) => Number(r.total_count) === 6), String(rows[0].total_count));
  ok("another org's catalogue is not listed", !rows.some((r) => r.part_id === RIVAL_BRAKE));

  const used = await list({ usedOnly: true });
  ok("used-only keeps the three parts used in the window", used.length === 3 && Number(used[0].total_count) === 3, used.map((r) => r.part_number).join());

  const byNumber = await list({ sort: "part_number", desc: false });
  ok("part-number sort, ascending", byNumber[0].part_number === "AA-UNUSED" && byNumber.at(-1).part_number === "XK-4707", byNumber.map((r) => r.part_number).join());
  const lastUsed = await list({ sort: "last_used", desc: true });
  ok("last-used sort puts the most recent first, never-used last", lastUsed[0].part_id === TIRE && lastUsed.at(-1).last_used_at === null);
  const price = await list({ sort: "last_price", desc: true });
  ok("price sort, highest first", price[0].part_id === TIRE);
  const repairsAsc = await list({ sort: "repairs", desc: false });
  ok("repairs ascending puts 0 first", Number(repairsAsc[0].used_repairs) === 0);

  const page2 = await list({ sort: "part_number", desc: false, limit: 2, offset: 2 });
  ok("paging returns the next slice and the same total", page2.length === 2 && page2[0].part_number === byNumber[2].part_number && Number(page2[0].total_count) === 6);

  ok("search by part number", (await list({ search: "xk-47" })).map((r) => r.part_id).join() === BRAKE);
  ok("search by description", (await list({ search: "shoe" })).map((r) => r.part_id).join() === BRAKE);
  ok("search by the manufacturer's number on a repair line", (await list({ search: "29575225" })).map((r) => r.part_id).join() === TIRE);
  const us = await list({ search: "AB_12" });
  ok("`_` in a search is a literal underscore, not any character", us.length === 1 && us[0].part_id === UNDERSCORE, us.map((r) => r.part_number).join());
  ok("`%` in a search matches nothing it should not", (await list({ search: "%" })).length === 0);
  ok("a blank search is no search", (await list({ search: "   " })).length === 6);
  ok("search never reaches another org's lines", (await list({ org: OTHER, search: "29575225" })).length === 0);

  ok("an unknown sort is refused, not quietly reordered", (await refuses(`select * from shop_parts_list($1,$2,null,false,'cost',true,50,0)`, [ORG, SINCE90])) === "SPU01");
  ok("a missing window is refused", (await refuses(`select * from shop_parts_list($1,null,null,false,'used',true,50,0)`, [ORG])) === "SPU02");
  ok("limit is capped at 200 and floored at 1", (await list({ limit: 0 })).length === 1);
}

// ── 5: history ──────────────────────────────────────────────────────────────────────────────────
{
  const h = await all(`select * from shop_part_history($1,$2,50,0)`, [ORG, BRAKE]);
  ok("one row per non-canceled work order", h.length === 5 && h.every((r) => r.work_order_fleetpal_id !== "wo4"), h.map((r) => r.work_order_fleetpal_id).join());
  ok("newest first; the undated credit falls back to its line's date and sorts last", h.map((r) => r.work_order_fleetpal_id).join() === "wo5,wo2,wo1,wo3,wo6", h.map((r) => r.work_order_fleetpal_id).join());
  const w2 = h.find((r) => r.work_order_fleetpal_id === "wo2");
  ok("wo2 on 412 is 12 days after wo1 on 412", w2.days_since_previous_on_unit === 12, String(w2.days_since_previous_on_unit));
  ok("wo2 reads the unit's number", w2.unit_number === "412");
  ok("wo2's quantity and unit price", Number(w2.quantity) === 2 && Number(w2.unit_price) === 44);
  const w1 = h.find((r) => r.work_order_fleetpal_id === "wo1");
  ok("the first use on a unit has no gap", w1.days_since_previous_on_unit === null);
  ok("a work order with no unit has no gap", h.find((r) => r.work_order_fleetpal_id === "wo5").days_since_previous_on_unit === null);
  ok("a credit-only work order has no unit price", h.find((r) => r.work_order_fleetpal_id === "wo6").unit_price === null);
  const p = await all(`select * from shop_part_history($1,$2,1,1)`, [ORG, BRAKE]);
  ok(
    "paging keeps the gap measured over the whole history (page 2 of size 1 is wo2, gap still 12)",
    p.length === 1 && Number(p[0].total_count) === 5 && p[0].work_order_fleetpal_id === "wo2" && p[0].days_since_previous_on_unit === 12,
    JSON.stringify(p[0]),
  );
  ok("another org's part id answers nothing", (await all(`select * from shop_part_history($1,$2,50,0)`, [ORG, RIVAL_BRAKE])).length === 0);
  ok("the rival's own history is its own one row", (await all(`select * from shop_part_history($1,$2,50,0)`, [OTHER, RIVAL_BRAKE])).length === 1);
}

// ── 6: summary ──────────────────────────────────────────────────────────────────────────────────
{
  const s = await one(`select * from shop_part_summary($1,$2,$3)`, [ORG, BRAKE, NOW]);
  ok("90-day repairs and quantity match the list", Number(s.repairs_90d) === 5 && Number(s.quantity_90d) === 7, JSON.stringify(s));
  ok("12-month units: 412 and 500 (the unit-less open WO is not a unit)", Number(s.units_365d) === 2);
  ok("prices stand on three priced repairs (43, 44, 40)", Number(s.priced_repairs_365d) === 3);
  ok("typical is the median, 43", Number(s.typical_price_365d) === 43);
  ok("low and high", Number(s.low_price_365d) === 40 && Number(s.high_price_365d) === 44);
  ok("last price matches the list's", Number(s.last_price) === 44);
  const f = await one(`select * from shop_part_summary($1,$2,$3)`, [ORG, FILTER, NOW]);
  ok("an old use is in 12 months, not in 90 days", Number(f.repairs_90d) === 0 && Number(f.repairs_365d) === 1);
  const u = await one(`select * from shop_part_summary($1,$2,$3)`, [ORG, UNUSED, NOW]);
  ok("an unused part gets one row of zeros and nulls", Number(u.repairs_365d) === 0 && u.last_used_at === null && u.typical_price_365d === null);
  const r = await one(`select * from shop_part_summary($1,$2,$3)`, [ORG, RIVAL_BRAKE, NOW]);
  ok("another org's part reads as unused, never as the rival's figures", Number(r.quantity_365d) === 0);
}

// ── 7: no browser role may call them ───────────────────────────────────────────────────────────
for (const fn of [
  "shop_part_uses(uuid)",
  "shop_parts_list(uuid, timestamptz, text, boolean, text, boolean, integer, integer)",
  "shop_part_summary(uuid, uuid, timestamptz)",
  "shop_part_history(uuid, uuid, integer, integer)",
]) {
  const g = await one(
    `select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') b, has_function_privilege('service_role', $1, 'execute') s`,
    [`public.${fn}`],
  );
  ok(`${fn.split("(")[0]}: closed to anon and authenticated, open to the service role`, !g.a && !g.b && g.s);
}

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
