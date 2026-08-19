#!/usr/bin/env node
/**
 * SambaSafety account recon — DQF execution plan step A5. STRICTLY READ-ONLY.
 *
 * Settles the four account facts the owner's answers left to a script (SAMBA-RECON.md §8):
 *   1. Which MVR product the account actually buys — probe each product's list surface; the one
 *      returning rows is the answer, and the E2 client hard-codes that path and no other.
 *   2. The Silvicom groupId — resolved by name ONCE here, stored, never name-matched at runtime.
 *   3. The current monitoring footprint — enrolled-licence count, the baseline for E3/E4.
 *   4. Existing webhook subscriptions — so E5 never creates a duplicate.
 *
 * EVERY call is a GET or a search POST. Nothing is ordered, nothing is billed, nothing is written
 * to the vendor. Re-running it is free and idempotent — that property is the point.
 *
 * PII: an MVR is the most sensitive record in the product. This script prints COUNTS, IDS, NAMES OF
 * GROUPS and RESPONSE KEY SHAPES — never a licence number, never a person row, never a report body.
 *
 * Credentials (three per environment — SAMBA-RECON.md §2), read from env or apps/api/.env:
 *   SAMBA_CLIENT_ID / SAMBA_CLIENT_SECRET / SAMBA_API_KEY
 *   SAMBA_BASE_URL — defaults to production https://api.sambasafety.io
 *
 *   node scripts/samba-recon.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function loadEnv() {
  const out = { ...process.env };
  const envPath = join(ROOT, "apps/api/.env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i > 0 && !line.startsWith("#")) out[line.slice(0, i)] ??= line.slice(i + 1).trim();
    }
  }
  return out;
}
const env = loadEnv();
const BASE = env.SAMBA_BASE_URL || "https://api.sambasafety.io";
const { SAMBA_CLIENT_ID, SAMBA_CLIENT_SECRET, SAMBA_API_KEY } = env;
if (!SAMBA_CLIENT_ID || !SAMBA_CLIENT_SECRET || !SAMBA_API_KEY) {
  console.error(
    "Missing credentials. Set SAMBA_CLIENT_ID, SAMBA_CLIENT_SECRET and SAMBA_API_KEY " +
      "(env or apps/api/.env). SAMBA_BASE_URL defaults to production.",
  );
  process.exit(2);
}

// ── auth: OAuth2 client-credentials + X-Api-Key on every call (SAMBA-RECON.md §2) ────────────────
const tokenRes = await fetch(`${BASE}/oauth2/v1/token`, {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`${SAMBA_CLIENT_ID}:${SAMBA_CLIENT_SECRET}`).toString("base64")}`,
    "X-Api-Key": SAMBA_API_KEY,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  },
  body: "grant_type=client_credentials&scope=API",
});
if (!tokenRes.ok) {
  console.error(`Token request failed: HTTP ${tokenRes.status} — wrong credentials or wrong host (${BASE})`);
  process.exit(1);
}
const { access_token } = await tokenRes.json();
console.log(`auth ok against ${BASE}\n`);

const HEADERS = {
  Authorization: `Bearer ${access_token}`,
  "X-Api-Key": SAMBA_API_KEY,
  Accept: "application/json",
};

/**
 * One read. Returns { status, body } and NEVER prints bodies — callers print counts and key shapes.
 * §6: application errors arrive as HTTP 200 with an error `code`; surfaced here so a "200" is never
 * read as data without looking.
 */
async function read(method, path, jsonBody) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: jsonBody ? { ...HEADERS, "Content-Type": "application/json" } : HEADERS,
    body: jsonBody ? JSON.stringify(jsonBody) : undefined,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body — reported by status alone */
  }
  const errCode = body && typeof body === "object" && "code" in body ? body.code : null;
  return { status: res.status, body, errCode };
}

const rows = (b) =>
  Array.isArray(b) ? b : (b?.content ?? b?.data ?? b?.items ?? b?.results ?? null);
const shape = (b) => (b && typeof b === "object" ? Object.keys(b).join(",") : String(b));

// ── 1. which MVR product — probe each list surface; rows = the product we buy ────────────────────
console.log("MVR product probes (the one returning rows is the product in use):");
const PROBES = [
  ["GET", "/transactional/v1/mvrorders?page=1&size=5"],
  ["GET", "/orders/v1/mvrreports/activity?page=1&size=5"],
  ["GET", "/orders/v1/mvrreports/intelligent?page=1&size=5"],
  ["GET", "/orders/v1/reports/cdlis?page=1&size=5"],
];
for (const [method, path] of PROBES) {
  const r = await read(method, path);
  const list = rows(r.body);
  const summary =
    r.errCode != null
      ? `application error ${r.errCode} (HTTP ${r.status})`
      : list
        ? `${list.length} row(s) on page 1${list.length ? ` — row keys: ${shape(list[0])}` : ""}`
        : `HTTP ${r.status}, body keys: ${shape(r.body)}`;
  console.log(`  ${path.split("?")[0]}  →  ${summary}`);
}

// ── 2. the Silvicom groupId — resolved by name once, stored forever ──────────────────────────────
console.log("\nGroups:");
const g = await read("GET", "/organization/v1/groups?page=1&size=50");
const groups = rows(g.body) ?? [];
for (const grp of groups) {
  const name = grp.name ?? grp.groupName ?? "?";
  const id = grp.id ?? grp.groupId ?? "?";
  const mark = /silvicom/i.test(String(name)) ? "  ← SILVICOM (pin this groupId)" : "";
  console.log(`  ${id}  ${name}${mark}`);
}
if (!groups.length) console.log(`  none returned (HTTP ${g.status}, keys: ${shape(g.body)})`);

// ── 3. monitoring footprint — enrolled licences today (baseline for E3/E4) ───────────────────────
console.log("\nMonitoring enrollments:");
const m = await read("POST", "/monitoring/v1/licenseenrollments/search?page=1&size=1", {});
const mList = rows(m.body);
const total = m.body?.totalElements ?? m.body?.total ?? m.body?.totalCount ?? null;
console.log(
  m.errCode != null
    ? `  application error ${m.errCode} (HTTP ${m.status})`
    : `  HTTP ${m.status} — total enrolled: ${total ?? `unknown (body keys: ${shape(m.body)})`}${
        mList?.length ? ` — row keys: ${shape(mList[0])}` : ""
      }`,
);

// ── 4. existing webhook subscriptions — E5 must not duplicate one ────────────────────────────────
console.log("\nWebhook subscriptions:");
const s = await read("GET", "/reports/v1/subscriptions");
const subs = rows(s.body) ?? [];
for (const sub of subs) {
  console.log(
    `  ${sub.subscriptionId ?? sub.id ?? "?"}  url=${sub.url ?? "?"}  events=${
      Array.isArray(sub.eventTypes) ? sub.eventTypes.length : "?"
    }`,
  );
}
if (!subs.length) console.log(`  none (HTTP ${s.status})`);

console.log(
  "\nDone — read-only. Record the product path, the Silvicom groupId and the enrolled count in " +
    "docs/plans/safety-dqf/SAMBA-RECON.md §8.",
);
