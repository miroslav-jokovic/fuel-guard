#!/usr/bin/env node
/**
 * Fill update-connector.ps1's file list with the SHA-256 of each file AS GIT STORES IT at a ref.
 *
 *   node tools/mcleod-agent/windows/manifest.mjs [ref]     (default HEAD)
 *
 * The list is what the VM checks every download against before it stops the connector, so it is read
 * from git objects, never from the working tree: an uncommitted edit, or a checkout that rewrote line
 * endings, would otherwise produce checksums no commit has, and the VM would refuse the update.
 *
 * What ships: every top-level .mjs (code and tests: the VM runs the tests before restarting),
 * package.json (it carries "type": "module"), and the three review files `review.test.mjs` reads. Not the
 * env templates, not the lockfile (nothing is installed), not windows/ or oneoff/.
 *
 * Run it after the last change to the connector's code and commit the result. Pin the update to a
 * commit at or after that one in which none of the listed files changed since.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const ref = process.argv[2] ?? "HEAD";
const root = "tools/mcleod-agent/";
const git = (...a) => execFileSync("git", a, { maxBuffer: 64 * 1024 * 1024 });

const listed = git("ls-tree", "--name-only", ref, root).toString().trim().split("\n").map((p) => p.slice(root.length));
const files = [
  ...listed.filter((f) => f.endsWith(".mjs")).sort(),
  "package.json",
  "review/build-routine.mjs",
  "review/SILVICOM-READ-ROUTINE.sql",
  "review/SILVICOM-GRANTS.sql",
];

const lines = files.map((f) => {
  const sha = createHash("sha256").update(git("show", `${ref}:${root}${f}`)).digest("hex");
  return `  "${f}" = "${sha}"`;
});

const ps1 = new URL("./update-connector.ps1", import.meta.url);
const text = readFileSync(ps1, "utf8");
const next = text.replace(/(\$Files = \[ordered\]@\{\n)[\s\S]*?(\n\})/, `$1${lines.join("\n")}$2`);
if (next === text && !text.includes(lines[0])) throw new Error("manifest block not found in update-connector.ps1");
writeFileSync(ps1, next);
console.log(`update-connector.ps1: ${files.length} files from ${git("rev-parse", "--short", ref).toString().trim()}`);
