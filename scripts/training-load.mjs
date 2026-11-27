#!/usr/bin/env node
/**
 * Load the first five safety films and their 84 questions (SEGMENT-QUIZ-2026-11-25.md §5–§6) into a
 * carrier's Safety › Training, through the same office API the page uses — so every check the page's
 * forms get (`checkChapters`, `checkQuestion`, `publishBlockers`, the audit rows) is applied here too,
 * and nothing is written to a table directly.
 *
 * Why a script and not the page: §5 is 84 questions, each a form of a prompt, four answers, a reason, a
 * chapter and a point. Typed by hand, one slip leaves a stop asking the wrong right answer; read from the
 * document, the document is what drivers get (`scripts/lib/training-bank.mjs`).
 *
 * Idempotent: a course, film, upload or question that is already there is reused, so a run that stops
 * half way is simply run again. A published cut is never edited (0648's triggers freeze it); a changed
 * question after publishing means a new cut, uploaded on the page.
 *
 *   node scripts/training-load.mjs --check                 parse and check the bank only, no network
 *   TRAINING_LOAD_EMAIL=… TRAINING_LOAD_PASSWORD=… \
 *   node scripts/training-load.mjs --target staging [--publish] [--films 1,2]
 *
 *   TRAINING_LOAD_EMAIL=you@… node scripts/training-load.mjs --target production --yes-production --publish
 *
 * Production (D-TR18, owner 2026-11-27: a pilot with real drivers, the safety review of all 84 done in
 * production, corrections as new cuts) needs `--yes-production` as well as the target, so a staging
 * command edited by one word cannot write there. Run it in a Terminal, by the member who signs in: it
 * asks for the password and, for an account with a second factor, the 6-digit code, with typing hidden,
 * so neither sits in shell history, a file or a chat. On staging the password may come from the
 * environment instead (a test member's, from the Keychain).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { chaptersOf, parseBank, questionsOf } from "./lib/training-bank.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BANK = join(ROOT, "docs/plans/training/SEGMENT-QUIZ-2026-11-25.md");
/** The approved cuts (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS §1). Company material: never in the repo. */
const FILMS_DIR = process.env.TRAINING_FILMS_DIR ?? join(homedir(), "Projects/Silvicom-360-Videos/output/Locked");
const FILE_OF = {
  1: "FILM-01-FOLLOWING-TOO-CLOSE-v13.mp4",
  2: "FILM-02-EYES-UP-v3.mp4",
  3: "FILM-03-BOXED-IN-v2.mp4",
  4: "FILM-04-FOUR-TIMES-v4.mp4",
  5: "FILM-05-PLAIN-SIGHT-v10.mp4",
};
/**
 * Where each target lives, read from the repository variables CI builds staging with (public values:
 * the staging web bundle carries all three), so a moved host or rotated key is not restated here.
 */
const ghVar = (name) => execFileSync("gh", ["variable", "get", name], { encoding: "utf8" }).trim();
const TARGETS = {
  staging: () => ({ ref: "dssmxlddtyimrwwuqwqq", api: ghVar("STAGING_API_URL"), supabase: ghVar("STAGING_VITE_SUPABASE_URL"), anonKey: ghVar("STAGING_VITE_SUPABASE_ANON_KEY") }),
  production: () => ({ ref: "nsjszqnfppczbnligxll", api: ghVar("PRODUCTION_VITE_API_URL"), supabase: ghVar("PRODUCTION_VITE_SUPABASE_URL"), anonKey: ghVar("PRODUCTION_VITE_SUPABASE_ANON_KEY") }),
};
const COURSE = { title: "Defensive driving, Act I", description: "Five short films: space, vision, position, speed, being seen. Three questions after each part." };
const filmTitle = (f) => `${String(f.no).padStart(2, "0")} ${f.title}`;

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const films = parseBank(readFileSync(BANK, "utf8"));
const only = opt("--films")?.split(",").map(Number);
const chosen = only ? films.filter((f) => only.includes(f.no)) : films;
console.log(`Bank: ${films.length} films, ${films.reduce((n, f) => n + questionsOf(f).length, 0)} questions; loading ${chosen.map((f) => f.no).join(", ")}.`);
if (flag("--check")) process.exit(0);

