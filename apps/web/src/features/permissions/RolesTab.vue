<script setup lang="ts">
import { computed, ref } from "vue";
import {
  USER_ROLE_LABELS,
  type AppSection,
  type SectionAccess,
  type UserRole,
} from "@silvicom/shared";
import { AppCard as BaseCard, AppSelect } from "@silvicom/ui";
import SettingsSection from "@/components/ui/SettingsSection.vue";
import { useModulesQuery } from "@/composables/useModules";
import { useToastStore } from "@/stores/toast";
import RoleSectionMatrix from "./RoleSectionMatrix.vue";
import RoleSurfaceGrid from "./RoleSurfaceGrid.vue";
import SidebarPreview from "./SidebarPreview.vue";
import { SECTION_SAVE_NOTE, SURFACE_SAVE_NOTE } from "./layers";
import {
  useSectionAccessQuery,
  useSetRoleSection,
  useSetRoleSurface,
  useSurfaceAccessQuery,
} from "./usePermissions";

/**
 * The Roles tab: what a whole role may do, and which screens it may open (S6, P5).
 *
 * ⚠ Two saves, two different sentences, and the page must not average them. A SECTION change travels
 * in the member's sign-in token and lands within the hour `jwt_expiry = 3600` allows (D-PERM6); a
 * SCREEN change is served by `/api/me` and lands on their next page load (D-SURF4). The difference is
 * measured rather than incidental — RLS reads sections per row and nothing in RLS reads a surface —
 * so each toast says what is actually true of the thing that was just saved.
 */
const toast = useToastStore();
const modules = useModulesQuery();
const sections = useSectionAccessQuery();
const surfaces = useSurfaceAccessQuery();
const setSection = useSetRoleSection();
const setSurface = useSetRoleSurface();

const busy = computed(() => setSection.isPending.value || setSurface.isPending.value);

async function saveSection(v: { role: UserRole; section: AppSection; access: SectionAccess }) {
  try {
    await setSection.mutateAsync(v);
    toast.success("Access updated", SECTION_SAVE_NOTE);
  } catch (e) {
    toast.error("Could not save that change", (e as Error).message);
  }
}

async function saveSurface(v: { role: UserRole; surfaceKey: string; allowed: boolean }) {
  try {
    await setSurface.mutateAsync(v);
    toast.success("Screens updated", SURFACE_SAVE_NOTE);
  } catch (e) {
    toast.error("Could not save that change", (e as Error).message);
  }
}

/**
 * "Reset row" is one write per changed cell, because the API answers one cell at a time and a
 * bulk endpoint would be a second way to write the same rows — with its own audit shape to keep in
 * step. Sending the shipped value IS the reset at this layer: the endpoint compares it to the
 * matrix and deletes the row (D-PERM4).
 */
async function resetRole(role: UserRole) {
  const data = sections.data.value;
  if (!data) return;
  const changed = Object.keys(data.overrides[role] ?? {}) as AppSection[];
  try {
    for (const section of changed) {
      await setSection.mutateAsync({ role, section, access: data.defaults[role]![section]! });
    }
    toast.success(`${USER_ROLE_LABELS[role]} reset to defaults`, SECTION_SAVE_NOTE);
  } catch (e) {
    toast.error("Could not reset that role", (e as Error).message);
  }
}

// ── The preview ───────────────────────────────────────────────────────────────────────────────
const previewRole = ref<UserRole | null>(null);
const roleOptions = computed(() =>
  (sections.data.value?.editableRoles ?? []).map((r) => ({ value: r, label: USER_ROLE_LABELS[r] })),
);
const previewSections = computed(() =>
  previewRole.value ? (sections.data.value?.overrides[previewRole.value] ?? {}) : {},
);
const previewSurfaces = computed(() =>
  previewRole.value ? (surfaces.data.value?.overrides[previewRole.value] ?? {}) : {},
);
</script>

<template>
  <div class="space-y-8">
    <SettingsSection title="What each role can reach">
      <BaseCard as="section">
        <p v-if="sections.isPending.value" class="text-sm text-ink-muted">Loading permissions…</p>
        <p v-else-if="!sections.data.value" class="text-sm text-ink-muted">
          Could not load permissions. Reload the page to try again.
        </p>
        <RoleSectionMatrix
          v-else
          :data="sections.data.value"
          :busy="busy"
          @set="saveSection"
          @reset-role="resetRole"
        />
      </BaseCard>
    </SettingsSection>

    <SettingsSection title="Which screens each role opens">
      <BaseCard as="section">
        <p v-if="surfaces.isPending.value" class="text-sm text-ink-muted">Loading screens…</p>
        <p v-else-if="!surfaces.data.value" class="text-sm text-ink-muted">
          Could not load screens. Reload the page to try again.
        </p>
        <RoleSurfaceGrid
          v-else
          :data="surfaces.data.value"
          :section-overrides="sections.data.value?.overrides ?? {}"
          :busy="busy"
          @set="saveSurface"
        />
      </BaseCard>
    </SettingsSection>

    <SettingsSection title="What a role sees">
      <BaseCard as="section">
        <div class="max-w-md">
          <AppSelect
            v-model="previewRole"
            :options="roleOptions"
            placeholder="Pick a role"
            aria-label="Preview a role's sidebar"
          />
        </div>
        <div class="mt-4">
          <SidebarPreview
            :role="previewRole"
            :sections="previewSections"
            :surfaces="previewSurfaces"
            :modules="modules.data.value ?? null"
          />
        </div>
      </BaseCard>
    </SettingsSection>
  </div>
</template>
