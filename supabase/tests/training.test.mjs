// Silvicom 360 — driver safety training (migration 0648; SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS-2026-11-24.md §8–§9).
//
// 1. A film version is published only with its files and enough questions (TR005); once published its
//    chapters, quiz rule and questions are frozen (TR004, TR010), it is withdrawn and never deleted
//    (TR001, TR003), and one film has one published cut per language — a remaster swaps them in one
//    transaction. A draft may be deleted with its questions.
// 1b. `training_publish_version` swaps the live cut in one transaction, for its own carrier, ready only.
// 2. An assignment keeps what was sent (TR021), its link is a sha256 hash, unique; a resend replaces it;
//    a roster merge may move it inside the carrier only (TR022); it is never deleted (TR020).
// 3. Progress is rewritable; a quiz keeps what it served (TR031), carries its score when submitted and
//    is then frozen (TR032) and never deleted (TR030); one open quiz per film per driver.
// 4. An organisation going away takes its catalogue, published or not.
// 5. RLS on with no client policy on every table; the bucket is private.
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
const one = async (q, p = []) => (await db.query(q, p)).rows[0];
/** Run a statement and report the SQLSTATE it raised, or null when it succeeded. */
const refuses = async (q, p = []) => {
  try {
    await db.query(q, p);
    return null;
  } catch (e) {
    return e.code ?? "unknown";
  }
};

// Supabase-managed schemas, shimmed identically to unit-tags.test.mjs.
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


const ORG = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Fleet') returning id`)).id;
const OTHER = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Rival') returning id`)).id;
const USER = "11111111-1111-4111-8111-111111111111";
const driver = async (org) => (await one(`insert into drivers (org_id, full_name) values ($1, 'Marko Test') returning id`, [org])).id;
const D1 = await driver(ORG);
const D2 = await driver(ORG);
const DX = await driver(OTHER);
const course = async (org) => (await one(`insert into training_courses (org_id, title, created_by) values ($1, 'Act I', $2) returning id`, [org, USER])).id;
const C = await course(ORG);
const CX = await course(OTHER);
const L = (await one(`insert into training_lessons (org_id, course_id, title, created_by) values ($1, $2, 'Following Too Close', $3) returning id`, [ORG, C, USER])).id;
const version = async (no) =>
  (await one(`insert into training_versions (org_id, lesson_id, version_no, created_by) values ($1, $2, $3, $4) returning id`, [ORG, L, no, USER])).id;
const FILES = `source_path = 'o/v.mp4', source_bytes = 1000, source_sha256 = '${"a".repeat(64)}', duration_ms = 204400,
  poster_path = 'o/p.jpg', renditions = '[{"height":360,"path":"o/360.mp4","bytes":2148215}]', chapters = '[{"title":"Why space","startMs":8000}]'`;
const READY = `state = 'ready', ${FILES}`;
const question = (v, over = "") =>
  refuses(
    `insert into training_questions (org_id, version_id, prompt, choices, answer, why, created_by${over ? ", chapter" : ""})
     values ($1, $2, 'How far at 55?', '[{"id":"a","text":"200 ft"},{"id":"b","text":"419 ft"}]', 'b', '142 + 61 + 216.', $3${over ? ", " + over : ""})`,
    [ORG, v, USER],
  );

// ── 1: a version, its quiz, publishing ─────────────────────────────────────────────────────────
const V1 = await version(1);
ok("the same version number twice on one film is refused", (await refuses(`insert into training_versions (org_id, lesson_id, version_no, created_by) values ($1, $2, 1, $3)`, [ORG, L, USER])) === "23505");
ok("a question with one choice is refused", (await refuses(`insert into training_questions (org_id, version_id, prompt, choices, answer, why, created_by) values ($1, $2, 'Q?', '[{"id":"a","text":"x"}]', 'a', 'why', $3)`, [ORG, V1, USER])) === "23514");
ok("an answer that is not a choice letter is refused", (await refuses(`insert into training_questions (org_id, version_id, prompt, choices, answer, why, created_by) values ($1, $2, 'Q?', '[{"id":"a","text":"x"},{"id":"b","text":"y"}]', 'z', 'why', $3)`, [ORG, V1, USER])) === "23514");
for (let i = 0; i < 5; i++) await question(V1);
ok("a version cannot be published without its files", (await refuses(`update training_versions set state = 'published', published_at = now(), published_by = $2 where id = $1`, [V1, USER])) === "23514");
await db.query(`update training_versions set ${READY} where id = $1`, [V1]);
const V0 = await version(9);
for (let i = 0; i < 4; i++) await question(V0);
await db.query(`update training_versions set ${READY}, language = 'es' where id = $1`, [V0]);
ok(
  "a version with fewer questions than it serves cannot be published",
  (await refuses(`update training_versions set state = 'published', published_at = now(), published_by = $2 where id = $1`, [V0, USER])) === "TR005",
);
ok("a ready version with five questions is published", (await refuses(`update training_versions set state = 'published', published_at = now(), published_by = $2 where id = $1`, [V1, USER])) === null);
ok("a published version's chapters are frozen", (await refuses(`update training_versions set chapters = '[]' where id = $1`, [V1])) === "TR004");
ok("a published version's quiz rule is frozen", (await refuses(`update training_versions set pass_count = 1 where id = $1`, [V1])) === "TR004");
ok("a published version's questions cannot be added to", (await question(V1)) === "TR010");
ok("…changed", (await refuses(`update training_questions set answer = 'a' where version_id = $1`, [V1])) === "TR010");
ok("…or deleted", (await refuses(`delete from training_questions where version_id = $1`, [V1])) === "TR010");
ok("a published version is never deleted", (await refuses(`delete from training_versions where id = $1`, [V1])) === "TR001");

