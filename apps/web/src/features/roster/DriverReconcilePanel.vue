<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppButton as BaseButton, AppSelect } from "@silvicom/ui";
import type { Driver } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { useDriverReconcile } from "./useDriverReconcile";

/**
 * Reconcile duplicate / name-only drivers with Samsara — the panel the Drivers page opens from
 * "Reconcile with Samsara".
 *
 * Moved out of `DriversPage` unchanged (DQ-FILE-COLUMN, 2026-11-03), so the page had room under its
 * 500-line budget for the File column's upload dialog. The panel owns its own state; the page only
 * says when it is open and hands it the roster it already holds.
 */
const props = defineProps<{ open: boolean; drivers: Driver[] }>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const reconcile = useDriverReconcile();
const linkTarget = ref<Record<string, string>>({}); // sourceId -> chosen canonical driver id

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    linkTarget.value = {};
    await reconcile.preview();
  },
);

// Samsara drivers to pick from when manually linking (those already carrying a Samsara id).
const samsaraCandidates = computed(() =>
  props.drivers.filter((d) => d.samsara_driver_id).sort((a, b) => a.full_name.localeCompare(b.full_name)),
);
// Unmatched drivers the auto-plan did NOT cover (need a manual link).
const stillUnmatched = computed(() => {
  const autoIds = new Set((reconcile.report.value?.pairs ?? []).map((p) => p.sourceId));
  return props.drivers.filter((d) => !d.samsara_driver_id && !autoIds.has(d.id));
});
async function applyReconcile() {
  const n = await reconcile.apply();
  if (reconcile.error.value) toast.error("Reconcile failed", reconcile.error.value);
  else toast.success(`Merged ${n} duplicate driver${n === 1 ? "" : "s"}`);
}
async function linkDriver(sourceId: string) {
  const canonicalId = linkTarget.value[sourceId];
  if (!canonicalId) return;
  const ok = await reconcile.linkOne(sourceId, canonicalId);
  if (ok) {
    toast.success("Driver linked & merged");
    await reconcile.preview();
  } else toast.error("Link failed", reconcile.error.value ?? undefined);
}
</script>

<template>
  <SlideOver :open="props.open" title="Reconcile drivers with Samsara" @close="emit('close')">
    <div v-if="reconcile.loading.value" class="text-sm text-ink-muted">Analyzing…</div>
    <div v-else class="space-y-6">
      <p class="text-sm text-ink-muted">
        Drivers created from EFS fuel-card names are folded into their Samsara record, moving all
        fuel, idle and HOS history onto the one row. Only confident matches (phone, or an
        unambiguous full name) are auto-merged; the rest you can link by hand below.
      </p>

      <div>
        <div class="flex items-center justify-between">
          <h4 class="text-sm font-semibold text-ink">
            Confident merges ({{ reconcile.report.value?.planned ?? 0 }})
          </h4>
          <BaseButton
            v-if="(reconcile.report.value?.planned ?? 0) > 0"
            variant="primary"
            size="sm"
            :disabled="reconcile.applying.value"
            @click="applyReconcile"
          >
            {{
              reconcile.applying.value
                ? "Merging…"
                : `Apply ${reconcile.report.value?.planned} merge(s)`
            }}
          </BaseButton>
        </div>
        <ul class="mt-2 divide-y divide-edge-subtle rounded-control border border-edge">
          <li
            v-for="pr in reconcile.report.value?.pairs ?? []"
            :key="pr.sourceId"
            class="flex items-center justify-between px-3 py-2 text-sm"
          >
            <span
              ><span class="text-ink-secondary">{{ pr.sourceName }}</span> →
              <span class="font-medium text-ink">{{ pr.canonicalName }}</span></span
            >
            <span class="text-xs text-ink-tertiary">by {{ pr.matchedBy }}</span>
          </li>
          <li
            v-if="!(reconcile.report.value?.pairs ?? []).length"
            class="px-3 py-2 text-sm text-ink-tertiary"
          >
            No confident merges found.
          </li>
        </ul>
      </div>

      <div>
        <h4 class="text-sm font-semibold text-ink">Link by hand ({{ stillUnmatched.length }})</h4>
        <p class="mt-1 text-xs text-ink-tertiary">
          Drivers with no confident Samsara match — pick the right person to merge into.
        </p>
        <ul class="mt-2 space-y-2">
          <li v-for="u in stillUnmatched" :key="u.id" class="flex items-center gap-2 text-sm">
            <span class="min-w-0 flex-1 truncate">{{ u.full_name }}</span>
            <AppSelect
              v-model="linkTarget[u.id]"
              class="max-w-64"
              placeholder="Select Samsara driver…"
              :options="samsaraCandidates.map((candidate) => ({ value: candidate.id, label: candidate.full_name }))"
            />
            <BaseButton size="sm" :disabled="!linkTarget[u.id]" @click="linkDriver(u.id)"
              >Link</BaseButton
            >
          </li>
          <li v-if="!stillUnmatched.length" class="text-sm text-ink-tertiary">
            Nothing left to link.
          </li>
        </ul>
      </div>
    </div>
  </SlideOver>
</template>
