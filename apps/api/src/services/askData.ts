import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODELS, CASE_RULE_ID, odometerAccuracy, type OdoRow } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { anthropicClient } from "../lib/anthropic.js";

// ── Safe, org-scoped query tools. The AI can ONLY call these (never raw SQL), and every query is
// pinned to the caller's org on the server — so it can't reach another tenant's data. ──────────────

const TOOLS: Anthropic.Tool[] = [
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
      properties: {
        by: { type: "string", enum: ["driver", "vehicle"] },
        period_days: { type: "integer" },
        limit: { type: "integer", description: "Max rows (default 5)" },
      },
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
    input_schema: {
      type: "object",
      properties: { signal: { type: "string" }, period_days: { type: "integer" } },
      required: ["signal"],
    },
  },
];

const n = (v: unknown): number | null => (v == null ? null : Number(v));

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

async function runTool(admin: SupabaseClient, orgId: string, name: string, input: Record<string, unknown>): Promise<unknown> {
  const period = Math.min(Math.max(Number(input.period_days) || 30, 1), 365);
  const since = new Date(Date.now() - period * 86400_000).toISOString();
  const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 25);

  if (name === "fleet_summary") {
    const [{ data: fuel }, alerts, siphons, declines] = await Promise.all([
      admin.from("fuel_transactions").select("gallons, total_cost").eq("org_id", orgId).gte("fueled_at", since),
      admin.from("anomalies").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("rule_id", CASE_RULE_ID).in("severity", ["high", "critical"]).in("status", ["open", "investigating"]).gte("fueled_at", since),
      admin.from("fuel_events").select("id", { count: "exact", head: true }).eq("org_id", orgId).gte("happened_at", since),
      admin.from("declined_transactions").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("suspicion_level", "alert").gte("declined_at", since),
    ]);
    const rows = (fuel ?? []) as { gallons: number | string; total_cost: number | string | null }[];
    return {
      period_days: period,
      fills: rows.length,
      gallons: Math.round(rows.reduce((s, r) => s + Number(r.gallons), 0)),
      spend: Math.round(rows.reduce((s, r) => s + (n(r.total_cost) ?? 0), 0)),
      high_critical_alerts: alerts.count ?? 0,
      siphoning_events: siphons.count ?? 0,
      suspicious_declines: declines.count ?? 0,
    };
  }

  if (name === "top_risk") {
    const by = input.by === "vehicle" ? "vehicle" : "driver";
    const { data } = await admin
      .from("fuel_transactions")
      .select("driver_id, vehicle_id")
      .eq("org_id", orgId)
      .eq("has_anomaly", true)
      .in("max_severity", ["high", "critical"])
      .gte("fueled_at", since);
    const maps = await nameMaps(admin, orgId);
    const counts = new Map<string, number>();
    for (const r of (data ?? []) as { driver_id: string | null; vehicle_id: string | null }[]) {
      const id = by === "vehicle" ? r.vehicle_id : r.driver_id;
      const label = id ? ((by === "vehicle" ? maps.unit : maps.driver).get(id) ?? "—") : "Unattributed";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return {
      by,
      period_days: period,
      rows: [...counts.entries()].map(([name, flagged_fills]) => ({ name, flagged_fills })).sort((a, b) => b.flagged_fills - a.flagged_fills).slice(0, limit),
    };
  }

  if (name === "odometer_accuracy") {
    const by = input.by === "vehicle" ? "vehicle" : "driver";
    const { data } = await admin
      .from("fuel_transactions")
      .select("odometer, samsara_odometer, driver_id, vehicle_id, vehicles(unit_number), drivers(full_name)")
      .eq("org_id", orgId)
      .gte("fueled_at", since);
    const rows: OdoRow[] = ((data ?? []) as unknown as {
      odometer: number | string | null;
      samsara_odometer: number | string | null;
      driver_id: string | null;
      vehicle_id: string | null;
      vehicles: { unit_number: string } | null;
      drivers: { full_name: string } | null;
    }[]).map((r) => ({
      driverId: r.driver_id,
      driverName: r.drivers?.full_name ?? null,
      vehicleId: r.vehicle_id,
      unit: r.vehicles?.unit_number ?? null,
      entered: n(r.odometer),
      samsara: n(r.samsara_odometer),
    }));
    return { by, period_days: period, rows: odometerAccuracy(rows, by).filter((r) => r.checked > 0).slice(0, limit) };
  }

  if (name === "count_signal") {
    const signal = String(input.signal ?? "");
    const { data } = await admin
      .from("anomalies")
      .select("evidence")
      .eq("org_id", orgId)
      .eq("rule_id", CASE_RULE_ID)
      .in("status", ["open", "investigating"])
      .gte("fueled_at", since);
    let count = 0;
    for (const a of (data ?? []) as { evidence: { signals?: { key: string }[] } | null }[]) {
      if ((a.evidence?.signals ?? []).some((s) => s.key === signal)) count += 1;
    }
    return { signal, period_days: period, open_cases_with_signal: count };
  }

  return { error: "unknown tool" };
}

const SYSTEM = `You answer a fleet manager's questions about their fuel-theft data by calling the provided
tools (never guess numbers). Pick the fewest tools needed, then give a short, direct plain-language
answer with the concrete figures. If a question is outside the available data, say what you can and can't
answer. Keep answers concise.`;

/** Answer a natural-language question over the org's data via a bounded tool-use loop. */
export async function askData(admin: SupabaseClient, env: Env, orgId: string, question: string): Promise<string> {
  const client = anthropicClient(env);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];

  for (let i = 0; i < 5; i++) {
    const resp = await client.messages.create({
      model: AI_MODELS.fast,
      max_tokens: 1024,
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
    const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      return resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
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
