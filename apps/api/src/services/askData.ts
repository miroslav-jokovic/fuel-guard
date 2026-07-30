import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODELS, CASE_RULE_ID, MPG_PLAUSIBLE_MIN, MPG_PLAUSIBLE_MAX, odometerAccuracy, type OdoRow } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { anthropicClient } from "../lib/anthropic.js";

// ── Safe, org-scoped query tools. The AI can ONLY call these (never raw SQL), and every query is
// pinned to the caller's org on the server — so it can't reach another tenant's data. Grouped:
// theft/alerts, fuel economics, drivers & idling, and integrity/coverage/fleet. ────────────────────

const TOOLS: Anthropic.Tool[] = [
  // ── Theft / alerts ──
  {
    name: "fleet_summary",
    description: "Totals for a recent period: fuel spend, gallons, high/critical theft alerts, siphoning events, and suspicious declined attempts.",
    input_schema: { type: "object", properties: { period_days: { type: "integer", description: "Look-back window in days (default 30)" } } },
  },
  {
    name: "top_risk",
    description: "The drivers or vehicles with the most flagged fills in the period, ranked highest-first.",
    input_schema: {
      type: "object",
      properties: { by: { type: "string", enum: ["driver", "vehicle"] }, period_days: { type: "integer" }, limit: { type: "integer", description: "Max rows (default 5)" } },
      required: ["by"],
    },
  },
  {
    name: "odometer_accuracy",
    description: "How accurately drivers (or vehicles) entered odometers vs. the Samsara reading: fills, mismatches (>5 mi), accuracy %, avg/max deviation. Worst first.",
    input_schema: {
      type: "object",
      properties: { by: { type: "string", enum: ["driver", "vehicle"] }, period_days: { type: "integer" }, limit: { type: "integer" } },
      required: ["by"],
    },
  },
  {
    name: "count_signal",
    description: "How many open theft cases in the period contain a given signal. Signals: location_mismatch, tank_space_exceeded, exceeds_tank_capacity, tank_fill_short, cumulative_overfuel, odometer_mismatch, card_multi_vehicle, rapid_repeat_fueling, off_hours_fueling.",
    input_schema: { type: "object", properties: { signal: { type: "string" }, period_days: { type: "integer" } }, required: ["signal"] },
  },
  // ── Fuel economics ──
  {
    name: "fuel_economics",
    description: "Fuel economics for a period: number of fills, total gallons, total spend, average price per gallon, gallon-weighted fleet MPG, and reefer (trailer) fuel spend + gallons.",
    input_schema: { type: "object", properties: { period_days: { type: "integer" } } },
  },
  {
    name: "fuel_ranking",
    description: "Rank drivers, vehicles, or fuel stations by a fuel metric over the period. metric=spend|gallons|mpg. order=desc (highest first, default) or asc (lowest first — e.g. worst MPG).",
    input_schema: {
      type: "object",
      properties: {
        by: { type: "string", enum: ["driver", "vehicle", "station"] },
        metric: { type: "string", enum: ["spend", "gallons", "mpg"] },
        order: { type: "string", enum: ["desc", "asc"] },
        period_days: { type: "integer" },
        limit: { type: "integer" },
      },
      required: ["by", "metric"],
    },
  },
  {
    name: "spend_trend",
    description: "Fuel spend, gallons and fleet MPG bucketed over time (bucket=day or week) for the period — for trend questions like 'is spend going up?'.",
    input_schema: { type: "object", properties: { bucket: { type: "string", enum: ["day", "week"] }, period_days: { type: "integer" } } },
  },
  // ── Drivers & idling ──
  {
    name: "driver_performance",
    description: "Driver performance scores over the period, averaged per driver and ranked. metric=safety|efficiency. order=desc (best first, default) or asc (worst first).",
    input_schema: {
      type: "object",
      properties: { metric: { type: "string", enum: ["safety", "efficiency"] }, order: { type: "string", enum: ["desc", "asc"] }, period_days: { type: "integer" }, limit: { type: "integer" } },
    },
  },
  {
    name: "idling_summary",
    description: "Idle totals for the period: idle hours and idle cost. Optionally rank the worst idlers by driver or vehicle (set `by`).",
    input_schema: { type: "object", properties: { by: { type: "string", enum: ["driver", "vehicle"] }, period_days: { type: "integer" }, limit: { type: "integer" } } },
  },
  // ── Integrity, coverage & fleet ──
  {
    name: "declined_summary",
    description: "Declined card attempts in the period, total and broken down by suspicion level (e.g. alert/warn/none).",
    input_schema: { type: "object", properties: { period_days: { type: "integer" } } },
  },
  {
    name: "telematics_coverage",
    description: "What share of fills in the period are corroborated by Samsara telematics: total fills, corroborated fills, and coverage %.",
    input_schema: { type: "object", properties: { period_days: { type: "integer" } } },
  },
  {
    name: "import_activity",
    description: "Recent EFS/report imports in the period: source, kind, filename, status, and row counts (total/inserted/duplicate). Newest first.",
    input_schema: { type: "object", properties: { period_days: { type: "integer" }, limit: { type: "integer" } } },
  },
  {
    name: "fleet_roster",
    description: "Fleet size right now: total and active counts of vehicles, drivers, and trailers.",
    input_schema: { type: "object", properties: {} },
  },
];

