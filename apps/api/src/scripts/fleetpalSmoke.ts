import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  fleetpalDefectSchema,
  fleetpalExpirationSchema,
  fleetpalIssueSchema,
  fleetpalJobItemSchema,
  fleetpalJobSchema,
  fleetpalMeterSchema,
  fleetpalPartSchema,
  fleetpalPmScheduleSchema,
  fleetpalPoInvoiceSchema,
  fleetpalPoReceiptItemSchema,
  fleetpalPoReceiptSchema,
  fleetpalPurchaseOrderSchema,
  fleetpalServiceHistorySchema,
  fleetpalShopSchema,
  fleetpalUnitSchema,
  fleetpalVendorSchema,
  fleetpalWebhookEventListSchema,
  fleetpalWorkOrderSchema,
  paginated,
} from "@silvicom/shared";
import { loadEnv, type Env } from "../env.js";
import { FleetpalClient, FleetpalError } from "../modules/fleetpal/index.js";

/**
 * F4 — the live smoke against the real FleetPal account (FLEETPAL-INTEGRATION-PLAN.md §5 F4).
 *
 * F0–F3 shipped without anybody ever having spoken to the vendor: every fixture behind the client
 * and the store was hand-built from the spec's own examples. That is a contract proved against a
 * document, not against a server, and the difference is exactly what this script exists to close.
 * Its deliverable is therefore a MEASUREMENT, written into the plan's §8, plus real payload
 * fixtures — not a feature.
 *
 * ── ⚠ IT READS. IT NEVER WRITES. ───────────────────────────────────────────────────────────────
 * Every call here is a GET. The one write the integration will ever make is the meter push (F14),
 * which ships behind an env flag defaulting off precisely because writing into a vendor system is a
 * different act from reading one. A probe that also wrote would make the first contact with a
 * carrier's live maintenance system an experiment on their data.
 *
 * ── WHY THE KEY COMES FROM THE ENVIRONMENT HERE, AND NOWHERE ELSE ──────────────────────────────
 * `fleetpal_credentials.api_key_sealed` is the product's home for a key, because a FleetPal key
 * carries its issuing user's role AND company and is per-org by construction. Sealing one needs
 * `SECRETS_ENCRYPTION_KEY`, which is set in production and deliberately absent locally — so on a
 * laptop there is no way to store a key, and F4 has to run before F8 gives the scheduler one to
 * read. `env.ts`'s comment on `FLEETPAL_API_KEY` states the same boundary from the other side.
 *
 * The key is never printed, never written to an artefact and never put in a fixture: `redact()`
 * below strips person-shaped values from everything that lands in the tree, `lint:secrets` scans
 * what is committed, and `apps/api/src/modules/fleetpal/client.test.ts` pins it with "never puts
 * the api key in the log".
 *
 * Run it as `pnpm --filter @fleetguard/api fleetpal:smoke` with `FLEETPAL_API_KEY` in
 * `apps/api/.env` (gitignored). `--pages=N` bounds each walk; the default of one page per resource
 * is enough for the counts, because the envelope's `count` is the whole collection regardless.
 */

/**
 * Both roots are resolved from THIS FILE, not from `process.cwd()`.
 *
 * The script is run through `pnpm --filter @silvicom/api`, which sets the cwd to `apps/api` — so a
 * relative `docs/FleetPal/...` wrote `apps/api/docs/FleetPal/...` and a relative fixture path wrote
 * `apps/api/apps/api/src/...`, both on the first real run. The output landed somewhere plausible
 * enough that it took a `find` to notice.
 */
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
/** Where the unredacted evidence lands. Gitignored (`docs/FleetPal/*`), like the spec beside it. */
const EVIDENCE_ROOT = path.join(REPO_ROOT, "docs/FleetPal/smoke-runs");
/** Where the redacted fixtures land — committed, and parsed by `fixtures.test.ts` and the F6 ingest. */
const FIXTURE_ROOT = path.join(REPO_ROOT, "apps/api/src/modules/fleetpal/__fixtures__");

