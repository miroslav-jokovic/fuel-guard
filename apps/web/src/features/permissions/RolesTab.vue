<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  USER_ROLE_LABELS,
  type AppSection,
  type SectionAccess,
  type UserRole,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppTabs, type TabItem } from "@silvicom/ui";
import { useModulesQuery } from "@/composables/useModules";
import { useToastStore } from "@/stores/toast";
import AccessCard from "./AccessCard.vue";
import RoleAccessStrip from "./RoleAccessStrip.vue";
import ScreenRows from "./ScreenRows.vue";
import SectionRows, { type SectionRowModel } from "./SectionRows.vue";
import SidebarPreview from "./SidebarPreview.vue";
import { SECTION_CAVEATS, SECTION_LABELS } from "./labels";
import { SECTION_SAVE_NOTE, SURFACE_SAVE_NOTE, accessLabel, sectionReaches } from "./layers";
import { CHANGED_TAG, groupScreens, needLabel } from "./rows";
import {
  useSectionAccessQuery,
  useSetRoleSection,
  useSetRoleSurface,
  useSurfaceAccessQuery,
} from "./usePermissions";

/**
 * The Roles tab: what a whole role may do, and which screens it may open (S6, P5).
 *
 * ── ONE ROLE AT A TIME, NOT A MATRIX ──────────────────────────────────────────────────────────
 * The first version drew the 7 × 11 matrix as a table of 77 selects and the 28 × 7 screen grid as
 * 196 checkboxes. An admin does not think in that shape — they think "what can a dispatcher do" —
 * and neither did a phone: the table was ~1,100 px wide. So the tab is a master–detail: a rail of
 * the seven editable roles (a scrolling strip below `lg`), and one column of answers for the one
 * picked. The data is unchanged; `GET /api/section-access` and `GET /api/surface-access` still
 * arrive whole, and the rail's "2 custom" counts are read from them.
 *
 * ⚠ Two saves, two different sentences, and the page must not average them. A SECTION change travels
 * in the member's sign-in token and lands within the hour `jwt_expiry = 3600` allows (D-PERM6); a
 * SCREEN change is served by `/api/me` and lands on their next page load (D-SURF4). The difference is
 * measured rather than incidental — RLS reads sections per row and nothing in RLS reads a surface —
 * so each card's header and each toast say what is actually true of the thing that was just saved.
 */
const toast = useToastStore();
const modules = useModulesQuery();
const sections = useSectionAccessQuery();
const surfaces = useSurfaceAccessQuery();
const setSection = useSetRoleSection();
const setSurface = useSetRoleSurface();

const busy = computed(() => setSection.isPending.value || setSurface.isPending.value);

// ── The rail ─────────────────────────────────────────────────────────────────────────────────
const selected = ref<UserRole | null>(null);
watch(
  () => sections.data.value?.editableRoles,
  (roles) => {
    if (selected.value === null && roles && roles.length > 0) selected.value = roles[0]!;
  },
  { immediate: true },
);
const role = computed(() => selected.value);

const customCount = (r: UserRole) =>
  Object.keys(sections.data.value?.overrides[r] ?? {}).length +
  Object.keys(surfaces.data.value?.overrides[r] ?? {}).length;

const railTabs = computed<TabItem[]>(() =>
  (sections.data.value?.editableRoles ?? []).map((r) => {
    const n = customCount(r);
    return { value: r, label: USER_ROLE_LABELS[r], badge: n > 0 ? `${n} custom` : undefined };
  }),
);
const rail = computed({
  get: () => selected.value ?? "",
  set: (v: string) => {
    selected.value = v as UserRole;
  },
});
/** Each role's eleven answers, in the matrix's section order, for the rail's at-a-glance strip. */
const levelsOf = (r: UserRole): SectionAccess[] =>
  (sections.data.value?.editableSections ?? []).map((s) => current(r, s));

