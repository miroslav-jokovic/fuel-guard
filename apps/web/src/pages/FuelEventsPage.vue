<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { CASE_RULE_ID } from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { useVehiclesQuery } from "@/features/fleet/useVehicles";
import BaseCard from "@/components/ui/BaseCard.vue";
import { BADGE_BASE, severityTone, suspicionTone, toneClass } from "@/lib/badges";

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
    <div class="rounded-md bg-warning-50 p-4 text-sm text-warning-800 ring-1 ring-warning-200">
      Everything worth a look in one place — confirmed theft-risk alerts, suspicious declined attempts, and
      real-time siphoning (sudden fuel-drop) events.
    </div>

    <!-- Theft alerts -->
    <BaseCard as="section" padding="none">
      <div class="flex items-center justify-between border-b border-edge-subtle px-5 py-3">
        <h3 class="text-sm font-semibold text-ink">Active theft alerts <span class="font-normal text-ink-subtle">· {{ alerts?.length ?? 0 }}</span></h3>
        <RouterLink to="/anomalies" class="text-xs font-medium text-brand-600 hover:text-brand-500">Open Anomalies →</RouterLink>
      </div>
      <ul v-if="alerts?.length" class="divide-y divide-edge-subtle text-sm">
        <li v-for="a in alerts" :key="a.id" class="flex items-center gap-3 px-5 py-2.5">
          <span :class="[BADGE_BASE, severityTone(a.severity)]">{{ a.severity }}</span>
          <span class="font-medium text-ink">{{ unit(a.vehicle_id) }}</span>
          <span class="flex-1 truncate text-ink-secondary">{{ a.message }}</span>
          <span class="whitespace-nowrap text-ink-subtle">{{ fmt(a.fueled_at ?? a.created_at) }}</span>
        </li>
      </ul>
      <p v-else class="px-5 py-4 text-sm text-ink-muted">No high-risk theft cases right now.</p>
    </BaseCard>

    <!-- Suspicious declines -->
    <BaseCard as="section" padding="none">
      <div class="flex items-center justify-between border-b border-edge-subtle px-5 py-3">
        <h3 class="text-sm font-semibold text-ink">Suspicious declined attempts <span class="font-normal text-ink-subtle">· {{ declines?.length ?? 0 }}</span></h3>
        <RouterLink to="/rejections" class="text-xs font-medium text-brand-600 hover:text-brand-500">Open Rejections →</RouterLink>
      </div>
      <ul v-if="declines?.length" class="divide-y divide-edge-subtle text-sm">
        <li v-for="d in declines" :key="d.id" class="flex items-center gap-3 px-5 py-2.5">
          <span :class="[BADGE_BASE, suspicionTone(d.suspicion_level)]">{{ d.suspicion_level }}</span>
          <span class="font-medium text-ink">{{ d.unit ?? "—" }}</span>
          <span class="flex-1 truncate text-ink-secondary">{{ (d.suspicion_reasons ?? [])[0]?.detail ?? `${d.city ?? ""} ${d.state ?? ""}` }}</span>
          <span class="whitespace-nowrap text-ink-subtle">{{ fmt(d.declined_at) }}</span>
        </li>
      </ul>
      <p v-else class="px-5 py-4 text-sm text-ink-muted">No suspicious declines. Run "Rescore" on the Rejections page if you've just imported.</p>
    </BaseCard>

    <!-- Siphoning / fuel-drop events -->
    <BaseCard as="section" padding="none">
      <div class="border-b border-edge-subtle px-5 py-3">
        <h3 class="text-sm font-semibold text-ink">Siphoning events (sudden fuel drops) <span class="font-normal text-ink-subtle">· {{ drops?.length ?? 0 }}</span></h3>
      </div>
      <ul v-if="drops?.length" class="divide-y divide-edge-subtle text-sm">
        <li v-for="ev in drops" :key="ev.id" class="flex items-center gap-3 px-5 py-2.5">
          <span :class="[BADGE_BASE, toneClass('danger')]">
            {{ ev.drop_pct != null ? `−${ev.drop_pct}%` : "drop" }}
          </span>
          <span class="font-medium text-ink">{{ unit(ev.vehicle_id) }}</span>
          <span class="flex-1 truncate text-ink-secondary">{{ ev.address ?? "—" }}</span>
          <span class="whitespace-nowrap text-ink-subtle">{{ fmt(ev.happened_at) }}</span>
        </li>
      </ul>
      <p v-else class="px-5 py-4 text-sm text-ink-muted">
        No fuel-drop events yet. These arrive in real time once the Samsara "Fuel Level → sudden decrease" alert is configured with the webhook.
      </p>
    </BaseCard>

    <p v-if="empty" class="text-center text-sm text-ink-subtle">Nothing flagged right now — that's a good thing.</p>
  </div>
</template>
