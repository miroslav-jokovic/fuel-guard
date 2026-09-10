#!/usr/bin/env node
/**
 * Fitness function — the FleetPal contracts describe the FleetPal API
 * (FLEETPAL-INTEGRATION-PLAN.md step F1, D-FP1).
 *
 * ── WHY THIS GATE READS A MANIFEST AND NOT THE SPEC ──────────────────────────────────────────
 * `docs/FleetPal/` is gitignored, so the vendor's OpenAPI document is in every developer's working
 * tree and in **no CI checkout**. A gate that read it directly would find nothing there and skip —
 * on every CI run, silently, while reporting success. Root `CLAUDE.md` records what that costs:
 * `lint:wsdl` crashed on a stale path for ten days "without anybody being able to notice".
 *
 * So `gen-fleetpal-manifest.mjs` runs by hand beside a working tree that has the spec and commits
 * `packages/shared/src/fleetpal/fieldManifest.generated.json` — field NAMES only, no vendor prose,
 * no VMRS text. This gate compares that artefact against the schemas. Both files are in CI, so the
 * check runs everywhere and fails on a real disagreement.
 *
 * Three checks:
 *
 *   1. **COVERAGE.** Every field the manifest lists for a resource appears in that resource's zod
 *      schema. A field the vendor added and we never noticed fails here — which is the whole point,
 *      because `z.looseObject` means the parser accepts it silently and nothing else would say so.
 *   2. **NO INVENTION.** Every field in a schema is in the manifest. A hand-typed field name with a
 *      typo parses as `undefined` forever and the row lands with a null nobody explains.
 *   3. **ENUM MEMBERS.** Every `FLEETPAL_*` const matches its manifest enum exactly. The contracts
 *      read vocabularies as strings on purpose (an added member must not take the feed down), so
 *      these consts are the only place a new member can be NOTICED rather than swallowed.
 *
 * `--self-test` proves each detector fires — a gate that cannot fail is not a gate.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MANIFEST = join(ROOT, "packages", "shared", "src", "fleetpal", "fieldManifest.generated.json");
const DIR = join(ROOT, "packages", "shared", "src", "fleetpal");

/** Resource in the manifest → the exported schema const that models it. */
const SCHEMA_OF = {
  Unit: "fleetpalUnitSchema",
  WorkOrder: "fleetpalWorkOrderSchema",
  Job: "fleetpalJobSchema",
  JobItem: "fleetpalJobItemSchema",
  ServiceHistory: "fleetpalServiceHistorySchema",
  Meter: "fleetpalMeterSchema",
  PMSchedule: "fleetpalPmScheduleSchema",
  Interval: "fleetpalIntervalSchema",
  Part: "fleetpalPartSchema",
  Vendor: "fleetpalVendorSchema",
  Shop: "fleetpalShopSchema",
  Defect: "fleetpalDefectSchema",
  Issue: "fleetpalIssueSchema",
  Expiration: "fleetpalExpirationSchema",
  PurchaseOrder: "fleetpalPurchaseOrderSchema",
  POInvoice: "fleetpalPoInvoiceSchema",
  POReceipt: "fleetpalPoReceiptSchema",
  POReceiptItem: "fleetpalPoReceiptItemSchema",
};

/**
 * Field names the schemas deliberately do not model, per resource. Each needs a reason, because an
 * unexplained exemption is how a gate becomes decoration.
 *
 * Empty today. `url` IS modelled everywhere the vendor sends it — following it rather than
 * templating a path out of an id is the vendor's own instruction, and a schema that dropped it
 * would make that impossible.
 */
const NOT_MODELLED = {};

/**
 * Reads the exported object literal for `<name> = z.looseObject({ ... })` and returns its top-level
 * keys. A brace-depth walk rather than a regex over the whole body: nested schemas (PMSchedule's
 * `intervals`) and comment braces both break the naive version, and this gate exists to notice
 * mistakes rather than make them.
 */
function schemaKeys(source, name) {
  const start = source.indexOf(`export const ${name} = z.looseObject({`);
  if (start === -1) return null;
  let i = source.indexOf("{", source.indexOf("z.looseObject", start));
  let depth = 0;
  const keys = [];
  let line = "";
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth++;
      if (depth === 1) continue;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) break;
    }
    if (depth === 1) {
      if (ch === "\n") {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[:,]/.exec(line);
        // A bare `timestamp,` shorthand names the property after the imported helper.
        const shorthand = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*$/.exec(line);
        if (m) keys.push(m[1]);
        else if (shorthand) keys.push(shorthand[1]);
        line = "";
      } else {
        line += ch;
      }
    }
  }
  return keys;
}

