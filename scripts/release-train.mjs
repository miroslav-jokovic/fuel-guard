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
 *   area <files…>                 the area label a PR with these files gets (R6), e.g. `area:fuel`
 *   marker <sha>                  the line release-candidate.yml writes into the PR body (D-REL14)
 *   approval <pr>                 `<sha> <github|console> <who>` — tonight's go signal, or nothing
 *                                 (D-REL5 + D-REL14; needs GITHUB_REPOSITORY, gh auth, and
 *                                 SUPABASE_ACCESS_TOKEN/SUPABASE_PROJECT_REF for the console half)
 *   --self-test
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

/**
 * The areas a release's notes are grouped by (R6, D-REL10), in the order the notes print them.
 *
 * An area is derived from the files a PR touches, never typed by whoever opens it: a label that
 * depends on somebody remembering is the label half the PRs lack. `pr-area.yml` applies the result
 * as an `area:<id>` label, which a person may change; the notes then read that label. The rules are
 * keyed by the repository's own module and feature directories (docs/ARCHITECTURE.md §2–§4), and the
 * self-test fails when a directory exists that no rule names — so a new module cannot fall silently
 * into "Platform".
 */
export const AREAS = [
  { id: "fuel", title: "Fuel",
    api: ["efs", "fuel", "fuel-spend", "idle", "posted-prices", "anomalies", "routing"],
    web: ["fuel", "fuelCards", "fueling", "idle", "anomalies", "reconcile", "import"], plans: ["fuel"] },
  { id: "maintenance", title: "Maintenance and inventory",
    api: ["maintenance", "fleetpal"], web: ["maintenance", "inventory"], packages: ["qr"], plans: ["maintenance"] },
  { id: "drivers", title: "Drivers, hiring and compliance",
    api: ["recruiting", "evidence", "psp", "roster", "hazmat", "performance"],
    web: ["apply", "recruitment", "compliance", "drivers", "roster", "hazmat", "legal"],
    packages: ["hazmat-data", "hazmat-engine", "hazmat-golden", "hazmat-placards"],
    plans: ["recruitment", "roster", "safety-dqf", "hazmat-consolidation"] },
  { id: "dispatch", title: "Dispatch and live map",
    api: ["loads", "livemap", "samsara", "messaging"], web: ["dispatch", "livemap", "messages"],
    plans: ["dispatch-loads", "livemap", "loads-detail", "samsara", "sms"] },
  { id: "finance", title: "Finance",
    api: ["financial", "accounting", "billing", "mcleod", "ifta"], web: ["accounting", "billing", "ifta"],
    plans: ["financial", "mcleod"] },
  { id: "reports", title: "Reports and dashboard", api: ["insights"], web: ["reports", "dashboard"] },
  { id: "driver-app", title: "Driver app",
    api: ["driver-app"], apps: ["driver", "driver-dist"], packages: ["capture-engine"], plans: ["drivers-app"] },
  // Everything a person does not see as a feature: org and permissions, settings, the admin console,
  // shared UI and contracts, CI, scripts. Also where an unmapped file lands.
  { id: "platform", title: "Platform",
    api: ["org"], web: ["audit", "jobs", "permissions", "settings"], apps: ["admin", "admin-api"],
    packages: ["shared", "ui", "tokens"],
    plans: ["architecture", "ci", "design-system", "permissions", "platform-console", "product-readiness", "ship-pipeline", "silvicom360"] },
  { id: "docs", title: "Plans and docs" },
];

/** The area one file belongs to, or null for a file that says nothing about area. Pure. */
export function fileArea(file) {
  // Schema and its PGlite matrices say nothing about area (migrations are called out on their own,
  // BEFORE the code); a unit test follows its directory.
  if (file.startsWith("supabase/")) return null;
  if (file.startsWith("docs/") || /^[^/]+\.md$/.test(file) || /\/CLAUDE\.md$/.test(file)) return "docs";
  // [prefix, AREAS key]: the directory right after the prefix is what the rules name.
  const roots = [["apps/api/src/modules/", "api"], ["apps/web/src/features/", "web"], ["packages/", "packages"], ["apps/", "apps"]];
  const root = roots.find(([prefix]) => file.startsWith(prefix));
  const m = root && { key: root[1], dir: file.slice(root[0].length).split("/")[0] };
  const hit = m && AREAS.find((a) => a[m.key]?.includes(m.dir));
  return hit ? hit.id : "platform";
}