interface Resource {
  /** The collection path, trailing slash included — the vendor redirects without it. */
  path: string;
  /** The F1 contract for one row. A parse failure here is the finding F4 exists to produce. */
  schema: z.ZodType<unknown>;
  /** File stem for the evidence and the fixture. */
  name: string;
}

/**
 * The resources §2.7 assigns to a sync tier, in the order a reader of the plan meets them. The five
 * `vmrs-*` catalogues are deliberately absent: D-FP8 forbids persisting their descriptions, and a
 * fixture in this tree is persistence.
 */
const RESOURCES: Resource[] = [
  { name: "units", path: "/v1/units/", schema: fleetpalUnitSchema },
  { name: "work-orders", path: "/v1/work-orders/", schema: fleetpalWorkOrderSchema },
  { name: "jobs", path: "/v1/jobs/", schema: fleetpalJobSchema },
  { name: "job-items", path: "/v1/job-items/", schema: fleetpalJobItemSchema },
  { name: "service-history", path: "/v1/service-history/", schema: fleetpalServiceHistorySchema },
  { name: "meters", path: "/v1/meters/", schema: fleetpalMeterSchema },
  { name: "pm-schedules", path: "/v1/pm-schedules/", schema: fleetpalPmScheduleSchema },
  { name: "defects", path: "/v1/defects/", schema: fleetpalDefectSchema },
  { name: "issues", path: "/v1/issues/", schema: fleetpalIssueSchema },
  { name: "expirations", path: "/v1/expirations/", schema: fleetpalExpirationSchema },
  { name: "parts", path: "/v1/parts/", schema: fleetpalPartSchema },
  { name: "vendors", path: "/v1/vendors/", schema: fleetpalVendorSchema },
  { name: "shops", path: "/v1/shops/", schema: fleetpalShopSchema },
  { name: "purchase-orders", path: "/v1/purchase-orders/", schema: fleetpalPurchaseOrderSchema },
  { name: "purchase-order-invoices", path: "/v1/purchase-order-invoices/", schema: fleetpalPoInvoiceSchema },
  { name: "purchase-order-receipts", path: "/v1/purchase-order-receipts/", schema: fleetpalPoReceiptSchema },
  { name: "purchase-order-receipt-items", path: "/v1/purchase-order-receipt-items/", schema: fleetpalPoReceiptItemSchema },
];

/**
 * Keys whose VALUES are replaced before anything is committed.
 *
 * Shape, not content, is what a fixture is for, so each replacement keeps the type: a redacted
 * string stays a string of the same kind, so a schema that would have rejected the real payload
 * still rejects the redacted one. Names here are person-shaped or free-text a person typed into —
 * a technician's note naming a driver is the same disclosure as a driver field.
 */
const REDACT_KEYS = new Set([
  // A supplier that trades under its owner's name ("Tim Ekkel Diesel Repair") is a person's name in
  // a business field, and a fixture cannot tell the two apart — so the whole field goes.
  "name",
  "email",
  "phone",
  "phone_number",
  "fax",
  "contact",
  "contact_name",
  "first_name",
  "last_name",
  "full_name",
  "created_by",
  "updated_by",
  "assigned_to",
  "requested_by",
  "approved_by",
  "driver",
  "driver_name",
  "notes",
  "note",
  "comment",
  "comments",
  "description_notes",
  "address",
  "address_line_1",
  "address_line_2",
  "street",
]);

/** Replace redacted values in place, preserving the JSON type so the contract still applies. */
function redact(value: unknown, key?: string): unknown {
  if (key !== undefined && REDACT_KEYS.has(key) && value !== null && value !== undefined) {
    if (typeof value === "string") return "REDACTED";
    if (typeof value === "number") return 0;
    if (Array.isArray(value)) return [];
    return "REDACTED";
  }
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redact(v, k);
    return out;
  }
  return value;
}

