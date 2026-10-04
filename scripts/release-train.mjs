#!/usr/bin/env node
/**
 * The release train's decisions, in one place both workflows call (RELEASE-TRAIN-PLAN R5).
 *
 * `release-candidate.yml` (18:00 CT) and `release.yml` (01:00 CT) used to be planned as two long
 * shell scripts. Every rule they share — which date a release is named for, whether tonight is a
 * release night, what changed since the last release — would then be written twice, and a pair of
 * restated rules is a workaround with a delay fuse. They live here instead, pure where they can be,
 * with a self-test that `lint:release-train` runs in CI's `gates` job.
 *
 * Subcommands (all print to stdout, all exit non-zero on a usage error):
 *   tag <existing tags…>          the CalVer tag for a release made NOW (D-REL10): vYYYY.MM.DD, the
 *                                 Central date, with .N appended when that name is taken (a hotfix
 *                                 the same day)
 *   night                         "release" or "rest": does tonight's 01:00 run ship? (D-REL7)
 *   notes <before> <after>        the release notes, markdown: every merged PR, migrations and
 *                                 driver-app changes called out (D-REL5)
 *   driver-changed <before> <after>  "yes" or "no": does the range touch what the driver app ships?
 *   --self-test
 */
import { execFileSync } from "node:child_process";

const TZ = "America/Chicago";

/** The Central calendar date of `now`, as YYYY.MM.DD. Pure. */
export function centralDate(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}.${p.month}.${p.day}`;
}

/** The first free tag for a release at `now`: vYYYY.MM.DD, then .1, .2… Pure. */
export function releaseTag(now, existing) {
  const base = `v${centralDate(now)}`;
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let n = 1; ; n++) if (!taken.has(`${base}.${n}`)) return `${base}.${n}`;
}

/**
 * Does a release that runs at `now` ship? D-REL7: release NIGHTS are Sunday–Thursday, so a bad
 * release lands on a weekday morning with somebody looking. The 01:00 run of a Sunday night happens
 * on Monday's date, so the run ships on Central Monday–Friday and rests on Saturday and Sunday. Pure.
 */
export function isReleaseNight(now) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(now);
  return !["Sat", "Sun"].includes(day);
}

/** What the driver app ships: its own tree and the workspace packages it bundles (driver-ota.yml's paths). */
export const DRIVER_PATHS = ["apps/driver/", "packages/"];
export const driverChanged = (files) => files.some((f) => DRIVER_PATHS.some((p) => f.startsWith(p)));
export const migrationsIn = (files) =>
  files.filter((f) => /^supabase\/migrations\/\d{4}_.+\.sql$/.test(f)).map((f) => f.split("/").pop()).sort();

/** `git log --first-parent --merges` subjects → PR numbers, oldest first. Pure. */
export function prNumbers(subjects) {
  return subjects.map((s) => /^Merge pull request #(\d+) /.exec(s)?.[1]).filter(Boolean).map(Number).reverse();
}

/** The notes, markdown. `prs` is [{ number, title }]. Pure. */
export function renderNotes({ before, after, prs, migrations, driver }) {
  const lines = [`Changes \`${before.slice(0, 7)}\` → \`${after.slice(0, 7)}\` — ${prs.length} pull request(s).`, ""];
  if (migrations.length) {
    lines.push("**⚠ Migrations — applied to production BEFORE the code (D-REL6):**");
    for (const m of migrations) lines.push(`- \`${m}\``);
    lines.push("");
  }
  lines.push(driver ? "**Driver app:** changed — an OTA update (or an APK, if native code moved) follows the deploy." : "**Driver app:** unchanged.", "");
  lines.push("**Merged:**");
  for (const p of prs) lines.push(`- #${p.number} ${p.title}`);
  if (!prs.length) lines.push("- (none — direct commits only)");
  return lines.join("\n");
}

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const changedFiles = (before, after) => (before ? git("diff", "--name-only", before, after) : git("ls-tree", "-r", "--name-only", after))
  .split("\n").filter(Boolean);

