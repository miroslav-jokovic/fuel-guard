#!/usr/bin/env node
/**
 * The driver's training page stays small (SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS D-TR12).
 *
 * A driver opens the link on a phone in a truck, often on the edge of coverage (D-TR4). The page is
 * its own Vite entry (`apps/web/t.html` → `src/portal/`), plain TypeScript with no Vue, so that what it
 * downloads before the first film can start is a few KB, not the office app's bundle. Measured
 * 2026-11-25: 0.5 KB of HTML + 4.4 KB CSS + 4.4 KB JS, gzipped.
 *
 * ⚠ Nothing else would notice it growing. One `import { something } from "@silvicom/shared"` that is a
 * VALUE rather than a type pulls Zod and every contract in (hundreds of KB), and the page still works on
 * office Wi-Fi — the place it is tested. So this reads the BUILT page: every file `t.html` loads, and
 * every file those scripts import, statically or not, each gzipped, summed, against the budget.
 *
 * Needs `apps/web/dist`, so it is chained onto `lint:light-dark`, which CI's `bundle` job runs right
 * after the build (the only job that builds).
 *
 *   node scripts/check-training-page-size.mjs [distDir]
 *   node scripts/check-training-page-size.mjs --self-test
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

/** The budget, gzipped. ~10× today's page; a film's first seconds at 360p are about this much. */
export const BUDGET_BYTES = 100 * 1024;

/** Every file the page loads, and its gzipped size. Throws when the page or a file it names is missing. */
export function measure(dist) {
  const html = path.join(dist, "t.html");
  if (!fs.existsSync(html)) throw new Error(`no ${path.relative(process.cwd(), html)} — build apps/web first`);
  const seen = new Map();
  const visit = (abs) => {
    if (seen.has(abs)) return;
    if (!fs.existsSync(abs)) throw new Error(`the page loads ${path.relative(dist, abs)}, which the build did not write`);
    const text = fs.readFileSync(abs);
    seen.set(abs, gzipSync(text).length);
    const src = text.toString("utf8");
    if (abs.endsWith(".html")) {
      for (const [, ref] of src.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)) visit(path.join(dist, ref));
    } else if (abs.endsWith(".js")) {
      for (const [, ref] of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) visit(path.resolve(path.dirname(abs), ref));
    }
  };
  visit(html);
  return [...seen].map(([file, gz]) => ({ file: path.relative(dist, file), gz }));
}

function report(dist) {
  const files = measure(dist);
  const total = files.reduce((n, f) => n + f.gz, 0);
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  for (const f of files) console.log(`  ${kb(f.gz).padStart(9)}  ${f.file}`);
  if (total > BUDGET_BYTES) {
    console.error(`✗ the driver's training page is ${kb(total)} gzipped, over its ${kb(BUDGET_BYTES)} budget (D-TR12).`);
    console.error("  Look for a value import from @silvicom/shared or a library in src/portal/: the page takes types only.");
    return false;
  }
  console.log(`✓ training page ${kb(total)} gzipped, within ${kb(BUDGET_BYTES)} (D-TR12)`);
  return true;
}

function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tpage-"));
  try {
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "t.html"), '<script type="module" src="/assets/t.js"></script><link rel="stylesheet" href="/assets/t.css">');
    fs.writeFileSync(path.join(dir, "assets/t.js"), 'import{a}from"./chunk.js";const b=()=>import("./lazy.js");');
    fs.writeFileSync(path.join(dir, "assets/chunk.js"), "export const a=1;");
    fs.writeFileSync(path.join(dir, "assets/t.css"), "body{}");
    let threw = false;
    try {
      measure(dir); // lazy.js is named but missing
    } catch {
      threw = true;
    }
    if (!threw) throw new Error("self-test: a missing imported file was not caught");
    // Random bytes do not compress, so 120 KB of them is over the budget gzipped too.
    fs.writeFileSync(path.join(dir, "assets/lazy.js"), Buffer.from(Array.from({ length: 120 * 1024 }, () => Math.floor(Math.random() * 256))).toString("base64"));
    const files = measure(dir).map((f) => f.file).sort();
    if (files.join() !== ["assets/chunk.js", "assets/lazy.js", "assets/t.css", "assets/t.js", "t.html"].join()) throw new Error(`self-test: followed ${files.join()}`);
    if (report(dir)) throw new Error("self-test: a page over budget passed");
    console.log("✓ check-training-page-size self-test");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.argv[2] === "--self-test") selfTest();
else if (!report(process.argv[2] ?? path.resolve(here, "../apps/web/dist"))) process.exit(1);