function writeJson(root: string, name: string, body: unknown): string {
  mkdirSync(root, { recursive: true });
  const file = path.join(root, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return file;
}

interface ResourceMeasurement {
  name: string;
  count: number | null;
  sampled: number;
  parsed: boolean;
  error: string | null;
  /**
   * Fields the SERVER sends that the SPEC does not declare.
   *
   * ⚠ This is the one disagreement `lint:fleetpal-contract` is structurally unable to see. The gate
   * compares our schemas against a manifest generated from the vendor's document, so it catches a
   * field the document has and we missed — and is blind, by construction, to a field the document
   * never had. `z.looseObject` then accepts it silently. The probe is the only place the live
   * payload and the manifest meet, so it is the only place this can be measured.
   */
  undeclared: string[];
}

/** Resource name in the probe → resource name in the generated manifest. */
const MANIFEST_OF: Record<string, string> = {
  units: "Unit",
  "work-orders": "WorkOrder",
  jobs: "Job",
  "job-items": "JobItem",
  "service-history": "ServiceHistory",
  meters: "Meter",
  "pm-schedules": "PMSchedule",
  defects: "Defect",
  issues: "Issue",
  expirations: "Expiration",
  parts: "Part",
  vendors: "Vendor",
  shops: "Shop",
  "purchase-orders": "PurchaseOrder",
  "purchase-order-invoices": "POInvoice",
  "purchase-order-receipts": "POReceipt",
  "purchase-order-receipt-items": "POReceiptItem",
};

const MANIFEST = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "packages/shared/src/fleetpal/fieldManifest.generated.json"), "utf8"),
) as { resources: Record<string, string[]> };

function undeclaredFields(name: string, rows: unknown[]): string[] {
  const declared = MANIFEST.resources[MANIFEST_OF[name] ?? ""] ?? null;
  if (!declared) return [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    for (const k of Object.keys(row as Record<string, unknown>)) {
      if (!declared.includes(k)) seen.add(k);
    }
  }
  return [...seen].sort();
}

/**
 * One page of one collection, parsed through its F1 contract.
 *
 * ⚠ **A parse failure is recorded, not thrown.** The single most valuable thing this probe can
 * produce is a list of every contract the real payload disagrees with, and a script that died on
 * the first disagreement would surface them one afternoon at a time.
 */
async function probeResource(
  client: FleetpalClient,
  resource: Resource,
  limit: number,
  evidenceDir: string,
): Promise<ResourceMeasurement> {
  const envelope = paginated(z.unknown());
  try {
    // Fetched untyped first, so the RAW body reaches the evidence file even when the contract
    // rejects it — the parse is the thing under test, and losing the evidence to the failure it is
    // meant to explain is how a probe wastes the one afternoon it gets. `pspUatProbe` does the same.
    const raw = (await client.get(`${resource.path}?limit=${limit}`, envelope)) as {
      count: number;
      results: unknown[];
    };
    writeJson(evidenceDir, resource.name, raw);

    const parsed = z.array(resource.schema).safeParse(raw.results);
    if (raw.results.length > 0) {
      writeJson(FIXTURE_ROOT, resource.name, {
        count: raw.count,
        next: null,
        previous: null,
        results: (redact(raw.results) as unknown[]).slice(0, 3),
      });
    }
    return {
      name: resource.name,
      count: raw.count,
      sampled: raw.results.length,
      undeclared: undeclaredFields(resource.name, raw.results),
      parsed: parsed.success,
      error: parsed.success
        ? null
        : `${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message}`,
    };
  } catch (e) {
    const message = e instanceof FleetpalError ? `${e.kind}: ${e.message}` : String(e);
    return { name: resource.name, count: null, sampled: 0, undeclared: [], parsed: false, error: message };
  }
}

/**
 * The webhook catalogue — step 2 of F4, and the single highest-value call in the probe.
 *
 * The spec names exactly one event key (`work_order.completed`) and says the catalogue is dynamic,
 * so F15 cannot be designed from the document at all. Whatever comes back here is written into the
 * plan's §2.8 by hand.
 */