const n = (v: unknown): number | null => (v == null ? null : Number(v));
const plausible = (m: number | null): m is number => m != null && Number.isFinite(m) && m >= MPG_PLAUSIBLE_MIN && m <= MPG_PLAUSIBLE_MAX;

/** Fetch every row of a query by paging in 1000-row windows (PostgREST caps a page at 1000) — so
 *  aggregates are correct for orgs with more than 1000 rows in the window. Bounded to 50 pages. */
async function fetchAllPaged<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let page = 0; page < 50; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

async function nameMaps(admin: SupabaseClient, orgId: string) {
  const [{ data: veh }, { data: drv }] = await Promise.all([
    admin.from("vehicles").select("id, unit_number").eq("org_id", orgId),
    admin.from("drivers").select("id, full_name").eq("org_id", orgId),
  ]);
  return {
    unit: new Map((veh ?? []).map((v) => [v.id as string, v.unit_number as string])),
    driver: new Map((drv ?? []).map((d) => [d.id as string, d.full_name as string])),
  };
}

interface FuelRow {
  driver_id?: string | null;
  vehicle_id?: string | null;
  location_text?: string | null;
  fueled_at?: string | null;
  gallons: number | string | null;
  total_cost: number | string | null;
  computed_mpg?: number | string | null;
  tank_type?: string | null;
}