// ── The rows ─────────────────────────────────────────────────────────────────────────────────
const shipped = (r: UserRole, s: AppSection): SectionAccess => sections.data.value?.defaults[r]?.[s] ?? "none";
const current = (r: UserRole, s: AppSection): SectionAccess =>
  sections.data.value?.overrides[r]?.[s] ?? shipped(r, s);

const sectionRows = computed<SectionRowModel[]>(() => {
  const r = role.value;
  const data = sections.data.value;
  if (!r || !data) return [];
  return data.editableSections.map((s) => {
    const changed = data.overrides[r]?.[s] !== undefined;
    return {
      section: s,
      label: SECTION_LABELS[s],
      caveat: SECTION_CAVEATS[s],
      access: current(r, s),
      inherited: false,
      tag: changed ? CHANGED_TAG : undefined,
      reset: changed ? `Reset to ${accessLabel(shipped(r, s))}` : undefined,
    };
  });
});

const screens = computed(() => {
  const r = role.value;
  const data = surfaces.data.value;
  if (!r || !data) return { groups: [], unlisted: [] };
  const claim = sections.data.value?.overrides[r] ?? {};
  return groupScreens(data.surfaces, (s) => {
    const override = data.overrides[r]?.[s.key];
    const reachable = !s.section || !s.level || sectionReaches(r, s.section, s.level, claim);
    return {
      key: s.key,
      label: s.label,
      allowed: override ?? true,
      inherited: false,
      reachable,
      need: needLabel(s),
      tag: override !== undefined ? CHANGED_TAG : undefined,
      reset: override !== undefined ? "Reset" : undefined,
    };
  });
});

const summary = computed(() => {
  const r = role.value;
  if (!r || !sections.data.value) return "";
  const counts = { manage: 0, view: 0, none: 0 };
  for (const s of sections.data.value.editableSections) counts[current(r, s)] += 1;
  const custom = customCount(r);
  const changed = custom > 0 ? ` · ${custom} changed by this organisation` : "";
  return `Manage ${counts.manage} · View ${counts.view} · None ${counts.none}${changed}`;
});

// ── The writes ───────────────────────────────────────────────────────────────────────────────
async function saveSection(v: { section: AppSection; access: SectionAccess }) {
  if (!role.value) return;
  try {
    await setSection.mutateAsync({ role: role.value, ...v });
    toast.success("Access updated", SECTION_SAVE_NOTE);
  } catch (e) {
    toast.error("Could not save that change", (e as Error).message);
  }
}

/** Sending the shipped value IS the reset at this layer: the endpoint compares and deletes (D-PERM4). */
const resetSection = (section: AppSection) =>
  role.value && saveSection({ section, access: shipped(role.value, section) });

async function saveSurface(v: { surfaceKey: string; allowed: boolean }) {
  if (!role.value) return;
  try {
    await setSurface.mutateAsync({ role: role.value, ...v });
    toast.success("Screens updated", SURFACE_SAVE_NOTE);
  } catch (e) {
    toast.error("Could not save that change", (e as Error).message);
  }
}

/** `allowed: true` is inert at the role layer, so writing it is the reset (D-SURF6). */
const resetSurface = (surfaceKey: string) => saveSurface({ surfaceKey, allowed: true });

/**
 * "Reset role" is one write per changed cell, because the API answers one cell at a time and a
 * bulk endpoint would be a second way to write the same rows — with its own audit shape to keep in
 * step. Sections first, then screens; both toasts' sentences apply, so the one shown is the slower.
 */
async function resetRole() {
  const r = role.value;
  if (!r || !sections.data.value) return;
  try {
    for (const section of Object.keys(sections.data.value.overrides[r] ?? {}) as AppSection[]) {
      await setSection.mutateAsync({ role: r, section, access: shipped(r, section) });
    }
    for (const surfaceKey of Object.keys(surfaces.data.value?.overrides[r] ?? {})) {
      await setSurface.mutateAsync({ role: r, surfaceKey, allowed: true });
    }
    toast.success(`${USER_ROLE_LABELS[r]} reset to defaults`, SECTION_SAVE_NOTE);
  } catch (e) {
    toast.error("Could not reset that role", (e as Error).message);
  }
}