const targetName = opt("--target") ?? "";
const targetOf = TARGETS[targetName];
if (!targetOf) {
  console.error(`--target must be one of: ${Object.keys(TARGETS).join(", ")}.`);
  process.exit(2);
}
const isProduction = targetName === "production";
if (isProduction && !flag("--yes-production")) {
  console.error("Production needs --yes-production as well: this publishes films real drivers are sent.");
  process.exit(2);
}
const target = targetOf();
// The variables are the source of each address; the project ref pins which database they may name.
if (!target.supabase.includes(target.ref)) {
  console.error(`Refusing: ${target.supabase} is not the ${targetName} project (${target.ref}).`);
  process.exit(2);
}

/** Ask on the terminal with typing hidden; the answer never reaches the screen, history or a file. */
function askHidden(prompt) {
  if (!stdin.isTTY) {
    console.error(`"${prompt.trim()}" needs a Terminal, where typing is hidden: run this there, not in a chat or a pipe.`);
    process.exit(2);
  }
  return new Promise((resolve) => {
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    let typed = "";
    const onData = (buf) => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(typed);
          return;
        }
        if (ch === "\u0003") process.exit(130);
        typed = ch === "\u007f" ? typed.slice(0, -1) : typed + ch;
      }
    };
    stdin.on("data", onData);
  });
}

const email = process.env.TRAINING_LOAD_EMAIL;
if (!email) {
  console.error("Set TRAINING_LOAD_EMAIL (a member with Safety: manage).");
  process.exit(2);
}
// Production never takes a password from the environment: it is typed by the member it belongs to.
const password = (!isProduction && process.env.TRAINING_LOAD_PASSWORD) || (await askHidden(`Password for ${email} on ${targetName}: `));
for (const f of chosen) statSync(join(FILMS_DIR, FILE_OF[f.no]));

async function signIn() {
  const r = await fetch(`${target.supabase}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: target.anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`Sign-in refused (${r.status}): ${j.error_description ?? j.msg ?? "no token"}`);
  return j.access_token;
}

/**
 * An account with a verified authenticator signs in at `aal1` and the API answers 403
 * `second_factor_required` until the same session is raised to `aal2` (middleware/auth.ts). This does
 * what the sign-in page does: challenge the verified TOTP factor and verify the code the member types.
 */
async function raiseToAal2(aal1) {
  const auth = { apikey: target.anonKey, authorization: `Bearer ${aal1}`, "content-type": "application/json" };
  const user = await (await fetch(`${target.supabase}/auth/v1/user`, { headers: auth })).json();
  const factor = (user.factors ?? []).find((f) => f.factor_type === "totp" && f.status === "verified");
  if (!factor) return aal1;
  const challenge = await (await fetch(`${target.supabase}/auth/v1/factors/${factor.id}/challenge`, { method: "POST", headers: auth, body: "{}" })).json();
  if (!challenge.id) throw new Error(`Second-step challenge refused: ${challenge.msg ?? challenge.error_description ?? "no challenge"}`);
  const code = (await askHidden("6-digit code from your authenticator: ")).trim();
  const r = await fetch(`${target.supabase}/auth/v1/factors/${factor.id}/verify`, { method: "POST", headers: auth, body: JSON.stringify({ challenge_id: challenge.id, code }) });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`Code refused (${r.status}): ${j.msg ?? j.error_description ?? "no token"}`);
  return j.access_token;
}
const token = await raiseToAal2(await signIn());
/**
 * One device name for every run (0620's device key, `DEVICE_KEY_HEADER`), and a sign-out at the end:
 * each password sign-in is a new session, and a member holds at most `DEVICE_LIMIT` (3) devices, so a
 * loader that left its sessions behind locked its own login out after three runs (measured 2026-11-27,
 * `403 device_limit`).
 */
const DEVICE = { "x-silvicom-device": "training-loader-script" };
const signOut = () => fetch(`${target.supabase}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: target.anonKey, authorization: `Bearer ${token}` } }).catch(() => {});

