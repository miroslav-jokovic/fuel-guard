<script setup lang="ts">
import { computed } from "vue";
import {
  SURFACE_GROUPS,
  USER_ROLE_LABELS,
  type SectionOverrides,
  type UserRole,
} from "@silvicom/shared";
import { AppCheckbox, AppTable } from "@silvicom/ui";
import { sectionReaches } from "./layers";
import { SECTION_LABELS } from "./labels";
import type { RoleSurfaceAccess, SurfaceCatalogueEntry } from "./usePermissions";

/**
 * Which SCREENS each role may open (S3, D-SURF1) — the owner's "Technician shop should see only
 * annual inspection page and nothing else", expressed one checkbox at a time.
 *
 * ── A CELL AN ORG DOES NOT HAVE IS NOT A DISABLED CHECKBOX, IT IS AN EXPLANATION ────────────────
 * A surface may only ever NARROW within its section (D-SURF2): an org cannot hand a role a screen
 * whose section it lacks, because the section is what RLS enforces, so the page would either lie or
 * the grant would have to widen the data boundary underneath. Those cells therefore say which
 * section is missing rather than offering a control the API would refuse — and the section is
 * editable one card above, which is where widening belongs and is visible as what it is.
 *
 * The reachability question is asked through `sectionReaches`, which calls the same
 * `callerCanView`/`callerCanManage` the sidebar and the router guard call. This page has no opinion
 * of its own about who can view what.
 */
const props = defineProps<{
  data: RoleSurfaceAccess;
  /** The org's section answers, so a screen inside a section they took away reads as unreachable. */
  sectionOverrides: SectionOverrides;
  busy: boolean;
}>();
const emit = defineEmits<{ set: [value: { role: UserRole; surfaceKey: string; allowed: boolean }] }>();

const GROUP_LABELS = new Map(SURFACE_GROUPS.map((g) => [g.key, g.label ?? "General"]));

const groups = computed(() =>
  SURFACE_GROUPS.map((g) => ({
    key: g.key,
    label: GROUP_LABELS.get(g.key)!,
    surfaces: props.data.surfaces.filter((s) => s.group === g.key),
  })).filter((g) => g.surfaces.length > 0),
);

const roleLabel = (r: UserRole) => USER_ROLE_LABELS[r];

/** `true` unless the org wrote a denial — absence is "unchanged", never "denied" (D-SURF6). */
const allowed = (role: UserRole, key: string) => props.data.overrides[role]?.[key] ?? true;

function reachable(role: UserRole, s: SurfaceCatalogueEntry): boolean {
  if (!s.section || !s.level) return true;
  return sectionReaches(role, s.section, s.level, props.sectionOverrides[role] ?? {});
}

function reason(role: UserRole, s: SurfaceCatalogueEntry): string {
  if (!s.section) return "";
  const need = s.level === "manage" ? "Manage" : "View";
  return `${roleLabel(role)} needs ${SECTION_LABELS[s.section]} ${need} to reach this screen.`;
}
</script>

<template>
  <div>
    <p class="mb-3 text-sm text-ink-muted">
      Unticking a screen removes it from the sidebar and closes the address, for that role. It cannot
      widen anything: a screen inside a section the role does not hold shows why instead of a tick.
      Screens apply the next time the person loads a page.
    </p>

    <div class="overflow-x-auto">
      <AppTable class="min-w-full text-sm">
        <thead class="text-ink-muted">
          <tr>
            <th class="py-2 pr-4 text-left font-medium">Screen</th>
            <th v-for="r in data.editableRoles" :key="r" class="px-2 py-2 text-left font-medium">
              {{ roleLabel(r) }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-edge-subtle">
          <template v-for="g in groups" :key="g.key">
            <tr>
              <td
                :colspan="data.editableRoles.length + 1"
                class="bg-surface-subtle px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted"
              >
                {{ g.label }}
              </td>
            </tr>
            <tr v-for="s in g.surfaces" :key="s.key">
              <td class="py-2 pr-4 text-ink">{{ s.label }}</td>
              <td v-for="r in data.editableRoles" :key="r" class="px-2 py-2">
                <AppCheckbox
                  v-if="reachable(r, s)"
                  :model-value="allowed(r, s.key)"
                  :disabled="busy"
                  :aria-label="`${roleLabel(r)} — ${s.label}`"
                  @update:model-value="emit('set', { role: r, surfaceKey: s.key, allowed: $event })"
                />
                <span v-else class="text-xs text-ink-tertiary" :title="reason(r, s)">No section</span>
              </td>
            </tr>
          </template>
        </tbody>
      </AppTable>
    </div>
  </div>
</template>
