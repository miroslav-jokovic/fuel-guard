// FuelGuard — the document reader's tables (migrations 0448 and 0449, DOCUMENT-READER-PLAN.md Step 1.2 and
// Q-DR12).
//
// Five properties that would each fail quietly, because nothing in the product reads these tables yet:
//
//   0. ONE VOCABULARY. Every closed list a CHECK holds is the contract's array (documentReadingContract.ts),
//      read back out of the APPLIED catalog — so a later migration that re-issues a constraint, or a
//      contract that gains a member, fails here instead of as a 23514 in production.
//   1. EVIDENCE IS APPEND-ONLY, FOR THE SERVICE ROLE TOO. Sources, pages and reviews refuse UPDATE and
//      DELETE as the migration owner; the one allowed change is a source's matched driver (set null on a
//      driver's deletion, or a same-org move by the roster merge).
//   2. A READ MOVES ONE WAY, THROUGH ONE DOOR. Inserted queued; only document_read_transition changes it;
//      queued → reading → done | failed, a failure names its code, terminal is terminal.
//   3. ONE ORG. A page, a read or a review of another carrier's source is refused at insert; a driver
//      match across carriers is refused.
//   4. DEDUPE WITHIN THE ORG (D-DR12): the same bytes twice in one org conflict; in two orgs they do not.
//   5. NO CLIENT PATH: RLS on, no policies, the RPC not executable by a browser session.
//   6. A PAGE'S CLASS IS A LEDGER (0449, Q-DR12): every verdict — the classifier's and each person's
//      override — is a new append-only row in document_page_classes; the newest per page wins; a
//      classifier verdict names its model and prompt and no person, a person's names the person.
//
// Run:  node supabase/tests/document-reader-tables.test.mjs   (after `pnpm --filter @silvicom/shared build:rn`)
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DOCUMENT_ORIGINS,
  DOCUMENT_PROFILE_IDS,
  INTAKE_LIMITS,
  PAGE_CLASSES,
  PAGE_CLASS_SETTERS,
  READ_FAILURE_CODES,
  READ_STATUSES,
  REVIEW_ACTIONS,
  REVIEW_CONSUMERS,
} from "../../packages/shared/dist/index.js";

const SUPA = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(SUPA, rel), "utf8");
const MIGRATIONS = readdirSync(join(SUPA, "migrations")).filter((f) => f.endsWith(".sql")).sort();

