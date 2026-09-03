<script setup lang="ts">
import { computed, ref } from "vue";
import {
  USER_ROLE_LABELS,
  isEditableRole,
  type AppSection,
  type SectionAccess,
  type UserRole,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppCallout, AppCombobox as ComboSelect, AppFormField } from "@silvicom/ui";
import { useModulesQuery } from "@/composables/useModules";
import { useToastStore } from "@/stores/toast";
import AccessCard from "./AccessCard.vue";
import ScreenRows from "./ScreenRows.vue";
import SectionRows, { type SectionRowModel } from "./SectionRows.vue";
import SidebarPreview from "./SidebarPreview.vue";
import { SECTION_CAVEATS, SECTION_LABELS } from "./labels";
import {
  SECTION_SAVE_NOTE,
  SURFACE_SAVE_NOTE,
  accessLabel,
  mergedSectionClaim,
  mergedSurfaceClaim,
  sectionCell,
  sectionReaches,
  surfaceCell,
} from "./layers";
import { groupScreens, layerTag, needLabel } from "./rows";
import {
  useMemberSectionAccessQuery,
  useMemberSurfaceAccessQuery,
  useMembersQuery,
  useSetMemberSection,
  useSetMemberSurface,
} from "./usePermissions";

/**
 * The People tab: one member's own answers, over whatever their role resolves to (S4/S5, D-SURF7).
 *
 * This is the half of the owner's request that the role matrix cannot express — "we should have
 * default setups for each role, but we should then have option for custom setup for each user". A
 * row here belongs to a PERSON: it survives their role changing underneath them, and it is the only
 * layer where "shown" is a real answer rather than a reset, because it can be overriding a denial
 * their role carries.
 *
 * ── THE SAME ROWS AS THE ROLES TAB, WITH A THIRD STATE ────────────────────────────────────────
 * A person's row is either their own (drawn held, tagged Personal, with a "Follow role" link) or it
 * is FOLLOWING — showing the role's answer outlined, tagged with the layer that produced it. Picking
 * any segment on a following row, the outlined one included, writes a personal row; the link writes
 * `null`, which is the absence of a row and what keeps the person tracking a role an admin changes
 * later (the third value the per-user endpoints take, and the reason a two-state control cannot
 * drive them).
 *
 * Nobody is selected until the admin picks someone: an org can have hundreds of members, and the
 * two per-member reads are not fetched speculatively.
 */
const toast = useToastStore();
const modules = useModulesQuery();
const members = useMembersQuery();
const selectedId = ref("");
const selected = computed(() => selectedId.value || null);
const memberSections = useMemberSectionAccessQuery(selected);
const memberSurfaces = useMemberSurfaceAccessQuery(selected);
const setSection = useSetMemberSection();
const setSurface = useSetMemberSurface();

const busy = computed(() => setSection.isPending.value || setSurface.isPending.value);

const memberOptions = computed(() =>
  (members.data.value ?? []).map((m) => ({
    value: m.userId,
    label: `${m.email ?? m.userId} · ${USER_ROLE_LABELS[m.role as UserRole]}`,
  })),
);

const member = computed(() => (members.data.value ?? []).find((m) => m.userId === selected.value) ?? null);
const role = computed<UserRole | null>(() => (member.value?.role as UserRole | undefined) ?? null);
/**
 * ⚠ An `admin` or a `driver` gets no controls (D-PERM7/D-PERM8), and the page says why rather than
 * offering answers the API would refuse. The read still works — an admin has to be able to SEE what
 * a locked member reaches, or the absence of controls looks like a bug.
 */
const editable = computed(() => role.value !== null && isEditableRole(role.value));

/** Their resolved answers — their own over their role's (D-SURF6), which is what the preview draws. */
const sectionClaim = computed(() =>
  memberSections.data.value
    ? mergedSectionClaim(memberSections.data.value.roleOverrides, memberSections.data.value.userOverrides)
    : {},
);
const surfaceClaim = computed(() =>
  memberSurfaces.data.value
    ? mergedSurfaceClaim(memberSurfaces.data.value.roleOverrides, memberSurfaces.data.value.userOverrides)
    : {},
);

const personalCount = computed(
  () =>
    Object.keys(memberSections.data.value?.userOverrides ?? {}).length +
    Object.keys(memberSurfaces.data.value?.userOverrides ?? {}).length,
);

// ── The rows ─────────────────────────────────────────────────────────────────────────────────
const sectionRows = computed<SectionRowModel[]>(() => {
  const data = memberSections.data.value;
  if (!data) return [];
  return data.editableSections.map((s) => {
    const cell = sectionCell(data.shipped[s] ?? "none", data.roleOverrides[s], data.userOverrides[s]);
    const roleAnswer = data.roleOverrides[s] ?? data.shipped[s] ?? "none";
    return {
      section: s,
      label: SECTION_LABELS[s],
      caveat: SECTION_CAVEATS[s],
      access: cell.access,
      inherited: cell.layer !== "user",
      tag: layerTag(cell.layer),
      reset: cell.layer === "user" ? `Follow role (${accessLabel(roleAnswer)})` : undefined,
    };
  });
});

