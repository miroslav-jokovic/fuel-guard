import "dotenv/config";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { acceptLoad, startLoad } from "./index.js";
import { createLoad, transitionLoad } from "./dispatchLoads/mutations.js";

/**
 * Put two or three loads in front of a real driver, so the app can be DEMONSTRATED and TESTED before
 * McLeod is connected.
 *
 * ── WHY THIS EXISTS, AND WHAT IT IS NOT ────────────────────────────────────────────────────────
 * Production holds 286 drivers and ZERO loads (measured 2026-09-08). The dispatch surface that
 * creates them is real and works; nobody has used it yet, because the load feed is McLeod's and that
 * connection is still a sandbox with a stale copy. So every tester and every person watching a demo
 * opens the Loads tab to an empty state, and an empty app is indistinguishable from a broken one.
 *
 * This is scaffolding with a removal date, not a feature. It writes ordinary rows through the same
 * columns dispatch writes, so what a driver sees is exactly what they will see when the rows come
 * from McLeod instead — which is the only reason a demo on seeded data proves anything at all.
 *
 * ── EVERY SAFETY PROPERTY, AND WHY EACH ONE IS HERE ────────────────────────────────────────────
 * ⚠ The only Supabase this repo is configured against is PRODUCTION. That is the whole reason for
 * the care below; `seedPspQaDrivers.ts` next door carries the same argument.
 *
 *  1. **Dry run by default.** Nothing is written without `--apply`. The report prints exactly what
 *     would be created, against the named org and driver, resolved to their real names.
 *  2. **No default org and no default driver.** Both are required arguments. A script that defaults
 *     to somebody's tenant is a script that writes to the wrong tenant on the day someone runs it
 *     without reading it.
 *  3. **Every row is marked.** `ref` begins with `DEMO-` and `notes` says what it is in words. A
 *     demo load must be identifiable as one by a person looking at a screen, not only by a script.
 *  4. **`--remove` undoes it exactly.** `loads` is deliberately NOT in `RETENTION_FORBIDDEN` and the
 *     removal is scoped to this marker, so seeded rows can be taken out again without touching a
 *     single real one. That is what makes running this against a live tenant defensible.
 *  5. **It refuses a driver with existing non-demo loads.** The day McLeod is connected, this script
 *     must not add fiction beside a driver's real work. That check is the deadline built in.
 *
 * ── THE LOADS ARE THE THREE STATES WORTH SHOWING ───────────────────────────────────────────────
 * One `offered` (the deck a driver accepts or declines), one `accepted` (waiting to roll), one
 * `in_transit` with its first stop completed (the live job). Together they exercise Home's active
 * card, the Loads tab's three groups, the stop list, and the accept/start/arrive writes through the
 * offline outbox — which is the data flow a demo is actually about.
 *
 *   pnpm --filter @silvicom/api demo:loads --org <uuid> --driver <uuid>            # report only
 *   pnpm --filter @silvicom/api demo:loads --org <uuid> --driver <uuid> --apply
 *   pnpm --filter @silvicom/api demo:loads --org <uuid> --driver <uuid> --remove --apply
 */

/** Every seeded row carries it, in `ref` and in `notes`. The removal keys on the `ref` prefix. */
const DEMO_PREFIX = "DEMO-";
const DEMO_NOTE = "Demo load — seeded for app testing before the McLeod connection. Safe to delete.";

interface Args {
  org: string | null;
  driver: string | null;
  apply: boolean;
  remove: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const valueFor = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : null;
  };
  return {
    org: valueFor("--org"),
    driver: valueFor("--driver"),
    apply: argv.includes("--apply"),
    remove: argv.includes("--remove"),
  };
}

/** A stop, relative to "today" so a demo run is never showing last month's appointment. */
interface StopSpec {
  seq: number;
  kind: "pickup" | "dropoff";
  name: string;
  city: string;
  state: string;
  /** Hours from now for the appointment window's start. */
  hours: number;
  requiredPhotos: string[];
  status?: "pending" | "completed";
}

interface LoadSpec {
  suffix: string;
  status: "offered" | "accepted" | "in_transit";
  equipment: string;
  commodity: string;
  totalMiles: number;
  stops: StopSpec[];
}

/**
 * Real lanes, real cities, plausible windows. Not because the app checks — it does not — but because
 * a demo where the freight runs Chicago → Chicago in nine minutes is a demo the room stops believing.
 */