function enumConsts(source) {
  const out = {};
  const re = /export const (FLEETPAL_[A-Z_]+)\s*=\s*(\[[\s\S]*?\]|\[\.\.\.[\s\S]*?\])\s*as const;/g;
  let m;
  while ((m = re.exec(source))) {
    const body = m[2];
    if (body.includes("...")) continue; // a spread-built array is unreadable as text; primitives.ts says why none exists
    out[m[1]] = [...body.matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  }
  return out;
}

/** Manifest enum name → the const that pins it. Absent = the vendor declared no `*Enum` schema. */
const ENUM_CONST_OF = {
  OwnershipEnum: "FLEETPAL_OWNERSHIP",
  LineItemTypeEnum: "FLEETPAL_LINE_ITEM_TYPES",
  MeterTypeEnum: "FLEETPAL_METER_TYPES",
  RepairPriorityClassEnum: "FLEETPAL_REPAIR_PRIORITY_CLASSES",
  WorkOrderPriorityEnum: "FLEETPAL_WORK_ORDER_PRIORITIES",
  IssueStatusEnum: "FLEETPAL_ISSUE_STATUSES",
  IssuePriorityEnum: "FLEETPAL_ISSUE_PRIORITIES",
  POReceiptItemTypeEnum: "FLEETPAL_RECEIPT_ITEM_TYPES",
  OrderStatusEnum: "FLEETPAL_ORDER_STATUSES",
  OrderTypeEnum: "FLEETPAL_ORDER_TYPES",
  POItemTypeEnum: "FLEETPAL_PO_ITEM_TYPES",
  POInvoiceTypeEnum: "FLEETPAL_PO_INVOICE_TYPES",
  VendorTypeEnum: "FLEETPAL_VENDOR_TYPES",
  IntervalTypeEnum: "FLEETPAL_INTERVAL_TYPES",
  TimeIntervalEnum: "FLEETPAL_TIME_INTERVALS",
  UnitOfMeasureEnum: "FLEETPAL_UNITS_OF_MEASURE",
};

function run(sources, manifest) {
  const problems = [];
  const all = Object.values(sources).join("\n");

  for (const [resource, fields] of Object.entries(manifest.resources)) {
    const schema = SCHEMA_OF[resource];
    if (!schema) {
      problems.push(`resource ${resource} is in the manifest with no schema mapped in SCHEMA_OF`);
      continue;
    }
    const keys = schemaKeys(all, schema);
    if (!keys) {
      problems.push(`${schema} (for ${resource}) is not an exported z.looseObject`);
      continue;
    }
    const exempt = new Set(NOT_MODELLED[resource] ?? []);
    for (const f of fields) {
      if (!keys.includes(f) && !exempt.has(f)) {
        problems.push(`${resource}.${f} is in the spec and missing from ${schema}`);
      }
    }
    for (const k of keys) {
      if (!fields.includes(k)) {
        problems.push(`${schema}.${k} is not a field of ${resource} in the spec — typo, or removed`);
      }
    }
  }

  const consts = enumConsts(all);
  for (const [enumName, members] of Object.entries(manifest.enums)) {
    const constName = ENUM_CONST_OF[enumName];
    if (!constName) continue;
    const ours = consts[constName];
    if (!ours) {
      problems.push(`${constName} (for ${enumName}) is not an exported \`as const\` array`);
      continue;
    }
    const missing = members.filter((m) => !ours.includes(m));
    const extra = ours.filter((m) => !members.includes(m));
    if (missing.length) problems.push(`${constName} is missing ${missing.join(", ")} — the vendor added a member`);
    if (extra.length) problems.push(`${constName} has ${extra.join(", ")} which the spec does not list`);
  }

  return problems;
}

function loadSources() {
  const out = {};
  for (const f of ["primitives.ts", "equipment.ts", "repair.ts", "purchasing.ts"]) {
    out[f] = readFileSync(join(DIR, f), "utf8");
  }
  return out;
}

if (process.argv.includes("--self-test")) {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const base = loadSources();
  const cases = [
    [
      "a field the vendor added and we did not model",
      () => {
        const m = structuredClone(manifest);
        m.resources.Unit.push("telematics_provider");
        return [base, m];
      },
    ],
    [
      "a field name invented on our side",
      () => {
        const s = { ...base };
        s["equipment.ts"] = s["equipment.ts"].replace("  license_plate: z.string(),", "  license_plaet: z.string(),");
        return [s, manifest];
      },
    ],
    [
      "an enum member the vendor added",
      () => {
        const m = structuredClone(manifest);
        m.enums.MeterTypeEnum = [...m.enums.MeterTypeEnum, "REEFER_HOURS"];
        return [base, m];
      },
    ],
  ];
  let ok = true;
  for (const [what, mutate] of cases) {
    const [s, m] = mutate();
    const found = run(s, m);
    const fired = found.length > 0;
    console.log(`${fired ? "✓" : "✗"} self-test: detects ${what}`);
    if (!fired) ok = false;
  }
  if (run(base, manifest).length) {
    console.log("✗ self-test: the unmutated tree must be clean");
    ok = false;
  } else {
    console.log("✓ self-test: the unmutated tree is clean");
  }
  process.exit(ok ? 0 : 1);
}

if (!existsSync(MANIFEST)) {
  console.error(`✗ ${MANIFEST} is missing — run node scripts/gen-fleetpal-manifest.mjs`);
  process.exit(1);
}
const problems = run(loadSources(), JSON.parse(readFileSync(MANIFEST, "utf8")));
if (problems.length) {
  console.error("✗ fleetpal contracts disagree with the spec's field manifest:\n");
  for (const p of problems) console.error(`  · ${p}`);
  console.error(
    "\n  The manifest is generated from docs/FleetPal/ by scripts/gen-fleetpal-manifest.mjs.\n" +
      "  If the vendor's document moved, regenerate it and update the schemas together.",
  );
  process.exit(1);
}
console.log(
  `✓ fleetpal contracts ok — ${Object.keys(SCHEMA_OF).length} resources and ` +
    `${Object.keys(ENUM_CONST_OF).length} vocabularies match the spec manifest.`,
);
