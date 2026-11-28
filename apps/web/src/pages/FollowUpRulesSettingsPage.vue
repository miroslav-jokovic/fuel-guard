<script setup lang="ts">
import { computed, ref } from "vue";
import { FOLLOW_UP_CATEGORY_LABELS, type FollowUpRuleView } from "@silvicom/shared";
import { AppBadge, AppButton, AppCallout, DataTable, QueryState, type DataTableColumn } from "@silvicom/ui";
import KebabMenu from "@/components/KebabMenu.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import { useToastStore } from "@/stores/toast";
import { useFollowUpRulesQuery, useResetFollowUpRule, useSaveFollowUpRule } from "@/features/followUps/useFollowUps";
import FollowUpRuleDrawer from "@/features/followUps/FollowUpRuleDrawer.vue";
import { ruleCountText, SEVERITY_BADGE } from "@/features/followUps/followUpRows";

/**
 * Settings › Follow-up rules (WARNING-DESK-PLAN D-WD10; owner ruling 2026-11-26: only an admin sets them).
 * Which Samsara warnings open a follow-up, at how many times in how many days, in which category and how
 * urgent. The fixed kinds, then every alert configuration Samsara has, each with the default derived from
 * its trigger — a configuration added in Samsara tomorrow appears here with nothing to code. Only a change
 * is stored; "Reset to default" removes it. Every save is on the Audit page.
 *
 * A row opens its rule in the drawer; Turn on/off, Change and Reset sit in the row's menu (contract §5.6).
 * Until 2026-11-27 they were three equal buttons in a label-less cell — the shape the gate refuses in
 * `#actions`, reached through a cell slot the gate does not read.
 */
const { data, isLoading, isError, error, isFetching, refetch } = useFollowUpRulesQuery();
const save = useSaveFollowUpRule();
const reset = useResetFollowUpRule();
const toast = useToastStore();
const editing = ref<FollowUpRuleView | null>(null);

const fixed = computed(() => (data.value?.rules ?? []).filter((r) => r.source !== "alert"));
const alerts = computed(() => (data.value?.rules ?? []).filter((r) => r.source === "alert"));
const groups = computed(() => [
  { id: "fu-fixed", title: "Samsara warnings", hint: "Tires, engine lamps, defects, safety events and hours of service — read from Samsara directly.", rows: fixed.value },
  {
    id: "fu-alerts",
    title: "Samsara alerts",
    hint: "Every alert set up in Samsara. Each starts on or off by what it watches: idling, and alerts that repeat a warning listed above, start off.",
    rows: alerts.value,
  },
]);

async function toggle(r: FollowUpRuleView, enabled: boolean) {
  try {
    await save.mutateAsync({
      key: r.key,
      rule: { enabled, thresholdCount: r.thresholdCount, windowDays: r.windowDays, minActiveHours: r.minActiveHours, category: r.category, severity: r.severity },
    });
    toast.success(enabled ? `${r.label} is on` : `${r.label} is off`);
  } catch (e) {
    toast.error("Could not save the rule", e instanceof Error ? e.message : undefined);
  }
}

async function onReset(r: FollowUpRuleView) {
  try {
    await reset.mutateAsync(r.key);
    toast.success(`${r.label} is back to its default`);
  } catch (e) {
    toast.error("Could not reset the rule", e instanceof Error ? e.message : undefined);
  }
}

const columns: DataTableColumn[] = [
  { key: "label", label: "Warning", card: "title" },
  { key: "count", label: "Opens a follow-up", card: "sentence" },
  { key: "category", label: "Category", card: "meta" },
  { key: "enabled", label: "On", card: "status" },
];
const ruleOf = (r: unknown) => r as FollowUpRuleView;
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Which Samsara warnings open a follow-up on Maintenance › Follow-ups, and how many times a problem must repeat first." />

    <QueryState
      :loading="isLoading"
      :error="isError ? error : null"
      :retrying="isFetching"
      loading-text="Loading the follow-up rules…"
      error-text="Could not load the follow-up rules."
      @retry="refetch()"
    >
      <template v-if="data">
        <AppCallout v-if="data.samsaraUnavailable" tone="caution" data-test="samsara-unavailable">
          Samsara did not answer, so its alerts are not listed. The rules below still apply; try again in a few minutes to see the alerts.
        </AppCallout>

        <section v-for="group in groups" :key="group.id" :aria-labelledby="group.id" class="space-y-3">
          <div>
            <h2 :id="group.id" class="text-lg font-semibold text-ink">{{ group.title }}</h2>
            <p class="text-sm text-ink-muted">{{ group.hint }}</p>
          </div>
          <!-- ui-adoption: unpaged — 8 fixed kinds and one row per Samsara alert (17 on 2026-11-26). -->
          <DataTable :columns="columns" :rows="group.rows" row-key="key" empty-text="Samsara has no alerts set up." @row-click="editing = ruleOf($event)">
            <template #cell-label="{ row }">
              <span class="font-medium text-ink">{{ ruleOf(row).label }}</span>
              <span v-if="ruleOf(row).samsara && !ruleOf(row).samsara!.isEnabled" class="block text-xs text-ink-tertiary">switched off in Samsara</span>
              <span v-if="ruleOf(row).overridden" class="block text-xs text-ink-tertiary">changed from the default</span>
            </template>
            <template #cell-count="{ row }">
              <span class="text-ink-secondary">{{ ruleCountText(ruleOf(row)) }}</span>
            </template>
            <template #cell-category="{ row }">
              <span class="text-ink-secondary">{{ FOLLOW_UP_CATEGORY_LABELS[ruleOf(row).category] }}</span>
              <AppBadge v-if="SEVERITY_BADGE[ruleOf(row).severity]" class="ml-2" :tone="SEVERITY_BADGE[ruleOf(row).severity]!.tone">{{ SEVERITY_BADGE[ruleOf(row).severity]!.text }}</AppBadge>
            </template>
            <template #cell-enabled="{ row }">
              <AppBadge :tone="ruleOf(row).enabled ? 'success' : 'neutral'">{{ ruleOf(row).enabled ? "On" : "Off" }}</AppBadge>
            </template>
            <template #actions="{ row }">
              <KebabMenu>
                <AppButton class="kebab-item" :disabled="save.isPending.value" @click="toggle(ruleOf(row), !ruleOf(row).enabled)">
                  {{ ruleOf(row).enabled ? "Turn off" : "Turn on" }}
                </AppButton>
                <AppButton class="kebab-item" @click="editing = ruleOf(row)">Change…</AppButton>
                <AppButton v-if="ruleOf(row).overridden" class="kebab-item" :disabled="reset.isPending.value" @click="onReset(ruleOf(row))">Reset to default</AppButton>
              </KebabMenu>
            </template>
          </DataTable>
        </section>
      </template>
    </QueryState>
    <FollowUpRuleDrawer :rule="editing" @close="editing = null" />
  </div>
</template>
