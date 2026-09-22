#!/usr/bin/env node
/**
 * Fitness function — no surface spells a vehicle status out at a call site (D-FC11,
 * docs/plans/roster/FLEET-CENSUS-AND-IDLE-TRUTH-PLAN.md §1.8a).
 *
 * `vehicle_status` gained `ordered` in 0353 and had gained `maintenance` in 0001 without a single
 * row ever holding it. Eight `.from("vehicles")` chains compared `status` to a literal, and the two
 * spellings failed in OPPOSITE directions the moment either value appeared:
 *
 *   `.eq("status", "active")`    drops the 12 trucks McLeod reports as in a shop — including out of
 *                                the §396.17 annual-inspection roster (`equipmentInspection.ts`)
 *   `.neq("status", "retired")`  admits the 53 trucks the carrier has ordered and not taken
 *                                delivery of, into four idle surfaces that then divide by them
 *
 * `constants.ts` already records the same lesson for drivers: an exclusion list "silently admits a
 * status added later — which is exactly what happened to FleetReadiness". This gate is that
 * sentence made binding for equipment.
 *
 * ── WHY THIS ONE PARSES INSTEAD OF GREPPING ─────────────────────────────────────────────────────
 * Every other lint script here matches text, and for this rule text is not good enough. Two regex
 * walkers were written first and BOTH were wrong, in opposite directions:
 *
 *   ending the chain at a line not starting with `.`  →  missed useIdleCapabilities.ts entirely,
 *                                                        because a multi-line `.select()` argument
 *                                                        ends such a line
 *   ending it at the next `;` outside parens          →  swallowed sibling queries inside a
 *                                                        `Promise.all([...])`, attributing one
 *                                                        row's filter to the query above it
 *
 * A gate whose failure mode is a FALSE NEGATIVE is worse than no gate: it certifies an absence it
 * cannot see. So this walks the TypeScript AST and follows the actual receiver chain, which is
 * exactly the thing a regex cannot do. `typescript` is already a dependency.
 *
 * ── WHAT IT DOES NOT COVER, SAID OUT LOUD ───────────────────────────────────────────────────────
 * `trailers` shares the `vehicle_status` enum and is NOT checked here: no trailer is ever `ordered`
 * today, and the trailer census is a separate, unstarted plan item (E5).
 * A comparison written in PL/pgSQL is invisible to this gate by construction — `platform_org_overview`
 * counts `vehicles` with no status filter at all. SQL is checked by hand at E3, not here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOTS = ["apps/api/src", "apps/web/src", "packages/shared/src"];
const TABLE = "vehicles";
/** Method names that narrow a query by column. */
const FILTERS = new Set(["eq", "neq", "not", "in", "is", "gt", "lt", "gte", "lte"]);

function sources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|vue)$/.test(entry)) out.push(p);
    }
  };
  for (const r of ROOTS) walk(r);
  return out;
}

/**
 * `.vue` is not TypeScript, so the script block is lifted out and parsed on its own. The offset is
 * carried so a reported line number points at the real file rather than at the extract.
 */
function parseUnits(file) {
  const text = readFileSync(file, "utf8");
  if (!file.endsWith(".vue")) return [{ text, lineOffset: 0 }];
  const units = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(text))) {
    units.push({ text: m[1], lineOffset: text.slice(0, m.index).split("\n").length - 1 });
  }
  return units;
}

const isStr = (n) => n && ts.isStringLiteralLike(n);

/** The chain of `.name(args)` calls sitting ON TOP of a given call expression. */
function chainAbove(node) {
  const links = [];
  let cur = node;
  while (
    cur.parent &&
    ts.isPropertyAccessExpression(cur.parent) &&
    cur.parent.expression === cur &&
    cur.parent.parent &&
    ts.isCallExpression(cur.parent.parent) &&
    cur.parent.parent.expression === cur.parent
  ) {
    const call = cur.parent.parent;
    links.push({ name: cur.parent.name.getText(), call });
    cur = call;
  }
  return links;
}

/**
 * A status filter is acceptable only when the VALUES come from the shared vocabulary. A spread of
 * an identifier (`[...IN_SERVICE_VEHICLE_STATUSES]`) is the shape every converted call site uses;
 * a bare identifier is accepted too, so a future helper is not forced to inline a spread.
 */
function usesSharedVocabulary(arg) {
  if (!arg) return false;
  if (ts.isIdentifier(arg)) return true;
  if (ts.isArrayLiteralExpression(arg)) {
    return (
      arg.elements.length > 0 &&
      arg.elements.every((e) => ts.isSpreadElement(e) && ts.isIdentifier(e.expression))
    );
  }
  return false;
}

const violations = [];

for (const file of sources()) {
  for (const { text, lineOffset } of parseUnits(file)) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.getText() === "from" &&
        isStr(node.arguments[0]) &&
        node.arguments[0].text === TABLE
      ) {
        for (const { name, call } of chainAbove(node)) {
          if (!FILTERS.has(name)) continue;
          if (!isStr(call.arguments[0]) || call.arguments[0].text !== "status") continue;
          const ok = name === "in" && usesSharedVocabulary(call.arguments[1]);
          if (!ok) {
            const { line } = sf.getLineAndCharacterOfPosition(call.getStart(sf));
            violations.push({
              where: `${relative(process.cwd(), file)}:${line + 1 + lineOffset}`,
              what: `.${name}("status", ${call.arguments[1]?.getText(sf) ?? ""})`,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}

if (process.argv.includes("--report")) {
  console.log(`[report] ${violations.length} literal vehicle-status comparison(s)`);
  for (const v of violations) console.log(`  ${v.where}  ${v.what}`);
  process.exitCode = 0;
} else if (violations.length > 0) {
  console.error(
    `✗ vehicle status: ${violations.length} call site(s) compare vehicles.status to a literal.\n` +
      `  Read IN_SERVICE_VEHICLE_STATUSES from @silvicom/shared instead —\n` +
      `  .in("status", [...IN_SERVICE_VEHICLE_STATUSES]). A literal is right until the next enum\n` +
      `  value exists, and then it is silently wrong in one direction or the other.\n`,
  );
  for (const v of violations) console.error(`  ${v.where}  ${v.what}`);
  process.exit(1);
} else {
  console.log(`✓ vehicle status — no call site compares vehicles.status to a literal.`);
}