const LOADS: LoadSpec[] = [
  {
    suffix: "1042",
    status: "offered",
    equipment: "Dry van",
    commodity: "Palletised dry goods",
    totalMiles: 412,
    stops: [
      { seq: 1, kind: "pickup", name: "Joliet DC", city: "Joliet", state: "IL", hours: 18, requiredPhotos: ["bol"] },
      { seq: 2, kind: "dropoff", name: "Effingham Yard", city: "Effingham", state: "IL", hours: 26, requiredPhotos: ["bol", "seal"] },
    ],
  },
  {
    suffix: "1043",
    status: "accepted",
    equipment: "Dry van",
    commodity: "Packaged foodstuffs",
    totalMiles: 268,
    stops: [
      { seq: 1, kind: "pickup", name: "Whitestown DC", city: "Whitestown", state: "IN", hours: 40, requiredPhotos: ["bol"] },
      { seq: 2, kind: "dropoff", name: "Columbus Grocery", city: "Columbus", state: "OH", hours: 48, requiredPhotos: ["bol"] },
    ],
  },
  {
    suffix: "1044",
    status: "in_transit",
    equipment: "Reefer",
    commodity: "Chilled produce",
    totalMiles: 186,
    stops: [
      { seq: 1, kind: "pickup", name: "Rockford Cold Store", city: "Rockford", state: "IL", hours: -4, requiredPhotos: ["bol"], status: "completed" },
      { seq: 2, kind: "dropoff", name: "Milwaukee Market", city: "Milwaukee", state: "WI", hours: 3, requiredPhotos: ["bol", "trailer"] },
    ],
  },
];

const iso = (hoursFromNow: number): string => new Date(Date.now() + hoursFromNow * 3600_000).toISOString();

interface Context {
  orgName: string;
  driverName: string;
  /**
   * Who the seeded loads are attributed to. Every dispatch write names an actor — `created_by`,
   * `approved_by`, `assigned_by`, and a `load_events` row per transition — so a demo load with no
   * actor is not merely untidy, it is a load the timeline cannot explain. The org's own admin is the
   * honest answer: they are the person who WOULD have dispatched it.
   */
  actor: { userId: string; role: string | null };
}

/** Resolve and validate both ids before anything is written, so the report names real records. */
async function resolveContext(admin: SupabaseClient, orgId: string, driverId: string): Promise<Context> {
  const { data: org } = await admin.from("organizations").select("id, name").eq("id", orgId).maybeSingle();
  if (!org) throw new Error(`No organization ${orgId}.`);

  // Scoped by org as well as id — the service role bypasses RLS, so a driver id from another tenant
  // would otherwise resolve happily and seed a load across the boundary.
  const { data: driver } = await admin
    .from("drivers")
    .select("id, full_name, org_id")
    .eq("id", driverId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!driver) throw new Error(`No driver ${driverId} in ${org.name}.`);

  const { data: admins } = await admin
    .from("memberships")
    .select("user_id, role")
    .eq("org_id", orgId)
    .in("role", ["admin", "fleet_manager", "dispatcher"])
    .order("created_at", { ascending: true })
    .limit(1);
  const actorRow = (admins ?? [])[0] as { user_id: string; role: string } | undefined;
  if (!actorRow) {
    throw new Error(
      `${org.name} has no admin, fleet manager or dispatcher to attribute the loads to. ` +
        `A dispatch load records who created, approved and released it; there is nobody here to name.`,
    );
  }

  return {
    orgName: org.name,
    driverName: driver.full_name ?? driverId,
    actor: { userId: actorRow.user_id, role: actorRow.role },
  };
}

/**
 * Refuse to seed beside real work.
 *
 * This is the built-in deadline: the moment McLeod delivers a real load for this driver, the script
 * stops being usable rather than quietly mixing fiction into their day. `--remove` still works, so
 * the escape hatch survives the refusal.
 */
async function assertNoRealLoads(admin: SupabaseClient, orgId: string, driverId: string): Promise<void> {
  const { data } = await admin
    .from("loads")
    .select("id, ref")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .not("ref", "like", `${DEMO_PREFIX}%`)
    .limit(1);
  if (data && data.length > 0) {
    throw new Error(
      `That driver already has a real load (${data[0]!.ref}). Refusing to seed demo data beside it — ` +
        `pick a driver with no dispatched work, or use --remove to clear demo loads.`,
    );
  }
}

async function removeDemoLoads(admin: SupabaseClient, orgId: string, driverId: string): Promise<number> {
  const { data: existing } = await admin
    .from("loads")
    .select("id")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .like("ref", `${DEMO_PREFIX}%`);
  const ids = (existing ?? []).map((r) => r.id as string);
  if (ids.length === 0) return 0;

  // Stops first: `load_stops.load_id` has no cascade to lean on here, and an orphaned stop would be
  // invisible to every surface while still counting against the load it no longer belongs to.
  await admin.from("load_stops").delete().eq("org_id", orgId).in("load_id", ids);
  await admin.from("loads").delete().eq("org_id", orgId).in("id", ids);
  return ids.length;
}