const screens = computed(() => {
  const data = memberSurfaces.data.value;
  if (!data) return { groups: [], unlisted: [] };
  return groupScreens(data.surfaces, (s) => {
    const cell = surfaceCell(data.roleOverrides[s.key], data.userOverrides[s.key]);
    const roleAnswer = data.roleOverrides[s.key] ?? true;
    return {
      key: s.key,
      label: s.label,
      allowed: cell.allowed,
      inherited: cell.layer !== "user",
      reachable: !s.section || !s.level || sectionReaches(role.value, s.section, s.level, sectionClaim.value),
      need: needLabel(s),
      tag: layerTag(cell.layer),
      reset: cell.layer === "user" ? `Follow role (${roleAnswer ? "Shown" : "Hidden"})` : undefined,
    };
  });
});

// ── The writes ───────────────────────────────────────────────────────────────────────────────
async function saveSection(v: { section: AppSection; access: SectionAccess | null }) {
  if (!selected.value) return;
  try {
    await setSection.mutateAsync({ userId: selected.value, ...v });
    toast.success("Access updated", SECTION_SAVE_NOTE);
  } catch (e) {
    toast.error("Could not save that change", (e as Error).message);
  }
}

async function saveSurface(v: { surfaceKey: string; allowed: boolean | null }) {
  if (!selected.value) return;
  try {
    await setSurface.mutateAsync({ userId: selected.value, ...v });
    toast.success("Screens updated", SURFACE_SAVE_NOTE);
  } catch (e) {
    toast.error("Could not save that change", (e as Error).message);
  }
}

/** Every personal row handed back to the role — one `null` per row, for `resetRole`'s reason. */
async function followRoleEverywhere() {
  const id = selected.value;
  if (!id) return;
  try {
    for (const section of Object.keys(memberSections.data.value?.userOverrides ?? {}) as AppSection[]) {
      await setSection.mutateAsync({ userId: id, section, access: null });
    }
    for (const surfaceKey of Object.keys(memberSurfaces.data.value?.userOverrides ?? {})) {
      await setSurface.mutateAsync({ userId: id, surfaceKey, allowed: null });
    }
    toast.success("Following their role everywhere", SECTION_SAVE_NOTE);
  } catch (e) {
    toast.error("Could not reset that person", (e as Error).message);
  }
}
</script>

<template>
  <div class="space-y-5">
    <AppFormField label="Member" class="max-w-md">
      <ComboSelect
        v-model="selectedId"
        :options="memberOptions"
        :disabled="members.isPending.value"
        placeholder="Search by email or role"
        empty-text="No member matches. Invite one from the Users page."
      />
    </AppFormField>

    <p v-if="!member" class="text-sm text-ink-muted">
      Pick a member to see what they reach, and to change it for them alone.
    </p>

    <template v-else>
      <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div class="min-w-0">
          <h2 class="truncate text-lg font-semibold text-ink">{{ member.email ?? member.userId }}</h2>
          <p class="mt-0.5 text-sm text-ink-muted">
            {{ USER_ROLE_LABELS[member.role as UserRole] }}
            <template v-if="editable">
              · {{ personalCount > 0 ? `follows the role except in ${personalCount} places` : "follows the role everywhere" }}
            </template>
          </p>
        </div>
        <BaseButton v-if="personalCount > 0" variant="ghost" size="sm" :disabled="busy" @click="followRoleEverywhere">
          Follow role everywhere
        </BaseButton>
      </div>

      <AppCallout v-if="!editable" tone="info">
        {{ USER_ROLE_LABELS[member.role as UserRole] }} accounts cannot be given a custom setup. An
        admin holds every section by design, and a driver uses the driver app rather than this one.
        Change their role on the Users page to give them one.
      </AppCallout>

      <div class="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <div class="space-y-5">
          <AccessCard
            title="Sections"
            description="Outlined rows follow their role. Pick a value to give this person their own answer."
            note="Applies within an hour, when their sign-in refreshes."
          >
            <p v-if="memberSections.isPending.value" class="px-5 py-4 text-sm text-ink-muted">Loading…</p>
            <SectionRows
              v-else-if="memberSections.data.value"
              :rows="sectionRows"
              :disabled="busy || !editable"
              @set="saveSection"
              @reset="(section) => saveSection({ section, access: null })"
            />
            <p v-else class="px-5 py-4 text-sm text-ink-muted">
              Could not load their access. Reload the page to try again.
            </p>
          </AccessCard>

          <AccessCard
            title="Screens"
            description="Which pages this person sees. A screen can only narrow a section they hold."
            note="Applies the next time they load a page."
          >
            <p v-if="memberSurfaces.isPending.value" class="px-5 py-4 text-sm text-ink-muted">Loading…</p>
            <template v-else-if="memberSurfaces.data.value">
              <ScreenRows
                :groups="screens.groups"
                :disabled="busy || !editable"
                @set="saveSurface"
                @reset="(surfaceKey) => saveSurface({ surfaceKey, allowed: null })"
              />
              <p v-if="screens.unlisted.length > 0" class="border-t border-edge-subtle px-5 py-3 text-xs text-ink-muted">
                Not listed: {{ screens.unlisted.join(", ") }} — they hold none of those sections.
              </p>
            </template>
            <p v-else class="px-5 py-4 text-sm text-ink-muted">
              Could not load their screens. Reload the page to try again.
            </p>
          </AccessCard>
        </div>

        <aside class="xl:sticky xl:top-6" aria-label="What this person sees">
          <h3 class="mb-2 text-sm font-semibold text-ink">Their sidebar</h3>
          <SidebarPreview
            :role="role"
            :sections="sectionClaim"
            :surfaces="surfaceClaim"
            :modules="modules.data.value ?? null"
          />
        </aside>
      </div>
    </template>
  </div>
</template>