/**
 * A merge redeploys staging in minutes, and while the API restarts it answers 502 (seen twice in one
 * hour, 2026-11-27). A read is simply asked again; a write is not, since it may have landed — the next
 * run's idempotent steps pick it up instead.
 */
async function api(path, init = {}) {
  for (let i = 0; ; i++) {
    try {
      return await apiOnce(path, init);
    } catch (e) {
      const restarting = /→ 50[234]\b/.test(e.message) || e.cause?.code === "ECONNRESET";
      if ((init.method ?? "GET") !== "GET" || !restarting || i >= 12) throw e;
      await sleep(10_000);
    }
  }
}

async function apiOnce(path, init = {}) {
  const r = await fetch(`${target.api}/api/training${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, ...DEVICE, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await r.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    j = { raw: text.slice(0, 200) };
  }
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${r.status} ${j.error?.code ?? ""}: ${j.error?.message ?? j.raw ?? ""}`);
  return j;
}
const catalogue = async () => (await api("/catalogue")).courses;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureCourse() {
  const live = (await catalogue()).find((c) => c.title === COURSE.title && !c.retiredAt);
  if (live) return live.id;
  const { id } = await api("/courses", { method: "POST", body: COURSE });
  console.log(`  course "${COURSE.title}" created`);
  return id;
}

async function ensureLesson(courseId, f) {
  const course = (await catalogue()).find((c) => c.id === courseId);
  const live = course?.lessons.find((l) => l.title === filmTitle(f) && !l.retiredAt);
  if (live) return live.id;
  const { id } = await api("/lessons", { method: "POST", body: { courseId, title: filmTitle(f) } });
  console.log(`  film "${filmTitle(f)}" created`);
  return id;
}

/** A film's version to load: a prepared one if there is one, else the newest still in progress. */
const versionOf = async (lessonId) => {
  for (const c of await catalogue())
    for (const l of c.lessons)
      if (l.id === lessonId) {
        const live = l.versions.filter((v) => v.state !== "withdrawn" && v.state !== "failed");
        return live.find((v) => v.state === "ready" || v.state === "published") ?? live[0] ?? null;
      }
  return null;
};

async function upload(lessonId, f) {
  const path = join(FILMS_DIR, FILE_OF[f.no]);
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const place = await api("/uploads", { method: "POST", body: { lessonId, fileName: basename(path), bytes: bytes.length, sha256 } });
  const put = await fetch(place.uploadUrl, { method: "PUT", headers: { "content-type": "video/mp4" }, body: bytes });
  if (!put.ok) throw new Error(`${basename(path)} did not upload: ${put.status} ${(await put.text()).slice(0, 200)}`);
  await api(`/versions/${place.versionId}/uploaded`, { method: "POST" });
  console.log(`  ${filmTitle(f)}: uploaded ${basename(path)} (${(bytes.length / 1e6).toFixed(1)} MB); preparing for phones`);
}

async function ensureUpload(lessonId, f) {
  const have = await versionOf(lessonId);
  // A draft is an upload that was given a place but never confirmed (a run stopped mid-PUT): confirm it,
  // and if the bytes never arrived the API refuses and says so.
  if (have?.state === "draft") await api(`/versions/${have.id}/uploaded`, { method: "POST" });
  else if (!have) await upload(lessonId, f);
}

/**
 * Wait until every film has a prepared version (the 360/540/720p copies and the poster, `trainingTranscode`),
 * starting the queue ONE film at a time.
 *
 * ⚠ Staging only. `/uploaded` queues the film's job and kicks ONE drain in the API process, which claims
 * the OLDEST queued `training_transcode` row (`claim_next_job` orders by `created_at`). A row a deploy
 * interrupted goes back to the queue, and only the `general` lane's drain takes it from there, which
 * staging does not run (`infra/server/staging.env` RUN_SCHEDULERS=false; until 2026-11-27 Railway's
 * retired `uat` held it at a commit that predates training). Since #2691 a second `/uploaded` on a film
 * already queued kicks the drain again instead of answering 500, so this asks it for one waiting film,
 * waits for one more film to be prepared, and asks again: one conversion at a time, about 2–3 minutes on
 * staging's t4g.medium, fits between merges; five at once did not (2026-11-27: all six running were
 * interrupted by one deploy). A kick that a deploy interrupts shows as no progress for 6 minutes, and is
 * asked again. Production is unaffected (its worker holds `general`).
 */
