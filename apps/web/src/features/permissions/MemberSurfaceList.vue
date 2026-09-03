<script setup lang="ts">
import { computed } from "vue";
import { SURFACE_GROUPS, type SectionClaim, type UserRole } from "@silvicom/shared";
import { AppBadge, AppSelect, AppTable } from "@silvicom/ui";
import { LAYER_LABELS, sectionReaches, surfaceCell } from "./layers";
import { SECTION_LABELS } from "./labels";
import type { MemberSurfaceAccess, SurfaceCatalogueEntry } from "./usePermissions";

/**
 * One person's SCREENS (S4, D-SURF7) — the half of the owner's request that named a page rather
 * than a table: "Technician shop should see only annual inspection page and nothing else."
 *
 * Three values for the same reason the section list has three (`access: null` there, `allowed: null`
 * here): at this layer BOTH booleans are real answers. `Hidden` takes a screen from one person their
 * role keeps; `Allowed` gives one back to a person whose role has lost it — which is what the
 * boolean column exists for. "Unchanged" therefore cannot be either of them, and is the absence of a
 * row.
 *
 * ⚠ A screen inside a section this person does not hold is not offered, because a surface may only
 * narrow within its section (D-SURF2). The section is editable on the card above, which is where
 * widening belongs — there it is visible as a change to what the database allows rather than as a
 * menu setting.
 */
const props = defineProps<{
  data: MemberSurfaceAccess;
  /** Their resolved section answers, so reachability is asked against what THEY hold. */
  sections: SectionClaim;
  role: UserRole | null;
  editable: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{ set: [value: { surfaceKey: string; allowed: boolean | null }] }>();

const INHERIT = "__inherit__";
const groupLabels = new Map(SURFACE_GROUPS.map((g) => [g.key, g.label ?? "General"]));

const reachable = (s: SurfaceCatalogueEntry) =>
  !s.section || !s.level || sectionReaches(props.role, s.section, s.level, props.sections);

const groups = computed(() =>
  SURFACE_GROUPS.map((g) => ({
    key: g.key,
    label: groupLabels.get(g.key)!,
    rows: props.data.surfaces
      .filter((s) => s.group === g.key)
      .map((s) => {
        const roleAnswer = props.data.roleOverrides[s.key] ?? true;
        const cell = surfaceCell(props.data.roleOverrides[s.key], props.data.userOverrides[s.key]);
        return {
          surface: s,
          cell,
          reachable: reachable(s),
          need: s.section ? `${SECTION_LABELS[s.section]} ${s.level === "manage" ? "Manage" : "View"}` : "",
          value: props.data.userOverrides[s.key] === undefined ? INHERIT : String(props.data.userOverrides[s.key]),
          options: [
            { value: INHERIT, label: `Follow their role (${roleAnswer ? "Shown" : "Hidden"})` },
            { value: "true", label: "Shown" },
            { value: "false", label: "Hidden" },
          ],
        };
      }),
  })).filter((g) => g.rows.length > 0),
);

function onSelect(surfaceKey: string, raw: unknown) {
  const value = raw as string;
  emit("set", { surfaceKey, allowed: value === INHERIT ? null : value === "true" });
}
</script>

<template>
  <AppTable class="min-w-full text-sm">
    <thead class="text-ink-muted">
      <tr>
        <th class="py-2 pr-4 text-left font-medium">Screen</th>
        <th class="px-2 py-2 text-left font-medium">In their sidebar</th>
        <th class="px-2 py-2 text-left font-medium">Decided by</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-edge-subtle">
      <template v-for="g in groups" :key="g.key">
        <tr>
          <td colspan="3" class="bg-surface-subtle px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {{ g.label }}
          </td>
        </tr>
        <tr v-for="row in g.rows" :key="row.surface.key">
          <td class="py-2 pr-4 align-top text-ink">{{ row.surface.label }}</td>
          <td class="px-2 py-2 align-top">
            <AppSelect
              v-if="row.reachable"
              class="w-56"
              :model-value="row.value"
              :options="row.options"
              :disabled="busy || !editable"
              :aria-label="`${row.surface.label} visibility`"
              @update:model-value="onSelect(row.surface.key, $event)"
            />
            <span v-else class="text-xs text-ink-tertiary">Needs {{ row.need }}</span>
          </td>
          <td class="px-2 py-2 align-top">
            <AppBadge
              v-if="row.reachable"
              :tone="row.cell.layer === 'user' ? 'brand' : row.cell.layer === 'role' ? 'info' : 'neutral'"
            >
              {{ LAYER_LABELS[row.cell.layer] }}
            </AppBadge>
          </td>
        </tr>
      </template>
    </tbody>
  </AppTable>
</template>
