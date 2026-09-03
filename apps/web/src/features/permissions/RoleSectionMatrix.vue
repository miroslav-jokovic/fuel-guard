<script setup lang="ts">
import { computed } from "vue";
import {
  USER_ROLE_LABELS,
  type AppSection,
  type SectionAccess,
  type UserRole,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppSelect, AppTable } from "@silvicom/ui";
import { SECTION_CAVEATS, SECTION_LABELS } from "./labels";
import type { RoleSectionAccess } from "./usePermissions";

/**
 * The 7 × 11 matrix an organisation may re-answer (EDITABLE-PERMISSIONS-PLAN.md P5, D-PERM1).
 *
 * ── WHY SEVEN ROWS AND ELEVEN COLUMNS AND NOT NINE BY TWELVE ────────────────────────────────────
 * `admin` and `driver` are not rows, and `admin` is not a column, because none of the three is an
 * org's to move (D-PERM7/D-PERM8): the admin role carries user management, so granting it sideways
 * would be a privilege-escalation path the product deliberately does not have, and an org that
 * locked itself out of its own permissions page would have no way back in. They are stated in words
 * below the table rather than rendered as disabled controls — a greyed row invites the question
 * "why can't I", and the answer is a ruling, not a permission.
 *
 * The shipped defaults arrive with the overrides from `GET /api/section-access` (D-PERM4), so
 * nothing here reconstructs the matrix; every cell that departs from its default says what the
 * default was, which is also what "reset" would restore.
 */
const props = defineProps<{ data: RoleSectionAccess; busy: boolean }>();
const emit = defineEmits<{
  set: [value: { role: UserRole; section: AppSection; access: SectionAccess }];
  resetRole: [role: UserRole];
}>();

const ACCESS_OPTIONS: Array<{ value: SectionAccess; label: string }> = [
  { value: "none", label: "None" },
  { value: "view", label: "View" },
  { value: "manage", label: "Manage" },
];
const accessLabel = (a: SectionAccess) => ACCESS_OPTIONS.find((o) => o.value === a)!.label;

const shipped = (role: UserRole, section: AppSection): SectionAccess =>
  props.data.defaults[role]?.[section] ?? "none";
const current = (role: UserRole, section: AppSection): SectionAccess =>
  props.data.overrides[role]?.[section] ?? shipped(role, section);
const changed = (role: UserRole, section: AppSection) =>
  props.data.overrides[role]?.[section] !== undefined;

const rows = computed(() =>
  props.data.editableRoles.map((role) => ({
    role,
    label: USER_ROLE_LABELS[role],
    hasOverrides: Object.keys(props.data.overrides[role] ?? {}).length > 0,
  })),
);

function onSelect(role: UserRole, section: AppSection, value: unknown) {
  const access = value as SectionAccess;
  if (access === current(role, section)) return;
  emit("set", { role, section, access });
}
</script>

<template>
  <div>
    <p class="mb-3 text-sm text-ink-muted">
      <span class="font-medium text-ink">Manage</span> means view and edit, View is read-only, None
      hides the section entirely. A change here decides what the database itself allows, so it
      applies to a member within an hour, when their sign-in refreshes.
    </p>

    <div class="overflow-x-auto">
      <AppTable class="min-w-full text-sm">
        <thead class="text-ink-muted">
          <tr>
            <th class="py-2 pr-4 text-left font-medium">Role</th>
            <th
              v-for="s in data.editableSections"
              :key="s"
              class="px-2 py-2 text-left font-medium"
              :title="SECTION_CAVEATS[s]"
            >
              {{ SECTION_LABELS[s] }}<span v-if="SECTION_CAVEATS[s]" aria-hidden="true"> *</span>
            </th>
            <th class="px-2 py-2 text-left font-medium">Reset</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-edge-subtle">
          <tr v-for="row in rows" :key="row.role">
            <td class="py-2 pr-4 align-top font-medium text-ink">{{ row.label }}</td>
            <td v-for="s in data.editableSections" :key="s" class="px-2 py-2 align-top">
              <AppSelect
                class="w-28"
                :model-value="current(row.role, s)"
                :options="ACCESS_OPTIONS"
                :disabled="busy"
                :aria-label="`${row.label} — ${SECTION_LABELS[s]}`"
                @update:model-value="onSelect(row.role, s, $event)"
              />
              <p v-if="changed(row.role, s)" class="mt-1 text-2xs text-ink-muted">
                Default: {{ accessLabel(shipped(row.role, s)) }}
              </p>
            </td>
            <td class="px-2 py-2 align-top">
              <BaseButton
                v-if="row.hasOverrides"
                size="sm"
                variant="ghost"
                :disabled="busy"
                @click="emit('resetRole', row.role)"
              >
                Reset row
              </BaseButton>
            </td>
          </tr>
        </tbody>
      </AppTable>
    </div>

    <p v-for="s in data.editableSections.filter((x) => SECTION_CAVEATS[x])" :key="s" class="mt-3 text-xs text-ink-muted">
      <span class="font-medium">{{ SECTION_LABELS[s] }}*</span> {{ SECTION_CAVEATS[s] }}
    </p>
    <p class="mt-3 text-xs text-ink-muted">
      The Admin role, the Driver role and the Admin section are not listed because they are not an
      organisation's to change. Admin carries user management, so granting it sideways would be a way
      around every other setting on this page.
    </p>
  </div>
</template>
