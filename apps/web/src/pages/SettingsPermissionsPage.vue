<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import {
  APP_SECTIONS,
  USER_ROLES,
  USER_ROLE_LABELS,
  sectionAccess,
  type AppSection,
  type OrgMember,
  type UserRole,
} from "@silvicom/shared";
import { AppCard as BaseCard, AppSelect, AppTable } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import SettingsSection from "@/components/ui/SettingsSection.vue";
import { apiFetch } from "@/lib/api";
import { buildNavGroups } from "@/lib/nav";
import { useModulesQuery } from "@/composables/useModules";
import { useToastStore } from "@/stores/toast";

/**
 * Permissions (EDITABLE-PERMISSIONS-PLAN.md P0, D-PERM1).
 *
 * The matrix used to render as a collapsed panel at the bottom of `/settings/users` — no route, no
 * nav entry, no title, and reachable only by an admin who already knew to press "Show". The owner's
 * report on 2026-09-02 was, in full, "we dont have permissions page … at least i dont see it", and
 * that is a fair reading of a page that is not addressable.
 *
 * ⚠ READ-ONLY, and it says so on screen. The matrix is a compile-time literal
 * (`packages/shared/src/auth.ts`) mirrored by hand into ~89 RLS predicates, so an "edit" control
 * here would change what the UI hides and nothing about what the database allows — a page that
 * lies about security. Making it genuinely editable is P1–P6 of the plan; this step is what that
 * page is built on, and it is worth shipping alone because it answers the discoverability half now.
 *
 * The second table is the point of the page rather than a decoration: the matrix says what a ROLE
 * may do, and the question actually asked was "control exactly what they can see on dashboard".
 * That is answered by `buildNavGroups` — the same function the sidebar calls — so this shows the
 * real nav a given member gets, not a second opinion about it.
 */
const toast = useToastStore();
const modules = useModulesQuery();

const SECTION_LABELS: Record<AppSection, string> = {
  fuel: "Fuel",
  dispatch: "Dispatch",
  safety: "Safety",
  hazmat: "HazmatGuard",
  roster: "Roster",
  equipment: "Equipment",
  recruitment: "Recruitment",
  admin: "Admin",
  settings: "Settings",
  accounting: "Accounting",
  billing: "Billing",
  maintenance: "Maintenance",
};

const permMatrix = computed(() =>
  USER_ROLES.map((r) => ({
    role: r,
    label: USER_ROLE_LABELS[r],
    cells: APP_SECTIONS.map((s) => ({ section: s, access: sectionAccess(r, s) })),
  })),
);
const accessText = (a: string) => (a === "manage" ? "Manage" : a === "view" ? "View" : "—");
const accessCls = (a: string) =>
  a === "manage" ? "font-medium text-success-700" : a === "view" ? "text-ink-secondary" : "text-ink-tertiary";

// ── What one member actually sees ────────────────────────────────────────────
const members = ref<OrgMember[]>([]);
const loading = ref(false);
const selectedUserId = ref<string | null>(null);

async function load() {
  loading.value = true;
  const res = await apiFetch<{ members: OrgMember[] }>("/api/members");
  if (res.ok && res.data) {
    members.value = res.data.members;
    selectedUserId.value ??= members.value[0]?.userId ?? null;
  } else {
    toast.error("Could not load members", res.error?.message);
  }
  loading.value = false;
}
onMounted(load);

const memberOptions = computed(() =>
  members.value.map((m) => ({ value: m.userId, label: `${m.email ?? m.userId} — ${USER_ROLE_LABELS[m.role as UserRole]}` })),
);
const selectedMember = computed(() => members.value.find((m) => m.userId === selectedUserId.value) ?? null);

/**
 * The member's sidebar, built by the function that builds the real one. Hazmat review and Messages
 * carry live count badges in the real nav; passing none here is correct — a count is not a
 * permission, and a zero badge would read as "this item is hidden".
 */
const memberNav = computed(() => {
  const role = (selectedMember.value?.role ?? null) as UserRole | null;
  if (!role) return [];
  return buildNavGroups(role, modules.data.value ?? null);
});

const hiddenSections = computed(() => {
  const role = (selectedMember.value?.role ?? null) as UserRole | null;
  if (!role) return [];
  return APP_SECTIONS.filter((s) => sectionAccess(role, s) === "none").map((s) => SECTION_LABELS[s]);
});
</script>

<template>
  <div class="space-y-8">
    <PageHeader description="What each role can reach, and exactly what a given member sees in the sidebar." />

    <BaseCard as="section">
      <h3 class="text-base font-semibold text-ink">These permissions are fixed</h3>
      <p class="mt-1 text-sm text-ink-muted">
        Access is decided by a member's role, and the roles below are built in. To change what
        someone can reach, change their role on the
        <RouterLink to="/settings/users" class="text-brand-700 underline">Users page</RouterLink>.
        Editing the roles themselves is planned and not built yet.
      </p>
    </BaseCard>

    <SettingsSection title="What each role can reach">
      <BaseCard as="section">
        <p class="mb-3 text-sm text-ink-muted">
          <span class="font-medium text-success-700">Manage</span> = view and edit. View = read-only.
          — = the section is hidden entirely.
        </p>
        <div class="overflow-x-auto">
          <AppTable class="min-w-full text-sm">
            <thead class="text-ink-muted">
              <tr>
                <th class="py-2 pr-4 text-left font-medium">Role</th>
                <th v-for="s in APP_SECTIONS" :key="s" class="px-3 py-2 text-center font-medium">
                  {{ SECTION_LABELS[s] }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-edge-subtle">
              <tr v-for="prow in permMatrix" :key="prow.role">
                <td class="py-2 pr-4 font-medium text-ink">{{ prow.label }}</td>
                <td
                  v-for="c in prow.cells"
                  :key="c.section"
                  class="px-3 py-2 text-center"
                  :class="accessCls(c.access)"
                >
                  {{ accessText(c.access) }}
                </td>
              </tr>
            </tbody>
          </AppTable>
        </div>
      </BaseCard>
    </SettingsSection>

    <SettingsSection title="What one member sees">
      <BaseCard as="section">
        <div class="max-w-md">
          <AppSelect v-model="selectedUserId" :options="memberOptions" :disabled="loading" />
        </div>

        <p v-if="loading" class="mt-4 text-sm text-ink-muted">Loading members…</p>
        <p v-else-if="!selectedMember" class="mt-4 text-sm text-ink-muted">
          No members yet. Invite one from the Users page.
        </p>

        <template v-else>
          <p class="mt-4 text-sm text-ink-muted">
            Signed in as {{ selectedMember.email ?? selectedMember.userId }}, they see these sidebar
            items:
          </p>
          <div class="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div v-for="g in memberNav" :key="g.label ?? 'top'" class="rounded-surface bg-surface-subtle p-3">
              <p class="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {{ g.label ?? "Top level" }}
              </p>
              <ul class="mt-2 space-y-1">
                <li v-for="i in g.items" :key="i.to" class="text-sm text-ink-secondary">{{ i.name }}</li>
              </ul>
            </div>
          </div>

          <p v-if="hiddenSections.length" class="mt-4 text-sm text-ink-muted">
            Hidden from them: {{ hiddenSections.join(", ") }}.
          </p>
        </template>
      </BaseCard>
    </SettingsSection>
  </div>
</template>