async function seed(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  actor: { userId: string; role: string | null },
): Promise<number> {
  let created = 0;
  for (const spec of LOADS) {
    /*
     * ⚠ EVERY ROW GOES THROUGH THE LOADS MODULE'S OWN WRITES, never a raw insert here.
     *
     * `lint:table-writers` offered the other path — pin `seedDemoLoads.ts` as a writer of `loads`
     * and `load_stops` in the manifest — and taking it would have been the wrong answer even though
     * the gate would have gone quiet. A demo exists to show what the app does with real data; rows
     * this script invented by hand could differ from rows dispatch produces in ways nobody would
     * notice until the McLeod feed arrived and behaved differently. Going through `createLoad` and
     * `transitionLoad` means the seeded loads ARE dispatch loads: same defaults, same D45 gate, same
     * `load_events` timeline, same return-to-duty refusal.
     */
    const result = await createLoad(admin, orgId, actor, {
      ref: `${DEMO_PREFIX}${spec.suffix}`,
      driver_id: driverId,
      hazmat: false,
      equipment: spec.equipment,
      commodity: spec.commodity,
      total_miles: spec.totalMiles,
      notes: DEMO_NOTE,
      stops: spec.stops.map((st) => ({
        seq: st.seq,
        kind: st.kind,
        name: st.name,
        city: st.city,
        state: st.state,
        appointment_start: iso(st.hours),
        appointment_end: iso(st.hours + 2),
        required_photos: st.requiredPhotos,
      })),
    });
    if (!result.ok) throw new Error(`${DEMO_PREFIX}${spec.suffix}: ${result.message}`);
    const loadId = result.data.id;

    // The dispatch half of D45, in the order a real load walks it. `release` is what turns an
    // approved load into one the driver's phone can see at all.
    for (const action of ["submit", "approve", "release"] as const) {
      const step = await transitionLoad(admin, orgId, loadId, actor, action);
      if (!step.ok) throw new Error(`${DEMO_PREFIX}${spec.suffix} ${action}: ${step.message}`);
    }

    // …and the driver half, for the two loads that are meant to be further along. Same functions
    // the phone calls, so `accepted_at` and the duty-session stamping are whatever the real path
    // produces rather than whatever this script guessed.
    if (spec.status === "accepted" || spec.status === "in_transit") {
      const accepted = await acceptLoad(admin, orgId, driverId, loadId, actor.userId, {});
      if (!accepted.ok) throw new Error(`${DEMO_PREFIX}${spec.suffix} accept: ${accepted.message}`);
    }
    if (spec.status === "in_transit") {
      const started = await startLoad(admin, orgId, driverId, loadId, actor.userId, {});
      if (!started.ok) throw new Error(`${DEMO_PREFIX}${spec.suffix} start: ${started.message}`);
    }
    created += 1;
  }
  return created;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (!args.org || !args.driver) {
    console.error(
      "Both --org <uuid> and --driver <uuid> are required.\n" +
        "  pnpm --filter @silvicom/api demo:loads --org <uuid> --driver <uuid>          # report only\n" +
        "  … --apply           write them\n" +
        "  … --remove --apply  take them out again",
    );
    process.exitCode = 1;
    return;
  }

  const admin = getSupabaseAdmin(loadEnv());
  const ctx = await resolveContext(admin, args.org, args.driver);

  console.log(`Org:    ${ctx.orgName}`);
  console.log(`Driver: ${ctx.driverName}`);
  console.log(`Actor:  ${ctx.actor.role} ${ctx.actor.userId} (loads are attributed to them)`);

  if (args.remove) {
    if (!args.apply) {
      const { data } = await admin
        .from("loads")
        .select("ref")
        .eq("org_id", args.org)
        .eq("driver_id", args.driver)
        .like("ref", `${DEMO_PREFIX}%`);
      console.log(`\nWould remove ${data?.length ?? 0} demo load(s): ${(data ?? []).map((r) => r.ref).join(", ") || "none"}`);
      console.log("Re-run with --apply to remove them.");
      return;
    }
    const removed = await removeDemoLoads(admin, args.org, args.driver);
    console.log(`\nRemoved ${removed} demo load(s) and their stops.`);
    return;
  }

  await assertNoRealLoads(admin, args.org, args.driver);
  const already = await admin
    .from("loads")
    .select("ref")
    .eq("org_id", args.org)
    .eq("driver_id", args.driver)
    .like("ref", `${DEMO_PREFIX}%`);
  if ((already.data ?? []).length > 0) {
    console.log(`\n${already.data!.length} demo load(s) already seeded: ${already.data!.map((r) => r.ref).join(", ")}`);
    console.log("Remove them first (--remove --apply) if you want a clean set.");
    return;
  }

  if (!args.apply) {
    console.log("\nWould create:");
    for (const l of LOADS) {
      console.log(`  ${DEMO_PREFIX}${l.suffix}  ${l.status.padEnd(10)} ${l.equipment} · ${l.commodity} · ${l.totalMiles} mi`);
      for (const s of l.stops) console.log(`      ${s.seq}. ${s.kind.padEnd(7)} ${s.name}, ${s.city} ${s.state}`);
    }
    console.log("\nNothing written. Re-run with --apply.");
    return;
  }

  const created = await seed(admin, args.org, args.driver, ctx.actor);
  console.log(`\nCreated ${created} demo load(s) for ${ctx.driverName}.`);
  console.log("Remove them with the same command plus --remove --apply.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
