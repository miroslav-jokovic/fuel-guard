#!/usr/bin/env node
/**
 * Fitness function — every CardManagementWS operation emitted by the API is present in the checked-in WSDL.
 *
 * The EFS endpoint is Axis2 and its operation spelling is case-sensitive. A request can be perfectly
 * shaped and still fail at dispatch when the name differs from the binding, so this keeps code and the
 * retrieved contract tied together.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SOURCE_ROOT = join(ROOT, "apps", "api", "src");
const WSDL = join(ROOT, "docs", "efs", "CardManagementWS.wsdl");
const SKIP = new Set(["node_modules", "dist", "coverage"]);
const SOURCE_EXT = ".ts";

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith(SOURCE_EXT) && !full.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const codeOps = new Map();
const unresolved = [];
for (const file of walk(SOURCE_ROOT)) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/<CardManagementEP_([A-Za-z0-9]+)(?:\s|>)/g)) {
    codeOps.set(match[1], relative(ROOT, file));
  }
  for (const match of source.matchAll(/CardManagementEP_\$\{([^}]+)\}/g)) {
    const expression = match[1].trim();
    if (expression !== "operation") unresolved.push(`${relative(ROOT, file)} uses unresolved operation expression ${expression}`);
    else {
      const opsFile = readFileSync(join(SOURCE_ROOT, "lib", "efsCardOps.ts"), "utf8");
      const object = /const OPS = \{([\s\S]*?)\n\};/.exec(opsFile)?.[1] ?? "";
      for (const value of object.matchAll(/:\s*"([A-Za-z0-9]+)"/g)) codeOps.set(value[1], relative(ROOT, file));
    }
  }
}

const wsdl = existsSync(WSDL) ? readFileSync(WSDL, "utf8") : "";
const wsdlOps = new Set([...wsdl.matchAll(/<operation\s+name="([^"]+)"/g)].map((match) => match[1]));
const missing = [...codeOps.entries()].filter(([op]) => !wsdlOps.has(op));

if (unresolved.length || missing.length || !wsdl) {
  console.error("✗ WSDL operation check failed:");
  if (!wsdl) console.error(`  WSDL not found: ${relative(ROOT, WSDL)}`);
  for (const issue of unresolved) console.error(`  ${issue}`);
  for (const [op, file] of missing) console.error(`  ${file} constructs CardManagementEP_${op}, but WSDL has no matching operation`);
  process.exit(1);
}
console.log(`✓ WSDL operations ok — ${codeOps.size} code operation name(s) found in ${wsdlOps.size} WSDL operations.`);
