<script setup lang="ts">
import { computed } from "vue";
import type { EditablePermissionKey, UserRole } from "@silvicom/shared";
import { AppBadge, AppButton as BaseButton, AppSwitch, QueryState } from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import AccessCard from "./AccessCard.vue";
import { CHANGED_TAG } from "./rows";
import { useNamedPermissionsQuery, useSetNamedPermission } from "./useNamedPermissions";

/**
 * One role's NAMED permissions (HIRING-WORKFLOW-AUDIT-2026-10-31 §15.1, owner ruling Q-WF4b): switches
 * that are neither a section nor a screen — who may open an applicant's SSN-card and passport
 * pictures, and (2026-11-09) who may close an application. Each row reads the catalogue the API sends, says "Changed" when the carrier moved it off its
 * shipped value, and resets to that value; nothing here holds a default of its own (D-PERM4).
 *
 * A change applies on the next request: the API reads the switch per request, not from the sign-in
 * token (D-IDP3) — so this card's note differs from the Sections card's on purpose.
 */
const props = defineProps<{
  role: UserRole;
  holdForStepUp: (error: unknown, retry: () => Promise<void>) => boolean;
}>();

const toast = useToastStore();
const named = useNamedPermissionsQuery();
const setNamed = useSetNamedPermission();

const rows = computed(() => {
  const data = named.data.value;
  if (!data) return [];
  return data.permissions.map((p) => {
    const stored = data.grants[props.role]?.[p.key];
    const shipped = p.shippedRoles.includes(props.role);
    return { key: p.key, label: p.label, description: p.description, allowed: stored ?? shipped, changed: stored !== undefined, shipped };
  });
});

async function save(permission: EditablePermissionKey, allowed: boolean | null) {
  try {
    await setNamed.mutateAsync({ role: props.role, permission, allowed });
    toast.success("Permission updated", "Applies the next time they open a page.");
  } catch (e) {
    if (props.holdForStepUp(e, () => save(permission, allowed))) return;
    toast.error("Could not save that change", (e as Error).message);
  }
}
</script>

<template>
  <AccessCard
    title="Other permissions"
    description="Permissions that are not a page: single acts and papers this role may or may not be trusted with."
    note="Applies the next time they open a page."
  >
    <QueryState
      :loading="named.isPending.value"
      :error="named.error.value"
      :retrying="named.isFetching.value"
      loading-text="Loading…"
      error-text="Could not load these permissions."
      @retry="named.refetch()"
    >
      <ul class="divide-y divide-edge-subtle">
        <li v-for="row in rows" :key="row.key" class="flex min-h-12 items-center justify-between gap-x-4 px-5 py-3">
          <div class="min-w-0">
            <p class="text-sm text-ink">{{ row.label }}</p>
            <p class="mt-0.5 text-xs text-ink-muted">{{ row.description }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-x-3">
            <BaseButton v-if="row.changed" variant="link" :disabled="setNamed.isPending.value" @click="save(row.key, null)">
              Reset to {{ row.shipped ? "on" : "off" }}
            </BaseButton>
            <AppBadge v-if="row.changed" :tone="CHANGED_TAG.tone">{{ CHANGED_TAG.label }}</AppBadge>
            <AppSwitch
              :model-value="row.allowed"
              :label="row.label"
              :disabled="setNamed.isPending.value"
              @update:model-value="save(row.key, $event)"
            />
          </div>
        </li>
      </ul>
    </QueryState>
  </AccessCard>
</template>