async function probeWebhookCatalogue(
  client: FleetpalClient,
  evidenceDir: string,
): Promise<{ keys: string[]; error: string | null }> {
  try {
    // ⚠ NOT `paginated()`. The catalogue ships whole in a bare `results` array — the first run of
    // this probe reached for the usual envelope and the parse failed on a missing `count`, which is
    // how `fleetpalWebhookEventListSchema` came to exist. F15's subscriber must not walk it either.
    const raw = await client.get("/v1/webhook-events/", fleetpalWebhookEventListSchema);
    writeJson(evidenceDir, "webhook-events", raw);
    return { keys: raw.results.map((r) => r.key), error: null };
  } catch (e) {
    return { keys: [], error: e instanceof FleetpalError ? `${e.kind}: ${e.message}` : String(e) };
  }
}

/**
 * The three facts a collection-count cannot answer, each load-bearing for a later step.
 *
 * - **`payable_to`** is half of §2.4's coverage-bridge key. The first page came back null, and a
 *   key that is null in general is a bridge that does not carry — F9 has to know before it builds.
 * - **`code` on a vendor** is the match key FleetPal's own documentation offers for syncing from an
 *   accounting system, i.e. from McLeod. Populated, it is a stronger bridge than the invoice number.
 * - **The date range on work orders** answers Q8: how far back a backfill is worth running.
 */
interface BridgeCensus {
  invoices: number;
  invoicesWithPayableTo: number;
  purchaseOrders: number;
  purchaseOrdersWithWorkOrder: number;
  vendors: number;
  vendorsWithCode: number;
  workOrders: number;
  workOrdersCompleted: number;
  earliestCompleted: string | null;
  latestCompleted: string | null;
}

async function censusBridge(client: FleetpalClient, evidenceDir: string): Promise<BridgeCensus> {
  const invoices = await client.walk("/v1/purchase-order-invoices/", fleetpalPoInvoiceSchema, {});
  const orders = await client.walk("/v1/purchase-orders/", fleetpalPurchaseOrderSchema, {});
  const vendors = await client.walk("/v1/vendors/", fleetpalVendorSchema, {});
  const workOrders = await client.walk("/v1/work-orders/", fleetpalWorkOrderSchema, {});
  writeJson(evidenceDir, "work-orders-all", workOrders);

  const completed = workOrders
    .map((w) => (w as Record<string, unknown>).completed)
    .filter((c): c is string => typeof c === "string" && c !== "")
    .sort();

  return {
    invoices: invoices.length,
    invoicesWithPayableTo: invoices.filter((i) => i.payable_to !== null).length,
    purchaseOrders: orders.length,
    purchaseOrdersWithWorkOrder: orders.filter((o) => o.work_order !== null).length,
    vendors: vendors.length,
    vendorsWithCode: vendors.filter((v) => v.code.trim() !== "").length,
    workOrders: workOrders.length,
    workOrdersCompleted: completed.length,
    earliestCompleted: completed[0] ?? null,
    latestCompleted: completed[completed.length - 1] ?? null,
  };
}

/** The VIN/number census the F5 matcher will be measured against. Units only; no person data. */
interface UnitCensus {
  total: number;
  withVin: number;
  withNumber: number;
  archived: number;
  byCategory: Record<string, number>;
}

async function censusUnits(client: FleetpalClient, evidenceDir: string): Promise<UnitCensus> {
  const units = await client.walk("/v1/units/", fleetpalUnitSchema, {});
  writeJson(evidenceDir, "units-all", units);
  const census: UnitCensus = {
    total: units.length,
    withVin: 0,
    withNumber: 0,
    archived: 0,
    byCategory: {},
  };
  for (const u of units) {
    const row = u as Record<string, unknown>;
    if (typeof row.vin === "string" && row.vin.trim() !== "") census.withVin++;
    if (typeof row.number === "string" && row.number.trim() !== "") census.withNumber++;
    if (row.archived === true) census.archived++;
    const category = String(row.vmrs_equipment_category ?? "none");
    census.byCategory[category] = (census.byCategory[category] ?? 0) + 1;
  }
  return census;
}