function notes(before, after) {
  const files = changedFiles(before, after);
  const subjects = git("log", "--first-parent", "--merges", "--format=%s", before ? `${before}..${after}` : after, "--max-count=200")
    .split("\n").filter(Boolean);
  const prs = prNumbers(subjects).map((number) => {
    let title = "(title unavailable)";
    try { title = execFileSync("gh", ["pr", "view", String(number), "--json", "title", "--jq", ".title"], { encoding: "utf8" }).trim(); } catch {}
    return { number, title };
  });
  return renderNotes({ before: before || after, after, prs, migrations: migrationsIn(files), driver: driverChanged(files) });
}

function selfTest() {
  let fail = 0, n = 0;
  const eq = (name, got, want) => {
    n++;
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — got ${JSON.stringify(got)}`}`);
  };
  // 06:07 UTC is 01:07 CDT the SAME date; 05:30 UTC is still the previous Central date.
  eq("the tag is the Central date", releaseTag(new Date("2026-10-05T06:07:00Z"), []), "v2026.10.05");
  eq("…not the UTC date, just after UTC midnight", releaseTag(new Date("2026-10-05T04:30:00Z"), []), "v2026.10.04");
  eq("a second release the same day is .1", releaseTag(new Date("2026-10-05T15:00:00Z"), ["v2026.10.05"]), "v2026.10.05.1");
  eq("a third is .2", releaseTag(new Date("2026-10-05T15:00:00Z"), ["v2026.10.05", "v2026.10.05.1"]), "v2026.10.05.2");
  eq("Monday 01:07 CT (Sunday night) ships", isReleaseNight(new Date("2026-10-05T06:07:00Z")), true);
  eq("Friday 01:07 CT (Thursday night) ships", isReleaseNight(new Date("2026-10-09T06:07:00Z")), true);
  eq("Saturday 01:07 CT (Friday night) rests", isReleaseNight(new Date("2026-10-10T06:07:00Z")), false);
  eq("Sunday 01:07 CT (Saturday night) rests", isReleaseNight(new Date("2026-10-11T06:07:00Z")), false);
  eq("winter: Monday 00:07 CST is still Monday", isReleaseNight(new Date("2026-12-07T06:07:00Z")), true);
  eq("driver tree counts", driverChanged(["apps/driver/app.json"]), true);
  eq("shared packages count", driverChanged(["packages/shared/src/x.ts"]), true);
  eq("the web app does not", driverChanged(["apps/web/src/x.vue", "docs/a.md"]), false);
  eq("migrations are listed by name, sorted",
    migrationsIn(["supabase/migrations/0424_b.sql", "apps/x.ts", "supabase/migrations/0423_a.sql", "supabase/tests/x.mjs"]),
    ["0423_a.sql", "0424_b.sql"]);
  eq("PR numbers come oldest first, and non-PR merges are ignored",
    prNumbers(["Merge pull request #12 from a/b", "Merge branch 'main' into x", "Merge pull request #10 from a/c"]), [10, 12]);
  const md = renderNotes({ before: "a".repeat(40), after: "b".repeat(40), prs: [{ number: 7, title: "T" }], migrations: ["0423_a.sql"], driver: false });
  eq("notes call out a migration", md.includes("`0423_a.sql`") && md.includes("BEFORE the code"), true);
  eq("notes list the PR", md.includes("- #7 T"), true);
  console.log(`\nRESULT: ${n - fail} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "--self-test") selfTest();
else if (cmd === "tag") console.log(releaseTag(new Date(), args));
else if (cmd === "night") console.log(isReleaseNight(new Date()) ? "release" : "rest");
else if (cmd === "notes" && args.length === 2) console.log(notes(args[0], args[1]));
else if (cmd === "driver-changed" && args.length === 2) console.log(driverChanged(changedFiles(args[0], args[1])) ? "yes" : "no");
else {
  console.error("usage: release-train.mjs tag <tags…> | night | notes <before> <after> | driver-changed <before> <after> | --self-test");
  process.exit(2);
}