async function runTool(admin: SupabaseClient, orgId: string, name: string, input: Record<string, unknown>): Promise<unknown> {
  const period = Math.min(Math.max(Number(input.period_days) || 30, 1), 365);
  const since = new Date(Date.now() - period * 86400_000).toISOString();
  const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 25);

  if (name === "fleet_summary") {
    const [fuel, alerts, siphons, declines] = await Promise.all([
      fetchAllPaged<FuelRow>((lo, hi) =>
        admin.from("fuel_transactions").select("gallons, total_cost").eq("org_id", orgId).gte("fueled_at", since).order("fueled_at", { ascending: true }).range(lo, hi)),
      admin.from("anomalies").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("rule_id", CASE_RULE_ID).in("severity", ["high", "critical"]).in("status", ["open", "investigating"]).gte("fueled_at", since),
      admin.from("fuel_events").select("id", { count: "exact", head: true }).eq("org_id", orgId).gte("happened_at", since),
      admin.from("declined_transactions").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("suspicion_level", "alert").gte("declined_at", since),
    ]);
    return {
      period_days: period,
      fills: fuel.length,
      gallons: Math.round(fuel.reduce((s, r) => s + Number(r.gallons), 0)),
      spend: Math.round(fuel.reduce((s, r) => s + (n(r.total_cost) ?? 0), 0)),
      high_critical_alerts: alerts.count ?? 0,
      siphoning_events: siphons.count ?? 0,
      suspicious_declines: declines.count ?? 0,
    };
  }

  if (name === "top_risk") {
    const by = input.by === "vehicle" ? "vehicle" : "driver";
    const data = await fetchAllPaged<{ driver_id: string | null; vehicle_id: string | null }>((lo, hi) =>
      admin.from("fuel_transactions").select("driver_id, vehicle_id").eq("org_id", orgId).eq("has_anomaly", true).in("max_severity", ["high", "critical"]).gte("fueled_at", since).order("fueled_at", { ascending: true }).range(lo, hi));
    const maps = await nameMaps(admin, orgId);
    const counts = new Map<string, number>();
    for (const r of data) {
      const id = by === "vehicle" ? r.vehicle_id : r.driver_id;
      const label = id ? ((by === "vehicle" ? maps.unit : maps.driver).get(id) ?? "—") : "Unattributed";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return { by, period_days: period, rows: [...counts.entries()].map(([name2, flagged_fills]) => ({ name: name2, flagged_fills })).sort((a, b) => b.flagged_fills - a.flagged_fills).slice(0, limit) };
  }

  if (name === "odometer_accuracy") {
    const by = input.by === "vehicle" ? "vehicle" : "driver";
    const data = await fetchAllPaged<{
      odometer: number | string | null; samsara_odometer: number | string | null; driver_id: string | null; vehicle_id: string | null;
      vehicles: { unit_number: string } | null; drivers: { full_name: string } | null;
    }>((lo, hi) =>
      admin.from("fuel_transactions").select("odometer, samsara_odometer, driver_id, vehicle_id, vehicles(unit_number), drivers(full_name)").eq("org_id", orgId).gte("fueled_at", since).order("fueled_at", { ascending: true }).range(lo, hi));
    const rows: OdoRow[] = data.map((r) => ({
      driverId: r.driver_id, driverName: r.drivers?.full_name ?? null, vehicleId: r.vehicle_id, unit: r.vehicles?.unit_number ?? null,
      entered: n(r.odometer), samsara: n(r.samsara_odometer),
    }));
    return { by, period_days: period, rows: odometerAccuracy(rows, by).filter((r) => r.checked > 0).slice(0, limit) };
  }

  if (name === "count_signal") {
    const signal = String(input.signal ?? "");
    const data = await fetchAllPaged<{ evidence: { signals?: { key: string }[] } | null }>((lo, hi) =>
      admin.from("anomalies").select("evidence").eq("org_id", orgId).eq("rule_id", CASE_RULE_ID).in("status", ["open", "investigating"]).gte("fueled_at", since).order("id", { ascending: true }).range(lo, hi));
    let count = 0;
    for (const a of data) if ((a.evidence?.signals ?? []).some((s) => s.key === signal)) count += 1;
    return { signal, period_days: period, open_cases_with_signal: count };
  }

  if (name === "fuel_economics") {
    const rows = await fetchAllPaged<FuelRow>((lo, hi) =>
      admin.from("fuel_transactions").select("gallons, total_cost, computed_mpg, tank_type").eq("org_id", orgId).gte("fueled_at", since).order("fueled_at", { ascending: true }).range(lo, hi));
    let gallons = 0, spend = 0, reeferSpend = 0, reeferGal = 0, mpgW = 0, mpgG = 0;
    for (const r of rows) {
      const g = Number(r.gallons) || 0, c = n(r.total_cost) ?? 0;
      gallons += g; spend += c;
      if (r.tank_type === "reefer") { reeferSpend += c; reeferGal += g; }
      const m = n(r.computed_mpg);
      if (plausible(m) && g > 0) { mpgW += m * g; mpgG += g; }
    }
    return {
      period_days: period, fills: rows.length, gallons: Math.round(gallons), spend: Math.round(spend),
      avg_price_per_gal: gallons > 0 ? Math.round((spend / gallons) * 1000) / 1000 : null,
      fleet_mpg: mpgG > 0 ? Math.round((mpgW / mpgG) * 10) / 10 : null,
      reefer_spend: Math.round(reeferSpend), reefer_gallons: Math.round(reeferGal),
    };
  }

  if (name === "fuel_ranking") {
    const by = input.by === "vehicle" ? "vehicle" : input.by === "station" ? "station" : "driver";
    const metric = input.metric === "gallons" ? "gallons" : input.metric === "mpg" ? "mpg" : "spend";
    const order = input.order === "asc" ? "asc" : "desc";
    const rows = await fetchAllPaged<FuelRow>((lo, hi) =>
      admin.from("fuel_transactions").select("driver_id, vehicle_id, location_text, gallons, total_cost, computed_mpg").eq("org_id", orgId).gte("fueled_at", since).order("fueled_at", { ascending: true }).range(lo, hi));
    const maps = await nameMaps(admin, orgId);
    const agg = new Map<string, { spend: number; gallons: number; mpgW: number; mpgG: number }>();
    for (const r of rows) {
      let key: string;
      if (by === "station") key = (r.location_text || "Unknown").trim() || "Unknown";
      else { const id = by === "vehicle" ? r.vehicle_id : r.driver_id; key = id ? ((by === "vehicle" ? maps.unit : maps.driver).get(id) ?? "—") : "Unattributed"; }
      const a = agg.get(key) ?? { spend: 0, gallons: 0, mpgW: 0, mpgG: 0 };
      const g = Number(r.gallons) || 0, c = n(r.total_cost) ?? 0;
      a.spend += c; a.gallons += g;
      const m = n(r.computed_mpg);
      if (plausible(m) && g > 0) { a.mpgW += m * g; a.mpgG += g; }
      agg.set(key, a);
    }
    let ranked = [...agg.entries()].map(([nm, a]) => ({ name: nm, spend: Math.round(a.spend), gallons: Math.round(a.gallons), mpg: a.mpgG > 0 ? Math.round((a.mpgW / a.mpgG) * 10) / 10 : null }));
    if (metric === "mpg") ranked = ranked.filter((r) => r.mpg != null);
    ranked.sort((a, b) => {
      const av = (a as unknown as Record<string, number | null>)[metric] ?? 0;
      const bv = (b as unknown as Record<string, number | null>)[metric] ?? 0;
      return order === "asc" ? av - bv : bv - av;
    });
    return { by, metric, order, period_days: period, rows: ranked.slice(0, limit) };
  }

  if (name === "spend_trend") {
    const bucket = input.bucket === "day" ? "day" : "week";
    const rows = await fetchAllPaged<FuelRow>((lo, hi) =>
      admin.from("fuel_transactions").select("fueled_at, gallons, total_cost, computed_mpg").eq("org_id", orgId).gte("fueled_at", since).order("fueled_at", { ascending: true }).range(lo, hi));
    const agg = new Map<string, { spend: number; gallons: number; mpgW: number; mpgG: number }>();
    for (const r of rows) {
      if (!r.fueled_at) continue;
      const d = new Date(r.fueled_at);
      let key = d.toISOString().slice(0, 10);
      if (bucket === "week") { const wd = new Date(d); wd.setUTCDate(wd.getUTCDate() - ((wd.getUTCDay() + 6) % 7)); key = wd.toISOString().slice(0, 10); } // ISO Monday
      const a = agg.get(key) ?? { spend: 0, gallons: 0, mpgW: 0, mpgG: 0 };
      const g = Number(r.gallons) || 0, c = n(r.total_cost) ?? 0;
      a.spend += c; a.gallons += g;
      const m = n(r.computed_mpg);
      if (plausible(m) && g > 0) { a.mpgW += m * g; a.mpgG += g; }
      agg.set(key, a);
    }
    const series = [...agg.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, a]) => ({ date, spend: Math.round(a.spend), gallons: Math.round(a.gallons), fleet_mpg: a.mpgG > 0 ? Math.round((a.mpgW / a.mpgG) * 10) / 10 : null }));
    return { bucket, period_days: period, series };
  }

  if (name === "driver_performance") {
    const metric = input.metric === "efficiency" ? "efficiency" : "safety";
    const order = input.order === "asc" ? "asc" : "desc";
    const sinceDate = since.slice(0, 10);
    const data = await fetchAllPaged<{ driver_id: string; safety_score: number | string | null; efficiency_score: number | string | null }>((lo, hi) =>
      admin.from("driver_scores").select("driver_id, safety_score, efficiency_score, week_start").eq("org_id", orgId).gte("week_start", sinceDate).order("week_start", { ascending: true }).range(lo, hi));
    const maps = await nameMaps(admin, orgId);
    const agg = new Map<string, { sum: number; count: number }>();
    for (const r of data) {
      const v = n(metric === "efficiency" ? r.efficiency_score : r.safety_score);
      if (v == null) continue;
      const a = agg.get(r.driver_id) ?? { sum: 0, count: 0 };
      a.sum += v; a.count += 1; agg.set(r.driver_id, a);
    }
    const ranked = [...agg.entries()].map(([id, a]) => ({ name: maps.driver.get(id) ?? "—", score: Math.round((a.sum / a.count) * 10) / 10, weeks: a.count }));
    ranked.sort((a, b) => (order === "asc" ? a.score - b.score : b.score - a.score));
    return { metric, order, period_days: period, rows: ranked.slice(0, limit) };
  }

  if (name === "idling_summary") {
    const by = input.by === "vehicle" ? "vehicle" : input.by === "driver" ? "driver" : null;
    const rows = await fetchAllPaged<{ driver_id: string | null; vehicle_id: string | null; duration_sec: number | string | null; cost_usd: number | string | null }>((lo, hi) =>
      admin.from("idle_events").select("driver_id, vehicle_id, duration_sec, cost_usd").eq("org_id", orgId).gte("started_at", since).order("started_at", { ascending: true }).range(lo, hi));
    let totalSec = 0, totalCost = 0;
    const agg = new Map<string, { sec: number; cost: number }>();
    const maps = by ? await nameMaps(admin, orgId) : null;
    for (const r of rows) {
      const s = Number(r.duration_sec) || 0, c = n(r.cost_usd) ?? 0;
      totalSec += s; totalCost += c;
      if (by && maps) {
        const id = by === "vehicle" ? r.vehicle_id : r.driver_id;
        const key = id ? ((by === "vehicle" ? maps.unit : maps.driver).get(id) ?? "—") : "Unattributed";
        const a = agg.get(key) ?? { sec: 0, cost: 0 }; a.sec += s; a.cost += c; agg.set(key, a);
      }
    }
    const res: Record<string, unknown> = { period_days: period, events: rows.length, idle_hours: Math.round(totalSec / 3600), idle_cost: Math.round(totalCost) };
    if (by) res.worst = [...agg.entries()].map(([nm, a]) => ({ name: nm, idle_hours: Math.round(a.sec / 3600), idle_cost: Math.round(a.cost) })).sort((a, b) => b.idle_hours - a.idle_hours).slice(0, limit);
    return res;
  }

  if (name === "declined_summary") {
    const rows = await fetchAllPaged<{ suspicion_level: string | null }>((lo, hi) =>
      admin.from("declined_transactions").select("suspicion_level").eq("org_id", orgId).gte("declined_at", since).order("declined_at", { ascending: true }).range(lo, hi));
    const byLevel: Record<string, number> = {};
    for (const r of rows) { const k = r.suspicion_level ?? "unknown"; byLevel[k] = (byLevel[k] ?? 0) + 1; }
    return { period_days: period, total: rows.length, by_level: byLevel };
  }

  if (name === "telematics_coverage") {
    const [tot, cov] = await Promise.all([
      admin.from("fuel_transactions").select("id", { count: "exact", head: true }).eq("org_id", orgId).gte("fueled_at", since),
      admin.from("fuel_transactions").select("id", { count: "exact", head: true }).eq("org_id", orgId).gte("fueled_at", since).not("samsara_recon_at", "is", null),
    ]);
    const total = tot.count ?? 0, covered = cov.count ?? 0;
    return { period_days: period, fills: total, corroborated: covered, coverage_pct: total > 0 ? Math.round((covered / total) * 100) : null };
  }

  if (name === "import_activity") {
    const { data } = await admin
      .from("imports").select("source, kind, filename, status, total_rows, inserted_rows, duplicate_rows, created_at")
      .eq("org_id", orgId).gte("created_at", since).order("created_at", { ascending: false }).limit(limit);
    return { period_days: period, imports: data ?? [] };
  }

  if (name === "fleet_roster") {
    const [vTot, vAct, dTot, dAct, tTot, tAct] = await Promise.all([
      admin.from("vehicles").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      admin.from("vehicles").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "active"),
      admin.from("drivers").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      admin.from("drivers").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "active"),
      admin.from("trailers").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      admin.from("trailers").select("id", { count: "exact", head: true }).eq("org_id", orgId).neq("status", "retired"),
    ]);
    return {
      vehicles: vTot.count ?? 0, vehicles_active: vAct.count ?? 0,
      drivers: dTot.count ?? 0, drivers_active: dAct.count ?? 0,
      trailers: tTot.count ?? 0, trailers_active: tAct.count ?? 0,
    };
  }

  return { error: "unknown tool" };
}