/**
 * `GET /status` — the one endpoint the spec marks `security: [{}]`, i.e. no key at all.
 *
 * It runs FIRST and with no `Authorization` header on purpose: a 200 here followed by a 401
 * anywhere else says the key is the problem, and a failure here says the network is. Conflating the
 * two is how an afternoon goes into a credential that was never wrong.
 */
async function probeStatus(baseUrl: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/status`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body: body.slice(0, 200) };
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main(argv: string[]): Promise<number> {
  const env: Env = loadEnv();
  const apiKey = env.FLEETPAL_API_KEY;
  if (!apiKey) {
    console.error("FLEETPAL_API_KEY is not set — put it in apps/api/.env (gitignored) and re-run.");
    return 2;
  }
  const limit = Number(argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 3);
  const evidenceDir = path.join(EVIDENCE_ROOT, stamp());

  console.log(`FleetPal smoke — ${env.FLEETPAL_BASE_URL}`);
  const status = await probeStatus(env.FLEETPAL_BASE_URL);
  console.log(`  /status → ${status.status} ${status.ok ? "ok" : "FAILED"} ${status.body}`);

  const client = new FleetpalClient({ apiKey, baseUrl: env.FLEETPAL_BASE_URL });

  const first = await probeResource(client, RESOURCES[0]!, 1, evidenceDir);
  if (first.error && first.count === null) {
    console.error(`  /v1/units/ → ${first.error}`);
    console.error("Authentication or transport failed; nothing further is worth measuring.");
    return 1;
  }
  console.log(`  auth ok — ${first.count} units visible to this key`);

  const webhooks = await probeWebhookCatalogue(client, evidenceDir);
  console.log(
    webhooks.error
      ? `  webhook catalogue → ERROR ${webhooks.error}`
      : `  webhook catalogue (${webhooks.keys.length}): ${webhooks.keys.join(", ") || "(empty)"}`,
  );

  const measurements: ResourceMeasurement[] = [];
  for (const resource of RESOURCES) {
    const m = await probeResource(client, resource, limit, evidenceDir);
    measurements.push(m);
    const count = m.count === null ? "ERR" : String(m.count);
    const undeclared = m.undeclared.length ? `  ⚠ undeclared: ${m.undeclared.join(", ")}` : "";
    const verdict = (m.error ? `⚠ ${m.error}` : m.parsed ? "contract ok" : "no rows") + undeclared;
    console.log(`  ${m.name.padEnd(30)} count=${count.padStart(7)}  ${verdict}`);
  }

  const census = await censusUnits(client, evidenceDir);
  console.log(
    `  units: ${census.total} total, ${census.withVin} with VIN, ${census.withNumber} numbered, ` +
      `${census.archived} archived`,
  );
  console.log(`  categories: ${JSON.stringify(census.byCategory)}`);

  const bridge = await censusBridge(client, evidenceDir);
  console.log(
    `  bridge: ${bridge.invoicesWithPayableTo}/${bridge.invoices} invoices carry payable_to, ` +
      `${bridge.vendorsWithCode}/${bridge.vendors} vendors carry a code, ` +
      `${bridge.purchaseOrdersWithWorkOrder}/${bridge.purchaseOrders} POs name a work order`,
  );
  console.log(
    `  work orders: ${bridge.workOrdersCompleted}/${bridge.workOrders} completed, ` +
      `${bridge.earliestCompleted ?? "—"} … ${bridge.latestCompleted ?? "—"}`,
  );

  // The request log carries per-call timing and every rate-limit header the vendor sent; F8's
  // `KIND_CAPS` is set from it rather than from a guess (the plan pins it at 1 until this runs).
  writeJson(evidenceDir, "request-log", client.log);
  writeJson(evidenceDir, "measurements", { status, webhooks, measurements, census, bridge });
  console.log(`\nEvidence: ${evidenceDir}  ·  fixtures refreshed in ${FIXTURE_ROOT}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

export { REDACT_KEYS, RESOURCES, redact };
