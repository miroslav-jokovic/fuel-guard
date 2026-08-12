#!/usr/bin/env node
/**
 * Why is the Idling page's "confident data" count low?
 *
 * The fleet avoidable-idle card sums CONFIDENT trucks only, and a truck is confident only when all
 * three of these hold (packages/shared/src/idleAvoidable.ts:238):
 *
 *     confident = coverage >= 0.5  &&  canJudge  &&  dutyCanJudge
 *
 *   coverage      — at least half the selected range has observed data
 *   canJudge      — idle_capability is known, and an optimized-idle truck has a 'sufficient' envelope
 *   dutyCanJudge  — an HOS duty overlay exists for the period and does not conflict
 *
 * A low count is therefore usually an EVIDENCE gap, not a calculation bug — and this tells you which
 * of the three is missing, per org, so you are not guessing.
 *
 * Run:  node scripts/idle-confidence-diagnose.mjs [--days 30] [--org <uuid>]
 * Reads Supabase credentials from apps/api/.env (service role — local use only, never in a browser).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DAYS = Number(arg("days", 30));
const ONLY_ORG = arg("org", null);

const envPath = join(ROOT, "apps/api/.env");
if (!existsSync(envPath)) {
  console.error(`No apps/api/.env — this script needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`);
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("apps/api/.env is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();

const countOf = async (table, apply) => {
  let q = db.from(table).select("*", { count: "exact", head: true });
  q = apply(q);
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
};

const { data: orgs, error: orgErr } = await db.from("organizations").select("id, name").order("name");
if (orgErr) throw new Error(`organizations: ${orgErr.message}`);
const targets = ONLY_ORG ? orgs.filter((o) => o.id === ONLY_ORG) : orgs;
if (targets.length === 0) {
  console.error(`No organization matched ${ONLY_ORG}.`);
  process.exit(1);
}

console.log(`\nIdle confidence preconditions — last ${DAYS} days\n`);

for (const org of targets) {
  const active = (q) => q.eq("org_id", org.id).eq("status", "active");

  const trucks = await countOf("vehicles", active);
  if (trucks === 0) continue;

  const hasCapability = await countOf("vehicles", (q) =>
    active(q).not("idle_capability", "is", null).neq("idle_capability", "unknown"),
  );
  const envelopeOk = await countOf("vehicles", (q) =>
    active(q).eq("idle_learned_envelope_status", "sufficient"),
  );

  // Distinct vehicles with an HOS duty segment in the window — the newest and strictest gate.
  const { data: hosRows, error: hosErr } = await db
    .from("hos_duty_segments")
    .select("vehicle_id")
    .eq("org_id", org.id)
    .gte("started_at", since)
    .not("vehicle_id", "is", null)
    .limit(50_000);
  if (hosErr) throw new Error(`hos_duty_segments: ${hosErr.message}`);
  const hasHos = new Set((hosRows ?? []).map((r) => r.vehicle_id)).size;

  const pct = (n) => `${String(n).padStart(4)} (${String(Math.round((n / trucks) * 100)).padStart(3)}%)`;
  console.log(`${org.name ?? org.id}`);
  console.log(`  active trucks                        ${String(trucks).padStart(4)}`);
  console.log(`  known idle capability                ${pct(hasCapability)}   ← gate 2 (canJudge)`);
  console.log(`  learned envelope 'sufficient'        ${pct(envelopeOk)}   ← gate 2 (optimized-idle only)`);
  console.log(`  HOS duty overlay in window           ${pct(hasHos)}   ← gate 3 (dutyCanJudge)`);

  const weakest = [
    ["idle capability sync", hasCapability],
    ["HOS duty overlay (Samsara HOS sync)", hasHos],
  ].sort((a, b) => a[1] - b[1])[0];
  const ceiling = Math.min(hasCapability, hasHos);
  console.log(
    `\n  Upper bound on confident trucks: ${ceiling} of ${trucks}` +
      ` — no truck can be confident without BOTH a known capability and a duty overlay.`,
  );
  console.log(`  Narrowest gate: ${weakest[0]}.\n`);
}

console.log(
  "If the numbers above are healthy but the page still shows few confident trucks, the remaining\n" +
    "gate is coverage (>= 50% of the selected range). Try a 30-day range first: rollup history starts\n" +
    "when the feature shipped, and a long span dilutes coverage below the floor — a bug already seen\n" +
    "in production (see the comment at apps/web/src/features/fleet/useIdleBreakdown.ts:294).\n",
);
