#!/usr/bin/env node
/**
 * Fitness function — every ads model worker's prompt, fixtures and baseline agree (ADS-AGENT-BUILD-WORKFLOW C2,
 * §4R "Claude replay + live eval").
 *
 * A model worker is a prompt pack in `apps/api/src/modules/ads/workers/<worker>/`: `prompt.v<N>.md`, the worker
 * `<worker>.ts` that reads it, `fixtures/*.json` (recorded and planted answers), `baseline.json` (what
 * `pnpm ads:eval <worker> --record` measured) and `<worker>.test.ts` (the CI replay). The replay test proves the
 * recorded answers reach their verdicts; what it cannot see is a recording made under a prompt that is no
 * longer the one in force — then CI replays answers the shipped prompt never produced, stays green, and means
 * nothing. So this gate holds, for every worker:
 *   1. the worker reads its NEWEST prompt file and names that version as `"<worker>@<N>"`;
 *   2. every fixture parses to the shape `agentFixtures.ts` reads, its `name` is its file name, and it was
 *      recorded under that version — a prompt change is a re-record in the same PR;
 *   3. a `model` recording is a real one (no placeholder model, a non-null output), and there is at least one
 *      model and one planted fixture;
 *   4. `baseline.json` was measured under that version over exactly these fixtures;
 *   5. the replay test exists, loads the fixtures, and skips, focuses or defers nothing.
 * `--self-test` plants each violation in a temporary copy and proves the gate refuses it.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const WORKERS = join(ROOT, "apps/api/src/modules/ads/workers");

/** Every problem with the prompt packs under `dir`, as sentences. */
export function check(dir) {
  const problems = [];
  const workers = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    .filter((w) => readdirSync(join(dir, w)).some((f) => /^prompt\.v\d+\.md$/.test(f)));
  if (workers.length === 0) problems.push(`no prompt packs found under ${dir}`);
  for (const w of workers) {
    const at = join(dir, w);
    const say = (msg) => problems.push(`${w}: ${msg}`);
    const n = Math.max(...readdirSync(at).flatMap((f) => /^prompt\.v(\d+)\.md$/.exec(f)?.[1] ?? []).map(Number));
    const version = `${w}@${n}`;
    const src = existsSync(join(at, `${w}.ts`)) ? readFileSync(join(at, `${w}.ts`), "utf8") : null;
    if (src === null) say(`${w}.ts is missing`);
    else {
      if (!src.includes(`new URL("./prompt.v${n}.md"`)) say(`${w}.ts does not read prompt.v${n}.md, the newest prompt`);
      if (!src.includes(`"${version}"`)) say(`${w}.ts does not name its prompt version "${version}"`);
    }
    const fxDir = join(at, "fixtures");
    const files = existsSync(fxDir) ? readdirSync(fxDir).filter((f) => f.endsWith(".json")).sort() : [];
    const sources = { model: 0, planted: 0 };
    for (const f of files) {
      let fx;
      try { fx = JSON.parse(readFileSync(join(fxDir, f), "utf8")); } catch { say(`fixtures/${f} is not JSON`); continue; }
      const r = fx.recorded ?? {};
      if (`${fx.name}.json` !== f) say(`fixtures/${f} is named "${fx.name}"`);
      if (typeof fx.about !== "string" || fx.about.length < 10) say(`fixtures/${f} does not say what it is about`);
      if (!fx.input || typeof fx.input !== "object") say(`fixtures/${f} has no input`);
      if (typeof fx.expect !== "string") say(`fixtures/${f} has no expect`);
      if (r.source !== "model" && r.source !== "planted") { say(`fixtures/${f} has no recording source (model or planted)`); continue; }
      sources[r.source] += 1;
      if (r.prompt_version !== version) say(`fixtures/${f} was recorded under ${r.prompt_version}, not ${version} — re-record with pnpm ads:eval ${w} --record`);
      if (r.source === "model" && (!r.model || r.model === "pending" || r.output == null)) say(`fixtures/${f} claims a model recording but holds none`);
    }
    if (sources.model === 0) say("has no model-recorded fixture");
    if (sources.planted === 0) say("has no planted fixture (a defect the judge must refuse)");
    const basePath = join(at, "baseline.json");
    if (!existsSync(basePath)) say("baseline.json is missing — record one with pnpm ads:eval --record");
    else {
      const b = JSON.parse(readFileSync(basePath, "utf8"));
      if (b.prompt_version !== version) say(`baseline.json was measured under ${b.prompt_version}, not ${version}`);
      if (b.fixtures !== files.length || b.asked !== sources.model) say(`baseline.json counts ${b.fixtures} fixtures / ${b.asked} asked; there are ${files.length} / ${sources.model}`);
      if (typeof b.agreement !== "number") say("baseline.json has no agreement");
    }
    const testPath = join(at, `${w}.test.ts`);
    if (!existsSync(testPath)) say(`${w}.test.ts (the replay) is missing`);
    else {
      const t = readFileSync(testPath, "utf8");
      if (!t.includes("loadFixtures(")) say(`${w}.test.ts does not replay the fixtures (no loadFixtures call)`);
      if (/\b(?:it|test|describe)\.(?:skip|only|todo|fails)\b|\bx(?:it|describe)\(/.test(t)) say(`${w}.test.ts skips, focuses or defers a test`);
    }
  }
  return problems;
}

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), "agent-fixtures-"));
  const fresh = () => { rmSync(join(tmp, "w"), { recursive: true, force: true }); cpSync(WORKERS, join(tmp, "w"), { recursive: true }); return join(tmp, "w"); };
  const w = "copywriter";
  const edit = (dir, rel, fn) => { const p = join(dir, w, rel); writeFileSync(p, fn(readFileSync(p, "utf8"))); };
  const firstFixture = (dir) => readdirSync(join(dir, w, "fixtures")).find((f) => f.endsWith(".json"));
  const firstOf = (dir, source) => readdirSync(join(dir, w, "fixtures")).find((f) => JSON.parse(readFileSync(join(dir, w, "fixtures", f), "utf8")).recorded.source === source);
  const cases = [
    ["a newer prompt the worker does not read", (d) => writeFileSync(join(d, w, "prompt.v99.md"), "new"), /does not read prompt\.v99\.md/],
    ["a fixture recorded under an older prompt", (d) => edit(d, `fixtures/${firstFixture(d)}`, (s) => s.replace(/"prompt_version": "[^"]+"/, '"prompt_version": "copywriter@0"')), /recorded under copywriter@0/],
    ["a placeholder model recording", (d) => edit(d, `fixtures/${firstOf(d, "model")}`, (s) => s.replace(/"model": "[^"]+"/, '"model": "pending"')), /claims a model recording but holds none/],
    ["a fixture whose name is not its file", (d) => edit(d, `fixtures/${firstFixture(d)}`, (s) => s.replace(/"name": "[^"]+"/, '"name": "something-else"')), /is named "something-else"/],
    ["a baseline over other fixtures", (d) => edit(d, "baseline.json", (s) => s.replace(/"fixtures": \d+/, '"fixtures": 1')), /baseline\.json counts 1 fixtures/],
    ["no baseline", (d) => rmSync(join(d, w, "baseline.json")), /baseline\.json is missing/],
    ["a skipped replay", (d) => edit(d, `${w}.test.ts`, (s) => s.replace("it.each(", "it.skip.each(")), /skips, focuses or defers/],
    ["no planted fixture", (d) => { for (const f of readdirSync(join(d, w, "fixtures"))) if (f.startsWith("planted-")) rmSync(join(d, w, "fixtures", f)); }, /has no planted fixture/],
  ];
  let failed = 0;
  const clean = check(fresh());
  if (clean.length) { console.error(`✗ self-test: the real packs are not clean:\n  ${clean.join("\n  ")}`); failed += 1; }
  for (const [label, plant, want] of cases) {
    const dir = fresh();
    plant(dir);
    const got = check(dir);
    if (!got.some((p) => want.test(p))) { console.error(`✗ self-test: "${label}" was not refused (got: ${got.join("; ") || "nothing"})`); failed += 1; }
  }
  rmSync(tmp, { recursive: true, force: true });
  if (failed) process.exit(1);
  console.log(`✓ agent-fixtures self-test — ${cases.length} planted violations each refused, the real packs clean.`);
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const problems = check(WORKERS);
  if (problems.length) {
    console.error(`✗ ${problems.length} agent-fixture problem(s):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("✓ agent fixtures ok — every ads model worker reads its newest prompt, and its fixtures and baseline were recorded under it.");
}
