<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { CASE_RULE_ID } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import { BADGE_BASE, severityTone, suspicionTone } from "@/lib/badges";

const { data: vehicles } = useVehiclesQuery();
const unit = (id: string | null) => (id ? (vehicles.value?.find((v) => v.id === id)?.unit_number ?? "—") : "—");
const fmt = (iso: string) => new Date(iso).toLocaleString();

const { data: alerts } = useQuery({
  queryKey: ["feed_alerts"],
  queryFn: async () => {
    const { data } = await supabase
      .from("anomalies")
      .select("id, vehicle_id, severity, message, fueled_at, created_at")
      .eq("rule_id", CASE_RULE_ID)
      .in("severity", ["high", "critical"])
      .in("status", ["open", "investigating"])
      .order("fueled_at", { ascending: false, nullsFirst: false })
      .limit(25);
    return (data ?? []) as { id: string; vehicle_id: string | null; severity: string; message: string; fueled_at: string | null; created_at: string }[];
  },
});

const { data: declines } = useQuery({
  queryKey: ["feed_declines"],
  queryFn: async () => {
    const { data } = await supabase
      .from("declined_transactions")
      .select("id, unit, city, state, declined_at, suspicion_level, suspicion_reasons")
      .eq("suspicion_level", "alert")
      .order("declined_at", { ascending: false })
      .limit(25);
    return (data ?? []) as { id: string; unit: string | null; city: string | null; state: string | null; declined_at: string; suspicion_level: string; suspicion_reasons: { detail: string }[] | null }[];
  },
});

const { data: drops } = useQuery({
  queryKey: ["fuel_events"],
  queryFn: async () => {
    const { data } = await supabase
      .from("fuel_events")
      .select("id, vehicle_id, drop_pct, happened_at, address")
      .order("happened_at", { ascending: false })
      .limit(25);
    return (data ?? []) as { id: string; vehicle_id: string | null; drop_pct: number | null; happened_at: string; address: string | null }[];
  },
});

const empty = computed(() => !(alerts.value?.length || declines.value?.length || drops.value?.length));
</script>

<template>
  <div class="space-y-6">
    <div class="rounded-md bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-200">
      Everything worth a look in one place — confirmed theft-risk alerts, suspicious declined attempts, and
      real-time siphoning (sudden fuel-drop) events.
    </div>

    <!-- Theft alerts -->
    <section class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <div class="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <h3 class="text-sm font-semibold text-gray-900">Active theft alerts <span class="font-normal text-gray-400">· {{ alerts?.length ?? 0 }}</span></h3>
        <RouterLink to="/anomalies" class="text-xs font-medium text-indigo-600 hover:text-indigo-500">Open Anomalies →</RouterLink>
      </div>
      <ul v-if="alerts?.length" class="divide-y divide-gray-100 text-sm">
        <li v-for="a in alerts" :key="a.id" class="flex items-center gap-3 px-5 py-2.5">
          <span :class="[BADGE_BASE, severityTone(a.severity)]">{{ a.severity }}</span>
          <span class="font-medium text-gray-900">{{ unit(a.vehicle_id) }}</span>
          <span class="flex-1 truncate text-gray-600">{{ a.message }}</span>
          <span class="whitespace-nowrap text-gray-400">{{ fmt(a.fueled_at ?? a.created_at) }}</span>
        </li>
      </ul>
      <p v-else class="px-5 py-4 text-sm text-gray-500">No high-risk theft cases right now.</p>
    </section>

    <!-- Suspicious declines -->
    <section class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <div class="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <h3 class="text-sm font-semibold text-gray-900">Suspicious declined attempts <span class="font-normal text-gray-400">· {{ declines?.length ?? 0 }}</span></h3>
        <RouterLink to="/rejections" class="text-xs font-medium text-indigo-600 hover:text-indigo-500">Open Rejections →</RouterLink>
      </div>
      <ul v-if="declines?.length" class="divide-y divide-gray-100 text-sm">
        <li v-for="d in declines" :key="d.id" class="flex items-center gap-3 px-5 py-2.5">
          <span :class="[BADGE_BASE, suspicionTone(d.suspicion_level)]">{{ d.suspicion_level }}</span>
          <span class="font-medium text-gray-900">{{ d.unit ?? "—" }}</span>
          <span class="flex-1 truncate text-gray-600">{{ (d.suspicion_reasons ?? [])[0]?.detail ?? `${d.city ?? ""} ${d.state ?? ""}` }}</span>
          <span class="whitespace-nowrap text-gray-400">{{ fmt(d.declined_at) }}</span>
        </li>
      </ul>
      <p v-else class="px-5 py-4 text-sm text-gray-500">No suspicious declines. Run "Rescore" on the Rejections page if you've just imported.</p>
    </section>

    <!-- Siphoning / fuel-drop events -->
    <section class="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
      <div class="border-b border-gray-100 px-5 py-3">
        <h3 class="text-sm font-semibold text-gray-900">Siphoning events (sudden fuel drops) <span class="font-normal text-gray-400">· {{ drops?.length ?? 0 }}</span></h3>
      </div>
      <ul v-if="drops?.length" class="divide-y divide-gray-100 text-sm">
        <li v-for="ev in drops" :key="ev.id" class="flex items-center gap-3 px-5 py-2.5">
          <span class="inline-flex items-center rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-600/20 ring-inset">
            {{ ev.drop_pct != null ? `−${ev.drop_pct}%` : "drop" }}
          </span>
          <span class="font-medium text-gray-900">{{ unit(ev.vehicle_id) }}</span>
          <span class="flex-1 truncate text-gray-600">{{ ev.address ?? "—" }}</span>
          <span class="whitespace-nowrap text-gray-400">{{ fmt(ev.happened_at) }}</span>
        </li>
      </ul>
      <p v-else class="px-5 py-4 text-sm text-gray-500">
        No fuel-drop events yet. These arrive in real time once the Samsara "Fuel Level → sudden decrease" alert is configured with the webhook.
      </p>
    </section>

    <p v-if="empty" class="text-center text-sm text-gray-400">Nothing flagged right now — that's a good thing.</p>
  </div>
</template>