const V2 = await version(2);
for (let i = 0; i < 5; i++) await question(V2);
await db.query(`update training_versions set ${READY} where id = $1`, [V2]);
ok(
  "two published versions of one film in one language are refused",
  (await refuses(`update training_versions set state = 'published', published_at = now(), published_by = $2 where id = $1`, [V2, USER])) === "23505",
);
await db.exec("begin");
const swap =
  (await refuses(`update training_versions set state = 'withdrawn', withdrawn_at = now(), withdrawn_by = $2 where id = $1`, [V1, USER])) ??
  (await refuses(`update training_versions set state = 'published', published_at = now(), published_by = $2 where id = $1`, [V2, USER]));
await db.exec(swap === null ? "commit" : "rollback");
ok("a remaster withdraws the old cut and publishes the new one in one transaction", swap === null, String(swap));
ok("a withdrawn version is never changed again", (await refuses(`update training_versions set state = 'published' where id = $1`, [V1])) === "TR003");
ok("withdrawing needs who", (await refuses(`update training_versions set state = 'withdrawn', withdrawn_at = now() where id = $1`, [V2])) === "23514");
const V3 = await version(3);
ok("a draft version may be deleted, with its questions", (await question(V3)) === null && (await refuses(`delete from training_versions where id = $1`, [V3])) === null);

// ── 1b: publishing through the function ────────────────────────────────────────────────────────
const V4 = await version(4);
for (let i = 0; i < 5; i++) await question(V4);
ok("a draft cannot be published by the function", (await refuses(`select training_publish_version($1, $2, $3)`, [ORG, V4, USER])) === "TR041");
await db.query(`update training_versions set ${READY} where id = $1`, [V4]);
ok("another carrier cannot publish it", (await refuses(`select training_publish_version($1, $2, $3)`, [OTHER, V4, USER])) === "TR040");
const swapped = await one(`select training_publish_version($1, $2, $3) as old`, [ORG, V4, USER]);
ok("the function withdraws the live cut and publishes the new one", swapped.old === V2);
const states = await one(`select (select state from training_versions where id = $1) as a, (select state from training_versions where id = $2) as b`, [V2, V4]);
ok("…leaving exactly one published", states.a === "withdrawn" && states.b === "published");
const exec = await one(`select has_function_privilege('authenticated', 'training_publish_version(uuid, uuid, uuid)', 'execute') as a, has_function_privilege('anon', 'training_publish_version(uuid, uuid, uuid)', 'execute') as b`);
ok("no client may call it", exec.a === false && exec.b === false);

// ── 2: assignments ──────────────────────────────────────────────────────────────────────────
const assign = (drv, c = C, hash = null) =>
  refuses(
    `insert into training_assignments (org_id, driver_id, course_id, token_hash, link_expires_at, created_by) values ($1, $2, $3, $4, now() + interval '28 days', $5)`,
    [ORG, drv, c, hash ?? Math.random().toString(16).slice(2).padEnd(64, "0").slice(0, 64), USER],
  );
ok("a link token that is not a sha256 is refused", (await refuses(`insert into training_assignments (org_id, driver_id, course_id, token_hash, link_expires_at, created_by) values ($1, $2, $3, 'abc', now(), $4)`, [ORG, D1, C, USER])) === "23514");
ok("a driver is sent a course", (await assign(D1, C, "1".repeat(64))) === null);
ok("the same link hash twice is refused", (await assign(D2, C, "1".repeat(64))) === "23505");
const A = (await one(`select id from training_assignments where token_hash = $1`, ["1".repeat(64)])).id;
ok("what was sent is fixed", (await refuses(`update training_assignments set course_id = $2 where id = $1`, [A, CX])) === "TR021");
ok("a resend replaces the link", (await refuses(`update training_assignments set token_hash = $2, last_sent_at = now(), last_sent_via = 'copy' where id = $1`, [A, "2".repeat(64)])) === null);
ok("a roster merge may move it to a driver of the same carrier", (await refuses(`update training_assignments set driver_id = $2 where id = $1`, [A, D2])) === null);
ok("…never to another carrier's driver", (await refuses(`update training_assignments set driver_id = $2 where id = $1`, [A, DX])) === "TR022");
ok("an assignment is never deleted", (await refuses(`delete from training_assignments where id = $1`, [A])) === "TR020");
ok("a driver with training cannot be deleted out from under it", (await refuses(`delete from drivers where id = $1`, [D2])) !== null);