async function waitAllReady(lessons) {
  const started = Date.now();
  let lastReady = -1;
  let kickedAt = 0;
  for (;;) {
    const states = await Promise.all(lessons.map(async ({ f, lessonId }) => ({ f, v: await versionOf(lessonId) })));
    const failed = states.filter((s) => !s.v);
    if (failed.length) throw new Error(`no live version for ${failed.map((s) => filmTitle(s.f)).join(", ")} (failed?) — see the Videos tab`);
    const waiting = states.filter((s) => !["ready", "published"].includes(s.v.state));
    if (!waiting.length) return;
    const ready = states.length - waiting.length;
    const moved = ready !== lastReady;
    if (moved) console.log(`  prepared ${ready} of ${states.length}`);
    if (moved || Date.now() - kickedAt > 6 * 60_000) {
      await api(`/versions/${waiting[0].v.id}/uploaded`, { method: "POST" });
      if (!moved) console.log("  nothing prepared for 6 min (a deploy?); started the queue again");
      kickedAt = Date.now();
      lastReady = ready;
    }
    if (Date.now() - started > 60 * 60_000) throw new Error(`still preparing ${waiting.map((s) => filmTitle(s.f)).join(", ")} after an hour — see the training_transcode rows in \`jobs\``);
    await sleep(15_000);
  }
}

async function load(f, lessonId) {
  console.log(`Film ${filmTitle(f)}`);
  const v = await versionOf(lessonId);
  const versionId = v.id;
  if (v.state === "published") {
    console.log(`  already published (${v.questionCount} questions) — left as it is`);
    return;
  }
  const chapters = chaptersOf(f);
  if (chapters[chapters.length - 1].startMs >= v.durationMs) throw new Error(`Closing at ${chapters.at(-1).startMs} ms is past the film's ${v.durationMs} ms`);
  if (JSON.stringify(v.chapters) !== JSON.stringify(chapters)) {
    await api(`/versions/${versionId}`, { method: "PATCH", body: { chapters } });
    console.log(`  chapters: ${chapters.map((c) => `${c.title} ${Math.round(c.startMs / 1000)}s`).join(" · ")}`);
  }
  const existing = (await api(`/versions/${versionId}/questions`)).questions;
  const key = (q) => `${q.chapter}|${q.point}|${q.prompt.trim()}`;
  const have = new Set(existing.map(key));
  let added = 0;
  for (const q of questionsOf(f)) {
    if (have.has(key(q))) continue;
    await api(`/versions/${versionId}/questions`, { method: "POST", body: q });
    added++;
  }
  console.log(`  questions: ${added} added, ${questionsOf(f).length - added} already there`);
  if (flag("--publish")) {
    const out = await api(`/versions/${versionId}/publish`, { method: "POST" });
    console.log(`  published${out.withdrew ? " (withdrew the older cut)" : ""}`);
  }
}

let failed = 0;
try {
  const courseId = await ensureCourse();
  const lessons = [];
  for (const f of chosen) {
    const lessonId = await ensureLesson(courseId, f);
    await ensureUpload(lessonId, f);
    lessons.push({ f, lessonId });
  }
  await waitAllReady(lessons);
  for (const { f, lessonId } of lessons) {
    try {
      await load(f, lessonId);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${e.message}`);
    }
  }
} catch (e) {
  failed = chosen.length;
  console.error(`✗ ${e.message}`);
} finally {
  await signOut();
}
console.log(failed ? `${failed} film(s) not finished — fix and run again; done steps are skipped.` : "All films loaded.");
process.exit(failed ? 1 : 0);