/** The area of the plan folder a doc sits in (docs/plans/<dir>/), or null. Pure. */
export function planArea(file) {
  const dir = /^docs\/plans\/([^/]+)\//.exec(file)?.[1];
  return AREAS.find((a) => a.plans?.includes(dir))?.id ?? null;
}

/**
 * A PR's one area, by the strongest evidence it has: the area most of its CODE files belong to
 * (earlier in AREAS on a tie); else, for a PR that is only schema and docs, the plan folder its docs
 * sit in — plans are filed by area, so a migration's plan names its area (C1b, 0425, is
 * maintenance); else "docs" for docs alone, "platform" for anything left. Pure.
 */
export function prArea(files) {
  const order = (id) => AREAS.findIndex((a) => a.id === id);
  const most = (ids) => {
    const counts = new Map();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts].sort(([a, x], [b, y]) => y - x || order(a) - order(b))[0]?.[0] ?? null;
  };
  const areas = files.map(fileArea);
  return most(areas.filter((a) => a && a !== "docs")) ?? most(files.map(planArea).filter(Boolean)) ??
    (areas.includes("docs") ? "docs" : "platform");
}

/** `git log --first-parent --merges` subjects → PR numbers, oldest first. Pure. */
export function prNumbers(subjects) {
  return subjects.map((s) => /^Merge pull request #(\d+) /.exec(s)?.[1]).filter(Boolean).map(Number).reverse();
}

/** The notes, markdown. `prs` is [{ number, title, area }], area an AREAS id. Pure. */
export function renderNotes({ before, after, prs, migrations, driver }) {
  const lines = [`Changes \`${before.slice(0, 7)}\` → \`${after.slice(0, 7)}\` — ${prs.length} pull request(s).`, ""];
  if (migrations.length) {
    lines.push("**⚠ Migrations — applied to production BEFORE the code (D-REL6):**");
    for (const m of migrations) lines.push(`- \`${m}\``);
    lines.push("");
  }
  lines.push(driver ? "**Driver app:** changed — an OTA update (or an APK, if native code moved) follows the deploy." : "**Driver app:** unchanged.", "");
  if (!prs.length) lines.push("**Merged:**", "- (none — direct commits only)");
  for (const area of AREAS) {
    const these = prs.filter((p) => (p.area ?? "platform") === area.id);
    if (!these.length) continue;
    lines.push(`**${area.title}:**`);
    for (const p of these) lines.push(`- #${p.number} ${p.title}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/**
 * D-REL14: the release PR's body names the commit its notes describe, so the console approves THAT
 * commit and not main's head, which moves after 18:00. `release-candidate.yml` writes the marker;
 * admin-api's `candidateShaFrom` reads it (its test holds the two together). Pure.
 */
export const candidateMarker = (sha) => `<!-- release-candidate-sha: ${sha} -->`;

/**
 * release.yml's read of the console's approvals (0440): the newest live one for this PR whose
 * approver is STILL an active platform_owner — a suspended or demoted owner's yes stops counting
 * the moment they are. `pr` is checked to be an integer because the management API takes no
 * parameters. supabase/tests/platform-release-approvals.test.mjs runs this exact text.
 */
export function consoleApprovalSql(pr) {
  if (!Number.isInteger(pr) || pr <= 0) throw new Error(`not a PR number: ${pr}`);
  return `select a.commit_sha, a.approved_at, p.email
  from platform_release_approvals a join platform_admins p on p.id = a.approved_by
  where a.pr_number = ${pr} and a.revoked_at is null and p.role = 'platform_owner' and p.status = 'active'
  order by a.approved_at desc limit 1`;
}

/**
 * Tonight's go signal (D-REL5 + D-REL14): the NEWER of the latest GitHub admin review and the
 * latest console approval, or null. Each is `{ sha, at, who }` or null. Newer wins because either
 * one is the owner changing their mind: re-approving a refreshed PR in the console after an old
 * GitHub review must ship what they approved last. Pure.
 */
export function goSignal(github, console_) {
  if (!github || !console_) return github ?? console_ ?? null;
  return Date.parse(console_.at) > Date.parse(github.at) ? console_ : github;
}

/** The latest review by a human repository ADMIN; anyone else's approval is ignored (D-REL5). */
function githubApproval(repo, pr) {
  const reviews = JSON.parse(execFileSync("gh", ["api", "--paginate", "--slurp", `repos/${repo}/pulls/${pr}/reviews`], { encoding: "utf8" })).flat()
    .filter((r) => r.state === "APPROVED" && r.user?.type === "User");
  let last = null;
  for (const r of reviews) {
    let perm = "none";
    try {
      perm = execFileSync("gh", ["api", `repos/${repo}/collaborators/${r.user.login}/permission`, "--jq", ".permission"], { encoding: "utf8" }).trim();
    } catch { /* not a collaborator any more */ }
    if (perm === "admin") last = { sha: r.commit_id, at: r.submitted_at, who: r.user.login, via: "github" };
  }
  return last;
}

/** The console's approval (0440), read from production through Supabase's management API. */
async function consoleApproval(pr, env) {
  if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_PROJECT_REF) throw new Error("no SUPABASE_ACCESS_TOKEN/SUPABASE_PROJECT_REF");
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query: consoleApprovalSql(pr), read_only: true }),
  });
  if (!res.ok) throw new Error(`management API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const [row] = await res.json();
  return row ? { sha: row.commit_sha, at: new Date(row.approved_at).toISOString(), who: row.email, via: "console" } : null;
}

/**
 * `approval <pr>`: prints `<sha> <via> <who>` for tonight's go signal, or nothing. A console read
 * that fails is a warning on stderr and the GitHub review alone decides (D-REL14 rule 4): the table
 * reaches production only in a release, and an unreachable management API must not stop one that
 * was approved on GitHub. A failed GitHub read still fails the run, as it did before D-REL14.
 */
async function approval(pr, env) {
  const github = githubApproval(env.GITHUB_REPOSITORY, pr);
  let fromConsole = null;
  try {
    fromConsole = await consoleApproval(pr, env);
  } catch (e) {
    console.error(`::warning::Could not read console approvals (${e.message}) — GitHub reviews alone decide tonight.`);
  }
  const go = goSignal(github, fromConsole);
  return go ? `${go.sha} ${go.via} ${go.who}` : "";
}

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const changedFiles = (before, after) => (before ? git("diff", "--name-only", before, after) : git("ls-tree", "-r", "--name-only", after))
  .split("\n").filter(Boolean);

function notes(before, after) {
  const files = changedFiles(before, after);
  const subjects = git("log", "--first-parent", "--merges", "--format=%s", before ? `${before}..${after}` : after, "--max-count=200")
    .split("\n").filter(Boolean);
  const prs = prNumbers(subjects).map((number) => {
    // The PR's area label wins (a person may have corrected it); without one — a PR merged before
    // pr-area.yml existed, or a failed labelling run — the area is worked out from its files.
    let pr = { title: "(title unavailable)", labels: [], files: [] };
    try {
      pr = JSON.parse(execFileSync("gh", ["pr", "view", String(number), "--json", "title,labels,files"], { encoding: "utf8" }));
    } catch { /* the notes still list the number; one missing PR must not stop a release */ }
    const label = pr.labels?.map((l) => l.name).find((n) => n.startsWith("area:"))?.slice(5);
    const area = AREAS.some((a) => a.id === label) ? label : prArea((pr.files ?? []).map((f) => f.path));
    return { number, title: pr.title, area };
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
  const md = renderNotes({ before: "a".repeat(40), after: "b".repeat(40), prs: [{ number: 7, title: "T", area: "fuel" }], migrations: ["0423_a.sql"], driver: false });
  eq("notes call out a migration", md.includes("`0423_a.sql`") && md.includes("BEFORE the code"), true);
  eq("notes list the PR", md.includes("- #7 T"), true);
  const grouped = renderNotes({ before: "a".repeat(40), after: "b".repeat(40), migrations: [], driver: false,
    prs: [{ number: 9, title: "Map", area: "dispatch" }, { number: 8, title: "Idle", area: "fuel" }, { number: 10, title: "Odd" }] });
  eq("notes group PRs by area, in AREAS order, unknown area under Platform",
    grouped.split("\n").filter((l) => l.startsWith("**") || l.startsWith("- #")),
    ["**Driver app:** unchanged.", "**Fuel:**", "- #8 Idle", "**Dispatch and live map:**", "- #9 Map", "**Platform:**", "- #10 Odd"]);
  eq("a file in a mapped api module", fileArea("apps/api/src/modules/fleetpal/sync.ts"), "maintenance");
  eq("a file in a mapped web feature", fileArea("apps/web/src/features/fuelCards/x.vue"), "fuel");
  eq("the driver app", fileArea("apps/driver/src/features/scanner/a.tsx"), "driver-app");
  eq("a grandfathered api route lands in Platform", fileArea("apps/api/src/routes/version.ts"), "platform");
  eq("a migration says nothing about area", fileArea("supabase/migrations/0425_x.sql"), null);
  eq("the PR's area is where most of its files are",
    prArea(["apps/web/src/features/inventory/a.vue", "apps/api/src/modules/maintenance/b.ts", "apps/web/src/lib/c.ts"]), "maintenance");
  eq("docs never outvote code", prArea(["docs/a.md", "docs/b.md", "docs/c.md", "apps/web/src/features/ifta/x.vue"]), "finance");
  eq("a docs-only PR is docs", prArea(["docs/plans/x.md", "CLAUDE.md"]), "docs");
  eq("a migration-only PR is platform", prArea(["supabase/migrations/0425_x.sql"]), "platform");
  eq("a schema PR takes its plan folder's area",
    prArea(["supabase/migrations/0425_x.sql", "supabase/tests/x.test.mjs", "docs/plans/maintenance/P.md"]), "maintenance");
  eq("a docs-only PR in an area's plan folder takes that area", prArea(["docs/plans/fuel/HANDOFF.md"]), "fuel");
  const gh = { sha: "a".repeat(40), at: "2026-10-08T20:00:00Z", who: "owner", via: "github" };
  const con = { sha: "b".repeat(40), at: "2026-10-08T23:00:00Z", who: "owner@example.com", via: "console" };
  eq("no signal, no release", goSignal(null, null), null);
  eq("a GitHub review alone ships", goSignal(gh, null), gh);
  eq("a console approval alone ships", goSignal(null, con), con);
  eq("the newer of the two wins (console later)", goSignal(gh, con), con);
  eq("the newer of the two wins (GitHub later)", goSignal({ ...gh, at: "2026-10-09T00:00:00Z" }, con).via, "github");
  eq("the marker carries the full commit", candidateMarker("c".repeat(40)), `<!-- release-candidate-sha: ${"c".repeat(40)} -->`);
  let refused = false;
  try { consoleApprovalSql("1; drop table x"); } catch { refused = true; }
  eq("the console query takes only an integer PR number", refused, true);
  // Every module, feature, app and package directory that exists must be named by exactly one rule.
  const where = { api: "apps/api/src/modules", web: "apps/web/src/features", apps: "apps", packages: "packages", plans: "docs/plans" };
  for (const [key, dir] of Object.entries(where)) {
    const dirs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      // api and web are split by module/feature above; archived plans belong to no area.
      .filter((d) => !(key === "apps" && ["api", "web"].includes(d)) && !(key === "plans" && d === "archive"));
    const named = (d) => AREAS.filter((a) => a[key]?.includes(d)).length;
    eq(`every ${dir}/ directory is named by exactly one area`, dirs.filter((d) => named(d) !== 1), []);
    eq(`no area names a ${dir}/ directory that does not exist`, AREAS.flatMap((a) => a[key] ?? []).filter((d) => !dirs.includes(d)), []);
  }
  console.log(`\nRESULT: ${n - fail} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}

// Run as a command only; imported (apps/api's releaseVersion test holds the API's tag pattern to
// `releaseTag`), it only exports.
const [cmd, ...args] = process.argv.slice(2);
if (import.meta.url !== pathToFileURL(process.argv[1] ?? "").href) { /* imported */ }
else if (cmd === "--self-test") selfTest();
else if (cmd === "tag") console.log(releaseTag(new Date(), args));
else if (cmd === "night") console.log(isReleaseNight(new Date()) ? "release" : "rest");
else if (cmd === "notes" && args.length === 2) console.log(notes(args[0], args[1]));
else if (cmd === "area") console.log(`area:${prArea(args)}`);
else if (cmd === "driver-changed" && args.length === 2) console.log(driverChanged(changedFiles(args[0], args[1])) ? "yes" : "no");
else if (cmd === "marker" && args.length === 1) console.log(candidateMarker(args[0]));
else if (cmd === "approval" && /^\d+$/.test(args[0] ?? "")) console.log(await approval(Number(args[0]), process.env));
else {
  console.error("usage: release-train.mjs tag <tags…> | night | notes <before> <after> | area <files…> | driver-changed <before> <after> | marker <sha> | approval <pr> | --self-test");
  process.exit(2);
}
