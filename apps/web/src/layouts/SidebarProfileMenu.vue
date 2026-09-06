<script setup lang="ts">
import { computed } from "vue";
import { AppIcon, AppAvatar } from "@silvicom/ui";
import {
  ChevronUpDownIcon,
  SchemeDarkIcon,
  SchemeLightIcon,
  SchemeSystemIcon,
} from "@silvicom/ui/icons";
import { useColorScheme, type ColorScheme } from "@/composables/useColorScheme";
import { USER_ROLE_LABELS, type UserRole } from "@silvicom/shared";
import { RouterLink } from "vue-router";
import KebabMenu from "@/components/KebabMenu.vue";

const props = defineProps<{
  email: string | null;
  /** The person's display name (0301); absent, the email stands where it always did. */
  name?: string | null;
  role: UserRole | null;
  collapsed?: boolean;
  canManage?: boolean;
}>();

const emit = defineEmits<{ signOut: [] }>();

/**
 * Appearance lives in the account menu rather than in Settings because it is a per-device
 * preference, not an org one — the same person wants dark on a night dispatch shift and light in a
 * sunlit cab, and neither choice should follow them onto another machine.
 */
const { scheme, set } = useColorScheme();
const SCHEME_OPTIONS: { value: ColorScheme; label: string; icon: typeof SchemeSystemIcon }[] = [
  { value: "system", label: "System", icon: SchemeSystemIcon },
  { value: "light", label: "Light", icon: SchemeLightIcon },
  { value: "dark", label: "Dark", icon: SchemeDarkIcon },
];

const roleLabel = computed(() => (props.role ? USER_ROLE_LABELS[props.role] : "Signed in"));
/** What the trigger and the menu head say first: the name if there is one, else the email. */
const headline = computed(() => props.name ?? props.email);
/** The second line: the role, and the email beside it when the first line was a name. */
const subline = computed(() => (props.name && props.email ? `${props.email} · ${roleLabel.value}` : roleLabel.value));
</script>

<template>
  <KebabMenu
    :block="!collapsed"
    :placement="collapsed ? 'right-end' : 'top-start'"
    :trigger-label="`Account menu for ${headline ?? 'signed-in user'}`"
    tone="sidebar"
  >
    <template #trigger>
      <div
        v-if="collapsed"
        class="flex size-9 items-center justify-center rounded-surface transition-colors hover:bg-surface-muted"
        :title="headline ?? undefined"
      >
        <AppAvatar :label="headline" size="sm" />
      </div>
      <div
        v-else
        class="group flex w-full items-center gap-2.5 rounded-surface px-2 py-1.5 text-left transition-colors hover:bg-surface-muted"
      >
        <AppAvatar :label="headline" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-semibold text-ink">{{ headline }}</span>
          <span class="sidebar-muted mt-0.5 block truncate text-xs">{{ subline }}</span>
        </span>
        <AppIcon
          :icon="ChevronUpDownIcon"
          class="sidebar-muted size-4 shrink-0 transition-colors group-hover:text-ink"
          aria-hidden="true"
        />
      </div>
    </template>

    <div class="sidebar-divider border-b px-3 py-2.5">
      <p class="truncate text-sm font-semibold text-ink">{{ headline }}</p>
      <p class="sidebar-muted mt-0.5 truncate text-xs">{{ subline }}</p>
    </div>
    <div class="sidebar-divider my-1 border-t" />
    <p class="sidebar-section-label px-3 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide">
      Appearance
    </p>
    <div class="flex gap-1 px-2 pb-1.5" role="radiogroup" aria-label="Colour scheme">
      <button
        v-for="option in SCHEME_OPTIONS"
        :key="option.value"
        type="button"
        role="radio"
        :aria-checked="scheme === option.value"
        class="flex flex-1 flex-col items-center gap-1 rounded-control px-2 py-1.5 text-2xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        :class="
          scheme === option.value
            ? 'bg-selected-surface text-ink'
            : 'text-ink-muted hover:bg-surface-muted hover:text-ink-secondary'
        "
        @click.stop="set(option.value)"
      >
        <AppIcon :icon="option.icon" class="size-4" aria-hidden="true" />
        {{ option.label }}
      </button>
    </div>
    <div class="sidebar-divider mb-1 border-t" />
    <RouterLink v-if="canManage" to="/settings" class="sidebar-account-item">Settings</RouterLink>
    <button
      type="button"
      class="sidebar-account-item text-danger-700 hover:text-danger-800"
      @click="emit('signOut')"
    >
      Sign out
    </button>
  </KebabMenu>
</template>
