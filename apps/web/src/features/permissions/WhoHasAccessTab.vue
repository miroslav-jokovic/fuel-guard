<script setup lang="ts">
import { computed, ref } from "vue";
import {
  APP_SECTIONS,
  MODULE_LABELS,
  REVIEW_SCREENS,
  SECTION_LABELS,
  USER_ROLE_LABELS,
  reviewMemberName,
  reviewScreenLabel,
  whoHasAccess,
  type ReviewRow,
  type ReviewTarget,
  type UserRole,
} from "@silvicom/shared";
import { AppBadge, AppButton as BaseButton, AppFormField, AppCombobox as ComboSelect } from "@silvicom/ui";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable.vue";
import { useToastStore } from "@/stores/toast";
import AccessCard from "./AccessCard.vue";
import { reviewLayerTag } from "./rows";
import { downloadAccessReview, useAccessReviewQuery } from "./useAccessReview";

/**
 * Who has access — the reverse view (SETTINGS-PERMISSIONS-PLAN.md §4b.2 gap 7, SP10; Q-SET10).
 *
 * Roles and People answer "what can this role / this person do". Neither answers the question an
 * auditor asks first — "who can open Card control" — and before SP10 the only way to answer it was
 * to open every member on People in turn. This tab asks it the other way round: pick a screen or a
 * section, and every office member is listed with their answer and the layer that gave it.
 *
 * ── NOTHING HERE DECIDES ACCESS ───────────────────────────────────────────────────────────────
 * The answers come from `whoHasAccess` (shared), which asks the resolvers the router guard, the
 * sidebar and the API ask. The tags are the People tab's own (Default / Role / Personal) plus the
 * four reasons no cell exists; a row here and that member's row on People cannot disagree.
 *
 * ── THE EXPORT ────────────────────────────────────────────────────────────────────────────────
 * The file is rendered and recorded by the API (`permissions.exported`), not built from the state
 * this tab holds — see `useAccessReview.ts`. Its success toast says it was recorded, because an
 * admin exporting a list of everyone's access should know that act is itself in the audit log.
 */
const toast = useToastStore();
const review = useAccessReviewQuery();
const picked = ref("");
const exporting = ref(false);

const options = computed(() => [
  ...APP_SECTIONS.map((s) => ({ value: `section:${s}`, label: `Section · ${SECTION_LABELS[s]}` })),
  ...REVIEW_SCREENS.map((s) => ({ value: `screen:${s.key}`, label: `Screen · ${reviewScreenLabel(s)}` })),
]);

const target = computed<ReviewTarget | null>(() => {
  const at = picked.value.indexOf(":");
  const kind = picked.value.slice(0, at);
  const key = picked.value.slice(at + 1);
  if (kind === "section") {
    const section = APP_SECTIONS.find((s) => s === key);
    return section ? { kind, section } : null;
  }
  const surface = REVIEW_SCREENS.find((s) => s.key === key);
  return kind === "screen" && surface ? { kind, surface } : null;
});

const title = computed(() => {
  const t = target.value;
  if (!t) return "";
  return t.kind === "section" ? `${SECTION_LABELS[t.section]} section` : reviewScreenLabel(t.surface);
});

/** What the screen sits behind, in the reader's words — the reason a "No section access" row exists. */
const needs = computed(() => {
  const t = target.value;
  if (!t || t.kind === "section") return "";
  const g = t.surface.gate;
  const gate = g.kind === "admin" ? "Admin only" : g.kind === "section" ? `Needs ${SECTION_LABELS[g.section]} · ${g.level === "manage" ? "Manage" : "View"}` : "";
  const mod = t.surface.module ? `the ${MODULE_LABELS[t.surface.module]} module` : "";
  return [gate, mod].filter(Boolean).join(", and ");
});

const result = computed(() => (review.data.value && target.value ? whoHasAccess(review.data.value, target.value) : null));
const lists = computed(() =>
  result.value
    ? [
        { key: "holders", title: "Has access", rows: result.value.holders, empty: "Nobody in this organisation has this." },
        { key: "without", title: "No access", rows: result.value.without, empty: "Every active member has this." },
      ]
    : [],
);
const activeCount = computed(() => (result.value ? result.value.holders.length + result.value.without.length : 0));

const columns: DataTableColumn[] = [
  { key: "name", label: "Name", width: "lg" },
  { key: "role", label: "Role", width: "md" },
  { key: "answer", label: "Answer", width: "sm" },
  { key: "layer", label: "Answered by", width: "md" },
];

const toRows = (rows: ReviewRow[]) =>
  rows.map((r) => ({
    id: r.member.userId,
    name: reviewMemberName(r.member),
    email: r.member.fullName && r.member.email ? r.member.email : null,
    role: USER_ROLE_LABELS[r.member.role as UserRole] ?? r.member.role,
    answer: r.answer.answer,
    layer: reviewLayerTag(r.answer.layer),
  }));

async function exportReview() {
  exporting.value = true;
  try {
    await downloadAccessReview();
    toast.success("Access review exported", "The export is recorded in the audit log.");
  } catch (e) {
    toast.error("Could not export the access review", (e as Error).message);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <AppFormField label="Screen or section" class="w-full max-w-md">
        <ComboSelect
          v-model="picked"
          :options="options"
          :disabled="!review.data.value"
          placeholder="Search for a screen or section"
          empty-text="Nothing matches that name."
        />
      </AppFormField>
      <BaseButton :disabled="exporting" @click="exportReview">
        Export access review (CSV)
      </BaseButton>
    </div>

    <p v-if="review.isPending.value" class="text-sm text-ink-muted">Loading…</p>
    <p v-else-if="!review.data.value" class="text-sm text-ink-muted">
      Could not load who has access. Reload the page to try again.
    </p>
    <p v-else-if="!result" class="text-sm text-ink-muted">
      Pick a screen or section to see everyone who has it, why, and who does not.
    </p>

    <template v-else>
      <div class="min-w-0">
        <h2 class="truncate text-lg font-semibold text-ink">{{ title }}</h2>
        <p class="mt-0.5 text-sm text-ink-muted">
          {{ result.holders.length }} of {{ activeCount }} active members have access.<template v-if="needs"> {{ needs }}.</template>
        </p>
      </div>

      <AccessCard
        v-for="list in lists"
        :key="list.key"
        :title="list.title"
        description="Each answer says which layer gave it: Default, Role or Personal, or the reason nobody can change it."
        :note="`${list.rows.length} ${list.rows.length === 1 ? 'person' : 'people'}`"
      >
        <DataTable :columns="columns" :rows="toRows(list.rows)" :empty-text="list.empty" embedded>
          <template #cell-name="{ row }">
            <span class="font-medium text-ink">{{ row.name }}</span>
            <span v-if="row.email" class="block text-xs text-ink-muted">{{ row.email }}</span>
          </template>
          <template #cell-layer="{ row }">
            <AppBadge :tone="row.layer.tone">{{ row.layer.label }}</AppBadge>
          </template>
        </DataTable>
      </AccessCard>

      <AccessCard
        v-if="result.suspended.length > 0"
        title="Suspended"
        description="No access while suspended. Reinstating them on the Users page restores what is shown here."
        :note="`${result.suspended.length} ${result.suspended.length === 1 ? 'person' : 'people'}`"
      >
        <DataTable :columns="columns" :rows="toRows(result.suspended)" embedded>
          <template #cell-layer="{ row }">
            <AppBadge :tone="row.layer.tone">{{ row.layer.label }}</AppBadge>
          </template>
        </DataTable>
      </AccessCard>
    </template>
  </div>
</template>
