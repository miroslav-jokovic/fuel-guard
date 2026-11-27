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
 * ⚠ Staging only for now. Production waits for the safety review of all 84 (§5 ⚠, §6 step 4) and the
 * owner's go; `--target production` is refused until that is recorded in the plan and this line changes.
 * Pass the password through the environment, never on a command line (it would sit in shell history).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
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
  staging: () => ({ api: ghVar("STAGING_API_URL"), supabase: ghVar("STAGING_VITE_SUPABASE_URL"), anonKey: ghVar("STAGING_VITE_SUPABASE_ANON_KEY") }),
};
/** Staging's Supabase project; every run refuses another one, whatever the variables say. */
const STAGING_REF = "dssmxlddtyimrwwuqwqq";
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

const targetOf = TARGETS[opt("--target") ?? ""];
if (!targetOf) {
  console.error(`--target must be one of: ${Object.keys(TARGETS).join(", ")}. Production waits for the safety review and the owner's go.`);
  process.exit(2);
}
const target = targetOf();
if (!target.supabase.includes(STAGING_REF)) {
  console.error(`Refusing: ${target.supabase} is not the staging project.`);
  process.exit(2);
}
const email = process.env.TRAINING_LOAD_EMAIL;
const password = process.env.TRAINING_LOAD_PASSWORD;
if (!email || !password) {
  console.error("Set TRAINING_LOAD_EMAIL and TRAINING_LOAD_PASSWORD (a member with Safety: manage).");
  process.exit(2);
}
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
const token = await signIn();

async function api(path, init = {}) {
  const r = await fetch(`${target.api}/api/training${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
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

const versionOf = async (lessonId) => {
  for (const c of await catalogue()) for (const l of c.lessons) if (l.id === lessonId) return l.versions.find((v) => v.state !== "withdrawn" && v.state !== "failed") ?? null;
  return null;
};

async function ensureUpload(lessonId, f) {
  const have = await versionOf(lessonId);
  // A draft is an upload that was given a place but never confirmed (a run stopped mid-PUT): confirm it,
  // and if the bytes never arrived the API refuses and says so.
  if (have?.state === "draft") await api(`/versions/${have.id}/uploaded`, { method: "POST" });
  if (have) return have.id;
  const path = join(FILMS_DIR, FILE_OF[f.no]);
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const place = await api("/uploads", { method: "POST", body: { lessonId, fileName: basename(path), bytes: bytes.length, sha256 } });
  const put = await fetch(place.uploadUrl, { method: "PUT", headers: { "content-type": "video/mp4" }, body: bytes });
  if (!put.ok) throw new Error(`${basename(path)} did not upload: ${put.status} ${(await put.text()).slice(0, 200)}`);
  await api(`/versions/${place.versionId}/uploaded`, { method: "POST" });
  console.log(`  uploaded ${basename(path)} (${(bytes.length / 1e6).toFixed(1)} MB); preparing for phones`);
  return place.versionId;
}

/** The worker makes the 360/540/720p copies and the poster (`trainingTranscode`); a film is ~3½ min. */
async function waitReady(lessonId, versionId) {
  for (let i = 0; i < 90; i++) {
    const v = await versionOf(lessonId);
    if (!v || v.id !== versionId) throw new Error(`version ${versionId} disappeared (failed or withdrawn) — see the Videos tab`);
    if (v.state === "ready" || v.state === "published") return v;
    if (v.processError) throw new Error(`preparing failed: ${v.processError}`);
    await sleep(10_000);
  }
  throw new Error("still preparing after 15 minutes — is the staging worker running the trainingTranscode queue?");
}

async function load(courseId, f) {
  console.log(`Film ${filmTitle(f)}`);
  const lessonId = await ensureLesson(courseId, f);
  const versionId = await ensureUpload(lessonId, f);
  const v = await waitReady(lessonId, versionId);
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

const courseId = await ensureCourse();
let failed = 0;
for (const f of chosen) {
  try {
    await load(courseId, f);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${e.message}`);
  }
}
console.log(failed ? `${failed} film(s) not finished — fix and run again; done steps are skipped.` : "All films loaded.");
process.exit(failed ? 1 : 0);
