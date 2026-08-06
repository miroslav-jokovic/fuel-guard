<script setup lang="ts">
import { computed } from "vue";
import { AppIcon } from "@fuelguard/ui";
import { ChevronUpDownIcon } from "@fuelguard/ui/icons";
import { USER_ROLE_LABELS, type UserRole } from "@fuelguard/shared";
import { RouterLink } from "vue-router";
import KebabMenu from "@/components/KebabMenu.vue";

const props = defineProps<{
  email: string | null;
  role: UserRole | null;
  collapsed?: boolean;
  canManage?: boolean;
}>();

const emit = defineEmits<{ signOut: [] }>();

const avatarLetter = computed(() => (props.email ?? "?")[0]?.toUpperCase() ?? "?");
const roleLabel = computed(() => (props.role ? USER_ROLE_LABELS[props.role] : "Signed in"));
</script>

<template>
  <KebabMenu
    :block="!collapsed"
    :placement="collapsed ? 'right-end' : 'top-start'"
    :trigger-label="`Account menu for ${email ?? 'signed-in user'}`"
    tone="sidebar"
  >
    <template #trigger>
      <div
        v-if="collapsed"
        class="flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.06]"
        :title="email ?? undefined"
      >
        <span
          class="sidebar-avatar flex size-7 items-center justify-center rounded-full text-xs font-semibold"
          aria-hidden="true"
        >
          {{ avatarLetter }}
        </span>
      </div>
      <div
        v-else
        class="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]"
      >
        <span
          class="sidebar-avatar flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
          aria-hidden="true"
        >
          {{ avatarLetter }}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-semibold text-white">{{ email }}</span>
          <span class="sidebar-muted mt-0.5 block truncate text-xs">{{ roleLabel }}</span>
        </span>
        <AppIcon
          :icon="ChevronUpDownIcon"
          class="sidebar-muted size-4 shrink-0 transition-colors group-hover:text-white"
          aria-hidden="true"
        />
      </div>
    </template>

    <div class="sidebar-divider border-b px-3 py-2.5">
      <p class="truncate text-sm font-semibold text-white">{{ email }}</p>
      <p class="sidebar-muted mt-0.5 text-xs">{{ roleLabel }}</p>
    </div>
    <RouterLink v-if="canManage" to="/settings" class="sidebar-account-item">Settings</RouterLink>
    <button type="button" class="sidebar-account-item text-danger-300 hover:text-danger-200" @click="emit('signOut')">
      Sign out
    </button>
  </KebabMenu>
</template>