const SYSTEM = `You answer a fleet manager's questions about their fleet operations data by calling the
provided tools (never guess numbers). The tools cover fuel-theft alerts, fuel economics (spend, gallons,
MPG, price, rankings, trends), driver performance, idling, declined attempts, telematics coverage, import
activity, and fleet roster. Pick the fewest tools needed, then give a short, direct plain-language answer
with the concrete figures (use compact tables when listing rankings). If a question is outside the
available tools, say what you can and can't answer. Keep answers concise.`;

/** Answer a natural-language question over the org's data via a bounded tool-use loop. */
export async function askData(admin: SupabaseClient, env: Env, orgId: string, question: string): Promise<string> {
  const client = anthropicClient(env);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];

  for (let i = 0; i < 6; i++) {
    const resp = await client.messages.create({ model: AI_MODELS.fast, max_tokens: 1024, system: SYSTEM, tools: TOOLS, messages });
    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      return resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    }
    messages.push({ role: "assistant", content: resp.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      let out: unknown;
      try {
        out = await runTool(admin, orgId, tu.name, (tu.input ?? {}) as Record<string, unknown>);
      } catch (e) {
        out = { error: e instanceof Error ? e.message : "tool failed" };
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
    }
    messages.push({ role: "user", content: results });
  }
  return "I couldn't complete that in a few steps — try asking something more specific.";
}