const previewSections = computed(() => (role.value ? (sections.data.value?.overrides[role.value] ?? {}) : {}));
const previewSurfaces = computed(() => (role.value ? (surfaces.data.value?.overrides[role.value] ?? {}) : {}));
</script>

<template>
  <p v-if="sections.isPending.value || surfaces.isPending.value" class="text-sm text-ink-muted">
    Loading permissions…
  </p>
  <p v-else-if="!sections.data.value || !surfaces.data.value" class="text-sm text-ink-muted">
    Could not load permissions. Reload the page to try again.
  </p>
  <div v-else class="grid grid-cols-1 gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
    <div class="lg:hidden">
      <AppTabs v-model="rail" :tabs="railTabs" label="Roles" scrollable />
    </div>
    <div class="hidden lg:block">
      <AppTabs v-model="rail" :tabs="railTabs" label="Roles" orientation="vertical" id-prefix="role">
        <template #tab="{ tab }">
          <span class="flex min-w-0 flex-col gap-1">
            <span class="truncate">{{ tab.label }}</span>
            <RoleAccessStrip :levels="levelsOf(tab.value as UserRole)" />
          </span>
          <span v-if="tab.badge !== undefined" class="shrink-0 text-xs text-ink-tertiary">{{ tab.badge }}</span>
        </template>
      </AppTabs>
      <p class="mt-4 px-3 text-xs text-ink-muted">
        Admin, Driver and the Admin section are not listed: they are not an organisation's to
        change. Admin carries user management, so granting it sideways would be a way around every
        other setting on this page.
      </p>
    </div>

    <div v-if="role" :id="`role-panel-${role}`" role="tabpanel" :aria-labelledby="`role-tab-${role}`" class="space-y-5">
      <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h2 class="text-lg font-semibold text-ink">{{ USER_ROLE_LABELS[role] }}</h2>
          <p class="mt-0.5 text-sm text-ink-muted">{{ summary }}</p>
        </div>
        <BaseButton v-if="customCount(role) > 0" variant="ghost" size="sm" :disabled="busy" @click="resetRole">
          Reset role to defaults
        </BaseButton>
      </div>

      <div class="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <div class="space-y-5">
          <AccessCard
            title="Sections"
            description="What the database hands over. Manage is view and edit; None hides the section entirely."
            note="Applies within an hour, when their sign-in refreshes."
          >
            <SectionRows :rows="sectionRows" :disabled="busy" @set="saveSection" @reset="resetSection" />
          </AccessCard>

          <AccessCard
            title="Screens"
            description="Which pages appear in the sidebar and open by address. A screen can only narrow its section, never widen it."
            note="Applies the next time they load a page."
          >
            <ScreenRows :groups="screens.groups" :disabled="busy" @set="saveSurface" @reset="resetSurface" />
            <p v-if="screens.unlisted.length > 0" class="border-t border-edge-subtle px-5 py-3 text-xs text-ink-muted">
              Not listed: {{ screens.unlisted.join(", ") }} — this role holds none of their sections.
              Widen a section above and its screens appear here.
            </p>
          </AccessCard>
        </div>

        <aside class="xl:sticky xl:top-6" aria-label="What this role sees">
          <h3 class="mb-2 text-sm font-semibold text-ink">Their sidebar</h3>
          <SidebarPreview
            :role="role"
            :sections="previewSections"
            :surfaces="previewSurfaces"
            :modules="modules.data.value ?? null"
          />
        </aside>
      </div>

      <p class="text-xs text-ink-muted lg:hidden">
        Admin, Driver and the Admin section are not listed: they are not an organisation's to change.
      </p>
    </div>
  </div>
</template>