// ── 3: progress and attempts ──────────────────────────────────────────────────────────────────
ok("progress is one row per assignment and version", (await refuses(`insert into training_progress (assignment_id, version_id, org_id, watched) values ($1, $2, $3, '[[0,60000]]')`, [A, V2, ORG])) === null);
ok("…and may be rewritten", (await refuses(`update training_progress set watched = '[[0,190000]]', watched_since = '[]', position_ms = 190000 where assignment_id = $1`, [A])) === null);
const SERVED = `[{"questionId":"x","order":["b","a"]}]`;
const T1 = (await one(`insert into training_attempts (org_id, assignment_id, version_id, served) values ($1, $2, $3, $4) returning id`, [ORG, A, V2, SERVED])).id;
ok("one open quiz per film per driver", (await refuses(`insert into training_attempts (org_id, assignment_id, version_id, served) values ($1, $2, $3, $4)`, [ORG, A, V2, SERVED])) === "23505");
ok("answers are kept while the quiz is open", (await refuses(`update training_attempts set answers = '{"x":"a"}' where id = $1`, [T1])) === null);
ok("what a quiz served is fixed", (await refuses(`update training_attempts set served = '[{"questionId":"y","order":["a"]}]' where id = $1`, [T1])) === "TR031");
ok("a submitted quiz needs its score", (await refuses(`update training_attempts set submitted_at = now() where id = $1`, [T1])) === "23514");
ok("a score above the questions served is refused", (await refuses(`update training_attempts set submitted_at = now(), correct = 2, passed = true, missed_chapters = '{}' where id = $1`, [T1])) === "23514");
ok("a quiz is submitted with its score", (await refuses(`update training_attempts set submitted_at = now(), correct = 0, passed = false, missed_chapters = '{0}' where id = $1`, [T1])) === null);
ok("a submitted quiz is never changed", (await refuses(`update training_attempts set passed = true where id = $1`, [T1])) === "TR032");
ok("a quiz is never deleted", (await refuses(`delete from training_attempts where id = $1`, [T1])) === "TR030");
ok("after a submitted quiz a new one may start", (await refuses(`insert into training_attempts (org_id, assignment_id, version_id, served) values ($1, $2, $3, $4)`, [ORG, A, V2, SERVED])) === null);

// ── 4: an organisation going away takes its catalogue ─────────────────────────────────────────
// (Its drivers, and so its assignments and quizzes, go only through account closure: 0235's DR010
// refuses a plain driver delete, so an org with drivers is never removed by a bare DELETE.)
const GONE = (await one(`insert into organizations (id,name) values (gen_random_uuid(),'Closing') returning id`)).id;
const CG = await course(GONE);
const LG = (await one(`insert into training_lessons (org_id, course_id, title, created_by) values ($1, $2, 'Film', $3) returning id`, [GONE, CG, USER])).id;
const VG = (await one(`insert into training_versions (org_id, lesson_id, version_no, created_by) values ($1, $2, 1, $3) returning id`, [GONE, LG, USER])).id;
for (let i = 0; i < 5; i++) await refuses(`insert into training_questions (org_id, version_id, prompt, choices, answer, why, created_by) values ($1, $2, 'Which?', '[{"id":"a","text":"x"},{"id":"b","text":"y"}]', 'a', 'why', $3)`, [GONE, VG, USER]);
await db.query(`update training_versions set ${FILES}, state = 'published', published_at = now(), published_by = $2 where id = $1`, [VG, USER]);
const gone = await refuses(`delete from organizations where id = $1`, [GONE]);
ok("an organisation that goes takes its published films and their quizzes", gone === null, String(gone));
const left = await one(
  `select (select count(*) from training_courses where org_id = $1) + (select count(*) from training_versions where org_id = $1)
        + (select count(*) from training_questions where org_id = $1) as n`,
  [GONE],
);
ok("…and none of them is left", Number(left.n) === 0);

// ── 5: closed to clients ──────────────────────────────────────────────────────────────────────
for (const t of ["training_courses", "training_lessons", "training_versions", "training_questions", "training_assignments", "training_progress", "training_attempts"]) {
  const r = await one(`select relrowsecurity as on, (select count(*)::int from pg_policies where tablename = $1) as policies from pg_class where relname = $1`, [t]);
  ok(`${t}: RLS on, no client policy`, r.on === true && r.policies === 0);
}
const bucket = await one(`select public, file_size_limit from storage.buckets where id = 'training-media'`);
ok("the bucket is private and holds 100 MB a file", bucket.public === false && Number(bucket.file_size_limit) === 100 * 1024 * 1024);

await db.close();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
