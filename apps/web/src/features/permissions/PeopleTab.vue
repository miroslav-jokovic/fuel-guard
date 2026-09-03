<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  USER_ROLE_LABELS,
  isEditableRole,
  type AppSection,
  type SectionAccess,
  type UserRole,
} from "@silvicom/shared";
import { AppCallout, AppCard as BaseCard, AppSelect } from "@silvicom/ui";
import SettingsSection from "@/components/ui/SettingsSection.vue";
import { useModulesQuery } from "@/composables/useModules";
import { useToastStore } from "@/stores/toast";
import MemberSectionList from "./MemberSectionList.vue";
import MemberSurfaceList from "./MemberSurfaceList.vue";
import SidebarPreview from "./SidebarPreview.vue";
import {
  SECTION_SAVE_NOTE,
  SURFACE_SAVE_NOTE,
  mergedSectionClaim,
  mergedSurfaceClaim,
} from "./layers";
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
 */
const toast = useToastStore();
const modules = useModulesQuery();
const members = useMembersQuery();
const selected = ref<string | null>(null);
const memberSections = useMemberSectionAccessQuery(selected);
const memberSurfaces = useMemberSurfaceAccessQuery(selected);
const setSection = useSetMemberSection();
const setSurface = useSetMemberSurface();

const busy = computed(() => setSection.isPending.value || setSurface.isPending.value);

const memberOptions = computed(() =>
  (members.data.value ?? []).map((m) => ({
    value: m.userId,
    label: `${m.email ?? m.userId} — ${USER_ROLE_LABELS[m.role as UserRole]}`,
  })),
);
watch(
  () => members.data.value,
  (list) => {
    if (selected.value === null && list && list.length > 0) selected.value = list[0]!.userId;
  },
  { immediate: true },
);

const member = computed(() => (members.data.value ?? []).find((m) => m.userId === selected.value) ?? null);
const role = computed<UserRole | null>(() => (member.value?.role as UserRole | undefined) ?? null);
/**
 * ⚠ An `admin` or a `driver` gets no controls (D-PERM7/D-PERM8), and the page says why rather than
 * rendering selects the API would refuse. The read still works — an admin has to be able to SEE what
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
</script>

<template>
  <div class="space-y-8">
    <BaseCard as="section">
      <div class="max-w-md">
        <AppSelect
          v-model="selected"
          :options="memberOptions"
          :disabled="members.isPending.value"
          placeholder="Pick a member"
          aria-label="Member"
        />
      </div>
      <p v-if="members.isPending.value" class="mt-3 text-sm text-ink-muted">Loading members…</p>
      <p v-else-if="memberOptions.length === 0" class="mt-3 text-sm text-ink-muted">
        No members yet. Invite one from the Users page.
      </p>
      <AppCallout v-else-if="!editable" tone="info" class="mt-4">
        {{ member ? USER_ROLE_LABELS[member.role as UserRole] : "This" }} accounts cannot be given a
        custom setup. An admin holds every section by design, and a driver uses the driver app rather
        than this one. Change their role on the Users page to give them one.
      </AppCallout>
    </BaseCard>

    <template v-if="member">
      <SettingsSection title="What they can work with">
        <BaseCard as="section">
          <p class="mb-3 text-sm text-ink-muted">
            Their data access. Leave a section on
            <span class="font-medium text-ink">Follow their role</span> and it keeps tracking the
            Roles tab; give it its own answer and it stays with the person even if their role changes.
          </p>
          <p v-if="memberSections.isPending.value" class="text-sm text-ink-muted">Loading…</p>
          <MemberSectionList
            v-else-if="memberSections.data.value"
            :data="memberSections.data.value"
            :editable="editable"
            :busy="busy"
            @set="saveSection"
          />
          <p v-else class="text-sm text-ink-muted">
            Could not load their access. Reload the page to try again.
          </p>
        </BaseCard>
      </SettingsSection>

      <SettingsSection title="Which screens they see">
        <BaseCard as="section">
          <p v-if="memberSurfaces.isPending.value" class="text-sm text-ink-muted">Loading…</p>
          <MemberSurfaceList
            v-else-if="memberSurfaces.data.value"
            :data="memberSurfaces.data.value"
            :sections="sectionClaim"
            :role="role"
            :editable="editable"
            :busy="busy"
            @set="saveSurface"
          />
          <p v-else class="text-sm text-ink-muted">
            Could not load their screens. Reload the page to try again.
          </p>
        </BaseCard>
      </SettingsSection>

      <SettingsSection title="What they see">
        <BaseCard as="section">
          <SidebarPreview
            :role="role"
            :sections="sectionClaim"
            :surfaces="surfaceClaim"
            :modules="modules.data.value ?? null"
          />
        </BaseCard>
      </SettingsSection>
    </template>
  </div>
</template>
