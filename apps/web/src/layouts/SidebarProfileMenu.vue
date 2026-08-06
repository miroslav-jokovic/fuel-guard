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
        class="flex size-10 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.08]"
        :title="email ?? undefined"
      >
        <span
          class="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white shadow"
          aria-hidden="true"
        >
          {{ avatarLetter }}
        </span>
      </div>
      <div
        v-else
        class="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/[0.08]"
      >
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold text-white shadow"
          aria-hidden="true"
        >
          {{ avatarLetter }}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-semibold text-white">{{ email }}</span>
          <span class="mt-0.5 block truncate text-xs text-neutral-300">{{ roleLabel }}</span>
        </span>
        <AppIcon
          :icon="ChevronUpDownIcon"
          class="size-4 shrink-0 text-neutral-400 transition-colors group-hover:text-neutral-200"
          aria-hidden="true"
        />
      </div>
    </template>

    <div class="border-b border-white/[0.09] px-3 py-2.5">
      <p class="truncate text-sm font-semibold text-white">{{ email }}</p>
      <p class="mt-0.5 text-xs text-neutral-400">{{ roleLabel }}</p>
    </div>
    <RouterLink v-if="canManage" to="/settings" class="sidebar-account-item">Settings</RouterLink>
    <button type="button" class="sidebar-account-item text-danger-300 hover:text-danger-200" @click="emit('signOut')">
      Sign out
    </button>
  </KebabMenu>
</template>
