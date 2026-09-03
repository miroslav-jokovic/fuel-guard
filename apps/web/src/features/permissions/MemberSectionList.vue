<script setup lang="ts">
import { computed } from "vue";
import type { AppSection, SectionAccess } from "@silvicom/shared";
import { AppBadge, AppSelect, AppTable } from "@silvicom/ui";
import { LAYER_LABELS, sectionCell } from "./layers";
import { SECTION_CAVEATS, SECTION_LABELS } from "./labels";
import type { MemberSectionAccess } from "./usePermissions";

/**
 * One person's DATA access, section by section (S5, D-SURF7).
 *
 * ── THE CONTROL HAS THREE VALUES, NOT THREE-PLUS-A-BUTTON ───────────────────────────────────────
 * ⚠ "Inherit" is a real wire value here — `access: null` — and not a reset that writes today's
 * answer back. At the role layer a reset IS expressible as a value, because the shipped matrix is
 * something the endpoint can compare against. A PERSON has no shipped default: their fallback is
 * whatever their ROLE resolves to, which an admin can change afterwards on the Roles tab. Storing
 * today's role answer as though the person had chosen it would freeze it and stop tracking the role
 * — so "inherit" is the absence of a row, and the select offers it as its own option.
 *
 * Each row says which of the three layers answered (D-SURF6), because "View" alone cannot tell an
 * admin whether clearing this row would change anything.
 */
const props = defineProps<{ data: MemberSectionAccess; editable: boolean; busy: boolean }>();
const emit = defineEmits<{ set: [value: { section: AppSection; access: SectionAccess | null }] }>();

const ACCESS_LABELS: Record<SectionAccess, string> = { none: "None", view: "View", manage: "Manage" };
const INHERIT = "__inherit__";

const rows = computed(() =>
  props.data.editableSections.map((section) => {
    const roleAnswer = props.data.roleOverrides[section] ?? props.data.shipped[section] ?? "none";
    const cell = sectionCell(
      props.data.shipped[section] ?? "none",
      props.data.roleOverrides[section],
      props.data.userOverrides[section],
    );
    return {
      section,
      label: SECTION_LABELS[section],
      caveat: SECTION_CAVEATS[section],
      cell,
      value: props.data.userOverrides[section] ?? INHERIT,
      options: [
        { value: INHERIT, label: `Follow their role (${ACCESS_LABELS[roleAnswer]})` },
        { value: "none", label: "None" },
        { value: "view", label: "View" },
        { value: "manage", label: "Manage" },
      ],
    };
  }),
);

function onSelect(section: AppSection, raw: unknown) {
  const value = raw as string;
  emit("set", { section, access: value === INHERIT ? null : (value as SectionAccess) });
}
</script>

<template>
  <AppTable class="min-w-full text-sm">
    <thead class="text-ink-muted">
      <tr>
        <th class="py-2 pr-4 text-left font-medium">Section</th>
        <th class="px-2 py-2 text-left font-medium">Access</th>
        <th class="px-2 py-2 text-left font-medium">Decided by</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-edge-subtle">
      <tr v-for="row in rows" :key="row.section">
        <td class="py-2 pr-4 align-top text-ink">
          {{ row.label }}
          <p v-if="row.caveat" class="text-2xs text-ink-muted">{{ row.caveat }}</p>
        </td>
        <td class="px-2 py-2 align-top">
          <AppSelect
            class="w-56"
            :model-value="row.value"
            :options="row.options"
            :disabled="busy || !editable"
            :aria-label="`${row.label} access`"
            @update:model-value="onSelect(row.section, $event)"
          />
        </td>
        <td class="px-2 py-2 align-top">
          <AppBadge :tone="row.cell.layer === 'user' ? 'brand' : row.cell.layer === 'role' ? 'info' : 'neutral'">
            {{ LAYER_LABELS[row.cell.layer] }}
          </AppBadge>
        </td>
      </tr>
    </tbody>
  </AppTable>
</template>