const db = new PGlite({ extensions: { pg_trgm } });
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
/** The SQLSTATE a statement raised, or null when it succeeded. */
const sqlstate = async (q, p = []) => {
  try { await db.query(q, p); return null; } catch (e) { return e.code ?? String(e.message); }
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
// Supabase's real default privileges, installed BEFORE the migrations — full DML granted, RLS is the
// gate. Without this a client "cannot read" for the wrong reason and the lockout below proves nothing.
await db.exec(
  "grant usage on schema public, storage to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" +
    "alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" +
    "alter default privileges in schema storage grant all on tables to anon, authenticated, service_role;",
);
ok("0448 present", MIGRATIONS.some((f) => f.startsWith("0448_document_reader_tables")));
ok("0449 present", MIGRATIONS.some((f) => f.startsWith("0449_document_page_classes")));
for (const f of MIGRATIONS)
  await db.exec(read(join("migrations", f)).replace(/create extension if not exists pgcrypto;?/gi, ""));

// ── 0. one vocabulary ─────────────────────────────────────────────────────────────────────────────
/** The quoted literals of the CHECK named `conname` on `table`, as the applied catalog renders it. */
const checkLiterals = async (table, conname) => {
  const row = await one(
    `select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = $1::regclass and conname = $2`,
    [`public.${table}`, conname],
  );
  return row ? [...row.d.matchAll(/'([^']*)'::text/g)].map((m) => m[1]) : null;
};
const VOCABULARIES = [
  ["document_sources", "document_sources_origin_check", "DOCUMENT_ORIGINS", DOCUMENT_ORIGINS],
  ["document_page_classes", "document_page_classes_page_class_check", "PAGE_CLASSES", PAGE_CLASSES],
  ["document_page_classes", "document_page_classes_set_by_check", "PAGE_CLASS_SETTERS", PAGE_CLASS_SETTERS],
  ["document_reads", "document_reads_status_check", "READ_STATUSES", READ_STATUSES],
  ["document_reads", "document_reads_failure_code_check", "READ_FAILURE_CODES", READ_FAILURE_CODES],
  ["document_reads", "document_reads_profile_check", "DOCUMENT_PROFILE_IDS", DOCUMENT_PROFILE_IDS],
  ["document_read_reviews", "document_read_reviews_action_check", "REVIEW_ACTIONS", REVIEW_ACTIONS],
  ["document_read_reviews", "document_read_reviews_consumer_check", "REVIEW_CONSUMERS", REVIEW_CONSUMERS],
];
const drift = [];
for (const [table, conname, name, contract] of VOCABULARIES) {
  const sql = await checkLiterals(table, conname);
  const same = Array.isArray(contract) && contract.length > 0 && sql !== null
    && JSON.stringify(sql) === JSON.stringify([...contract]);
  if (!same) drift.push(`${conname}: sql ${JSON.stringify(sql)} vs ${name} ${JSON.stringify(contract)}`);
}
ok("every CHECK vocabulary equals its contract array", drift.length === 0, drift.join(" | "));

const bucket = await one(`select public, file_size_limit from storage.buckets where id = 'document-intake'`);
ok("the document-intake bucket exists and is private", bucket?.public === false, JSON.stringify(bucket));
ok("the bucket's size cap is INTAKE_LIMITS.maxBytes", Number(bucket?.file_size_limit) === INTAKE_LIMITS.maxBytes,
  `${bucket?.file_size_limit} vs ${INTAKE_LIMITS.maxBytes}`);

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────
const ORG = (await one(`insert into organizations (name) values ('Silvicom') returning id`)).id;
const OTHER = (await one(`insert into organizations (name) values ('Other') returning id`)).id;
const USER = (await one(`insert into auth.users (email) values ('dispatch@x.test') returning id`)).id;
const driver = async (org, name) =>
  (await one(`insert into drivers (org_id, full_name) values ($1, $2) returning id`, [org, name])).id;
const D1 = await driver(ORG, "Ana Driver");
const D2 = await driver(ORG, "Ana Driver (dup)");
const DX = await driver(OTHER, "Other Driver");

const sha = (c) => c.repeat(64);
const insertSource = (org, hash, extra = {}) => {
  const v = { origin: "upload", origin_ref: null, matched_driver_id: null, ...extra };
  return db.query(
    `insert into document_sources (org_id, origin, origin_ref, matched_driver_id, storage_path, sha256, mime, byte_size, page_count, uploaded_by)
     values ($1, $2, $3, $4, $7, $5, 'application/pdf', 1000, 2, $6) returning id`,
    [org, v.origin, v.origin_ref, v.matched_driver_id, hash, USER, `${org}/${hash}`],
  );
};

// ── 1. sources: dedupe, vocabulary, append-only bar the driver move ─────────────────────────────────
const S1 = (await insertSource(ORG, sha("a"), { matched_driver_id: D1 })).rows[0].id;
ok("a received file is recorded", !!S1);
ok("the same bytes twice in one org conflict (D-DR12 dedupe)", (await sqlstate(
  `insert into document_sources (org_id, origin, origin_ref, storage_path, sha256, mime, byte_size, page_count)
   values ($1, 'samsara', 'doc-1', 'x', $2, 'image/jpeg', 10, 1)`, [ORG, sha("a")])) === "23505");
const SX = (await insertSource(OTHER, sha("a"))).rows[0]?.id;
ok("the same bytes in another org are a separate record", !!SX);
ok("an origin outside DOCUMENT_ORIGINS is refused", (await sqlstate(
  `insert into document_sources (org_id, origin, storage_path, sha256, mime, byte_size, page_count)
   values ($1, 'fax', 'x', $2, 'image/png', 10, 1)`, [ORG, sha("b")])) === "23514");
ok("a Samsara source without its document id is refused", (await sqlstate(
  `insert into document_sources (org_id, origin, storage_path, sha256, mime, byte_size, page_count)
   values ($1, 'samsara', 'x', $2, 'image/png', 10, 1)`, [ORG, sha("b")])) === "23514");
ok("a sha256 that is not 64 hex characters is refused", (await sqlstate(
  `insert into document_sources (org_id, origin, storage_path, sha256, mime, byte_size, page_count)
   values ($1, 'upload', 'x', 'ABC', 'image/png', 10, 1)`, [ORG])) === "23514");
ok("a source matched to another carrier's driver is refused", (await sqlstate(
  `insert into document_sources (org_id, origin, storage_path, sha256, mime, byte_size, page_count, matched_driver_id)
   values ($1, 'upload', 'x', $2, 'image/png', 10, 1, $3)`, [ORG, sha("c"), DX])) === "DO011");

ok("a source's bytes cannot be re-pointed (UPDATE sha256)",
  (await sqlstate(`update document_sources set sha256 = $2 where id = $1`, [S1, sha("d")])) === "DO010");
ok("a source's sender cannot be rewritten",
  (await sqlstate(`update document_sources set sender = '+15550000000' where id = $1`, [S1])) === "DO010");
ok("a source cannot be deleted, even by the owner role",
  (await sqlstate(`delete from document_sources where id = $1`, [S1])) === "DO010");
ok("the roster merge may move the match to a same-org driver",
  (await sqlstate(`update document_sources set matched_driver_id = $2 where id = $1`, [S1, D2])) === null);
ok("but not to another carrier's driver",
  (await sqlstate(`update document_sources set matched_driver_id = $2 where id = $1`, [S1, DX])) === "DO011");
// A driver row is deleted only by the merge, under 0235's declared exemption — so that is how it is
// deleted here.
const mergeDelete = async (id) => {
  await db.exec("begin");
  try {
    await db.query(`select set_config('fuelguard.merging_driver', 'on', true)`);
    await db.query(`delete from drivers where id = $1`, [id]);
    await db.exec("commit");
    return null;
  } catch (e) {
    await db.exec("rollback");
    return e.code ?? String(e.message);
  }
};
ok("deleting the matched driver keeps the document and clears the match (on delete set null)",
  (await mergeDelete(D2)) === null
  && (await one(`select matched_driver_id from document_sources where id = $1`, [S1]))?.matched_driver_id === null);

// ── 2. pages ──────────────────────────────────────────────────────────────────────────────────────
const insertPage = (org, source, n) => db.query(
  `insert into document_pages (org_id, source_id, page_number, original_path,
     original_sha256, working_path, width, height, normaliser_version)
   values ($1, $2, $3, 'o', $4, 'w', 2550, 3300, 'n1') returning id`,
  [org, source, n, sha("e")],
);
const P1 = (await insertPage(ORG, S1, 1)).rows[0].id;
ok("a canonical page is recorded", !!P1);
const pageCols = (await db.query(
  `select attname from pg_attribute where attrelid = 'public.document_pages'::regclass and attnum > 0 and not attisdropped`,
)).rows.map((r) => r.attname);
ok("a page carries no class columns of its own (0449: the class is document_page_classes)",
  !pageCols.includes("page_class") && !pageCols.includes("page_class_set_by"), pageCols.join(","));
ok("a page of another carrier's source is refused", (await sqlstate(
  `insert into document_pages (org_id, source_id, page_number, original_path, original_sha256, working_path, width, height, normaliser_version)
   values ($1, $2, 1, 'o', $3, 'w', 1, 1, 'n1')`, [ORG, SX, sha("e")])) === "23503");
ok("a page number twice for one source is refused", (await sqlstate(
  `insert into document_pages (org_id, source_id, page_number, original_path, original_sha256, working_path, width, height, normaliser_version)
   values ($1, $2, 1, 'o', $3, 'w', 1, 1, 'n1')`, [ORG, S1, sha("e")])) === "23505");
ok("a page cannot be overwritten (UPDATE)",
  (await sqlstate(`update document_pages set working_path = 'w2' where id = $1`, [P1])) === "DO010");

// ── 2b. a page's class: one append-only ledger, newest wins (0449) ──────────────────────────────────
const classify = (org, page, cls, setBy = "classifier", extra = {}) => {
  const person = setBy !== "classifier";
  const v = { actor: person ? USER : null, model: person ? null : "claude-cheap", prompt: person ? null : "pc-1", id: null, ...extra };
  return db.query(
    `insert into document_page_classes (id, org_id, page_id, page_class, set_by, actor, model, prompt_version)
     values (coalesce($8::uuid, gen_random_uuid()), $1, $2, $3, $4, $5, $6, $7) returning id`,
    [org, page, cls, setBy, v.actor, v.model, v.prompt, v.id]);
};
const current = async (org, pages = null) =>
  (await db.query(`select page_id, page_class, set_by from document_page_current_class($1, $2::uuid[])`, [org, pages])).rows;
const P2 = (await insertPage(ORG, S1, 2)).rows[0].id;
ok("a page with no verdict has no current class", (await current(ORG)).length === 0);
const C1 = (await classify(ORG, P1, "other")).rows[0]?.id;
ok("a classifier verdict with its model and prompt is recorded", !!C1);
ok("the classifier's verdict is the current class while it is the only one",
  JSON.stringify(await current(ORG, [P1])) === JSON.stringify([{ page_id: P1, page_class: "other", set_by: "classifier" }]));
ok("a classifier verdict without its model is refused",
  (await sqlstate(`insert into document_page_classes (org_id, page_id, page_class, set_by, prompt_version) values ($1, $2, 'bol', 'classifier', 'pc-1')`, [ORG, P1])) === "23514");
ok("a classifier verdict without its prompt version is refused",
  (await sqlstate(`insert into document_page_classes (org_id, page_id, page_class, set_by, model) values ($1, $2, 'bol', 'classifier', 'claude-cheap')`, [ORG, P1])) === "23514");
ok("a classifier verdict that names a person is refused",
  (await sqlstate(`insert into document_page_classes (org_id, page_id, page_class, set_by, actor, model, prompt_version) values ($1, $2, 'bol', 'classifier', $3, 'm', 'p')`, [ORG, P1, USER])) === "23514");
ok("a person's override without the person is refused",
  (await sqlstate(`insert into document_page_classes (org_id, page_id, page_class, set_by) values ($1, $2, 'bol', 'reviewer')`, [ORG, P1])) === "23514");
ok("a person's override that names a model is refused",
  (await sqlstate(`insert into document_page_classes (org_id, page_id, page_class, set_by, actor, model) values ($1, $2, 'bol', 'reviewer', $3, 'm')`, [ORG, P1, USER])) === "23514");
ok("a page class outside PAGE_CLASSES is refused",
  (await sqlstate(`insert into document_page_classes (org_id, page_id, page_class, set_by, model, prompt_version) values ($1, $2, 'invoice', 'classifier', 'm', 'p')`, [ORG, P1])) === "23514");
ok("a class setter outside PAGE_CLASS_SETTERS is refused",
  (await sqlstate(`insert into document_page_classes (org_id, page_id, page_class, set_by, actor) values ($1, $2, 'bol', 'driver', $3)`, [ORG, P1, USER])) === "23514");
const PX = (await insertPage(OTHER, SX, 1)).rows[0].id;
ok("a verdict on another carrier's page is refused",
  (await sqlstate(`insert into document_page_classes (org_id, page_id, page_class, set_by, model, prompt_version) values ($1, $2, 'bol', 'classifier', 'm', 'p')`, [ORG, PX])) === "23503");
await classify(OTHER, PX, "securement");
await classify(ORG, P2, "placard");
// Classifier then override inside ONE transaction: their created_at ties (`now()`), their seq must not.
// The ids are chosen so the LATER row has the SMALLER id — a fold that fell back to (created_at, id) would
// pick the classifier every time, not half the time.
await db.exec("begin");
const C2 = (await classify(ORG, P1, "bol", "classifier", { prompt: "pc-2", id: "ffffffff-ffff-4fff-bfff-ffffffffffff" })).rows[0].id;
const C3 = (await classify(ORG, P1, "delivery_copy", "reviewer", { id: "00000000-0000-4000-8000-000000000001" })).rows[0].id;
await db.exec("commit");
ok("two verdicts written in one transaction are ordered as written, not tied (seq)",
  (await one(`select (select seq from document_page_classes where id = $2)
                   > (select seq from document_page_classes where id = $1) as later`, [C2, C3]))?.later === true);
ok("a dispatcher's override is the current class as the newest row, even in the classifier's transaction",
  JSON.stringify((await current(ORG, [P1]))) === JSON.stringify([{ page_id: P1, page_class: "delivery_copy", set_by: "reviewer" }]));
ok("every earlier verdict is kept (who-said-what)",
  Number((await one(`select count(*) n from document_page_classes where page_id = $1`, [P1])).n) === 3);
ok("the fold answers per page: another page keeps its own verdict",
  (await current(ORG)).find((r) => r.page_id === P2)?.page_class === "placard" && (await current(ORG)).length === 2);
ok("the fold sees one org only: the other carrier's verdict is not this org's, nor this org's its",
  !(await current(ORG)).some((r) => r.page_id === PX)
  && JSON.stringify(await current(OTHER)) === JSON.stringify([{ page_id: PX, page_class: "securement", set_by: "classifier" }]));
ok("a verdict cannot be rewritten (UPDATE)",
  (await sqlstate(`update document_page_classes set page_class = 'bol' where id = $1`, [C3])) === "DO010");
ok("a verdict cannot be deleted", (await sqlstate(`delete from document_page_classes where id = $1`, [C1])) === "DO010");
ok("a page cannot be deleted", (await sqlstate(`delete from document_pages where id = $1`, [P1])) === "DO010");

// ── 3. reads: one door, one direction ───────────────────────────────────────────────────────────────
const newRead = async (org = ORG, source = S1) => (await one(
  `insert into document_reads (org_id, source_id, profile, profile_version, requested_by)
   values ($1, $2, 'shipping_document', 'sd-1', $3) returning id`, [org, source, USER])).id;
const status = async (id) => (await one(`select status, failure_code, started_at, finished_at, result from document_reads where id = $1`, [id]));
const move = (id, to, extra = {}, org = ORG) => sqlstate(
  `select document_read_transition(p_org => $1, p_read => $2, p_to => $3, p_failure_code => $4, p_result => $5::jsonb,
     p_models => $6::text[], p_input_tokens => $7)`,
  [org, id, to, extra.code ?? null, extra.result ?? null, extra.models ?? null, extra.tokens ?? null],
);

const R1 = await newRead();
ok("a read is inserted queued", (await status(R1)).status === "queued");
ok("a read cannot be inserted already done", (await sqlstate(
  `insert into document_reads (org_id, source_id, profile, profile_version, status, started_at, finished_at, result)
   values ($1, $2, 'shipping_document', 'sd-1', 'done', now(), now(), '{}')`, [ORG, S1])) === "DO012");
ok("a profile outside DOCUMENT_PROFILE_IDS is refused", (await sqlstate(
  `insert into document_reads (org_id, source_id, profile, profile_version) values ($1, $2, 'fuel_receipt', 'x')`, [ORG, S1])) === "23514");
ok("a read of another carrier's source is refused", (await sqlstate(
  `insert into document_reads (org_id, source_id, profile, profile_version) values ($1, $2, 'shipping_document', 'x')`, [ORG, SX])) === "23503");
ok("a direct UPDATE of a read's status is refused (only the RPC moves it)",
  (await sqlstate(`update document_reads set status = 'reading', started_at = now() where id = $1`, [R1])) === "DO013");
ok("a read cannot be deleted", (await sqlstate(`delete from document_reads where id = $1`, [R1])) === "DO010");
ok("queued → done is refused (it must be read first)", (await move(R1, "done", { result: "{}" })) === "DO014");
ok("queued → failed is refused", (await move(R1, "failed", { code: "refusal" })) === "DO014");
ok("another org cannot move this read", (await move(R1, "reading", {}, OTHER)) === "DO015");
ok("queued → reading is accepted and stamps started_at",
  (await move(R1, "reading")) === null && (await status(R1)).status === "reading" && (await status(R1)).started_at !== null);
const startedAt = String((await status(R1)).started_at);
ok("reading → reading (a queue retry) is a no-op that keeps started_at",
  (await move(R1, "reading")) === null && String((await status(R1)).started_at) === startedAt);
ok("reading → failed without a failure code is refused", (await move(R1, "failed")) === "DO014");
ok("a failure code on a non-failure is refused", (await move(R1, "done", { code: "refusal", result: "{}" })) === "DO014");
ok("a failure code outside READ_FAILURE_CODES is refused", (await move(R1, "failed", { code: "timeout" })) === "23514");
ok("a result on a failure is refused", (await move(R1, "failed", { code: "refusal", result: "{}" })) === "DO014");
ok("reading → done is accepted with its result and usage",
  (await move(R1, "done", { result: '{"identity":{}}', models: "{claude-a,claude-b}", tokens: 1200 })) === null
  && (await status(R1)).status === "done" && (await status(R1)).finished_at !== null);
ok("done is terminal: done → reading is refused", (await move(R1, "reading")) === "DO014");
ok("done is terminal: done → failed is refused", (await move(R1, "failed", { code: "refusal" })) === "DO014");

const R2 = await newRead();
await move(R2, "reading");
ok("reading → failed with a READ_FAILURES code is accepted",
  (await move(R2, "failed", { code: "max_tokens", tokens: 8000 })) === null && (await status(R2)).failure_code === "max_tokens");
ok("failed is terminal: failed → done is refused", (await move(R2, "done", { result: "{}" })) === "DO014");
ok("failed is terminal: failed → reading is refused", (await move(R2, "reading")) === "DO014");
// 0451: the terminal move counts the read's tokens in org_usage_month — once, and never `runs`.
const usage = async (org) => (await one(
  `select input_tokens::int i, output_tokens::int o, runs from org_usage_month where org_id = $1`, [org])) ?? null;
ok("a done read and a failed read each add their tokens to the org's month (1,200 + 8,000), not to runs",
  JSON.stringify(await usage(ORG)) === JSON.stringify({ i: 9200, o: 0, runs: 0 }), JSON.stringify(await usage(ORG)));
const R3 = await newRead();
await move(R3, "reading");
ok("a read that spent nothing (a cache hit) ends without touching the counter",
  (await move(R3, "failed", { code: "reading_disabled" })) === null && (await usage(ORG)).i === 9200);
ok("a refused second terminal move counts nothing twice",
  (await move(R2, "failed", { code: "max_tokens", tokens: 8000 })) === "DO014" && (await usage(ORG)).i === 9200);
ok("the other carrier's month is untouched", (await usage(OTHER)) === null);
const R4 = await newRead();
await move(R4, "reading");
ok("model_unavailable ends a read the queue gave up on",
  (await move(R4, "failed", { code: "model_unavailable" })) === null && (await status(R4)).failure_code === "model_unavailable");

ok("even with the RPC's flag set, a read's source and profile are fixed", await (async () => {
  await db.exec("begin");
  try {
    await db.query(`select set_config('silvicom.document_read_transition', 'on', true)`);
    return (await sqlstate(`update document_reads set profile_version = 'sd-2' where id = $1`, [R2])) === "DO012";
  } finally { await db.exec("rollback"); }
})());

// ── 4. reviews ────────────────────────────────────────────────────────────────────────────────────
const review = (org, readId, action = "confirmed", consumer = "hazmat_calculator") => sqlstate(
  `insert into document_read_reviews (org_id, read_id, field_path, action, old_value, new_value, actor, consumer)
   values ($1, $2, 'identity.bolNumber', $3, '"123"', '"123"', $4, $5)`, [org, readId, action, USER, consumer]);
ok("a confirmation is recorded", (await review(ORG, R1)) === null);
const RV = (await one(`select id from document_read_reviews where read_id = $1`, [R1])).id;
ok("an action outside REVIEW_ACTIONS is refused", (await review(ORG, R1, "approved")) === "23514");
ok("a consumer outside REVIEW_CONSUMERS is refused", (await review(ORG, R1, "confirmed", "billing")) === "23514");
const RX = await newRead(OTHER, SX);
ok("a review filed under one org against another org's read is refused", (await review(ORG, RX)) === "23503");
ok("a review cannot be rewritten (UPDATE)",
  (await sqlstate(`update document_read_reviews set action = 'corrected' where id = $1`, [RV])) === "DO010");
ok("a review cannot be deleted", (await sqlstate(`delete from document_read_reviews where id = $1`, [RV])) === "DO010");

// ── 5. no client path ─────────────────────────────────────────────────────────────────────────────
async function asClient(org, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: USER, org_id: org, user_role: "admin", role: "authenticated" }),
    ]);
    const res = await db.query(sql, params);
    return { rows: res.rows, error: null };
  } catch (e) {
    return { rows: [], error: e.code ?? String(e.message) };
  } finally {
    await db.exec("rollback");
  }
}
for (const t of ["document_sources", "document_pages", "document_page_classes", "document_reads", "document_read_reviews"]) {
  const r = await asClient(ORG, `select count(*)::int n from ${t}`);
  ok(`an admin's browser session reads nothing from ${t} (no client policy)`, r.error === null && r.rows[0].n === 0, JSON.stringify(r));
}
const ins = await asClient(ORG,
  `insert into document_sources (org_id, origin, storage_path, sha256, mime, byte_size, page_count) values ($1, 'upload', 'x', $2, 'image/png', 1, 1)`,
  [ORG, sha("f")]);
ok("a browser session cannot insert a source", ins.error === "42501", JSON.stringify(ins));
const rpc = await asClient(ORG, `select document_read_transition($1, $2, 'reading')`, [ORG, await newRead()]);
ok("a browser session cannot execute document_read_transition", rpc.error === "42501", JSON.stringify(rpc));
const fold = await asClient(ORG, `select * from document_page_current_class($1)`, [ORG]);
ok("a browser session cannot execute document_page_current_class", fold.error === "42501", JSON.stringify(fold));

await db.close();

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
