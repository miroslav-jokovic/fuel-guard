<script setup lang="ts">
import { computed } from "vue";
import { useColorScheme } from "@/composables/useColorScheme";

// Silvicom 360 brand mark (shield + fuel pump + drop + chart).
// Pass dark=true when rendered on a dark background (sidebar) — inverts to white.
// Size it from the parent via a class, e.g. <AppLogo class="size-9" />.
const props = withDefaults(defineProps<{ dark?: boolean }>(), { dark: false });
const { isDark } = useColorScheme();
const invert = computed(() => props.dark || isDark.value);
</script>

<template>
  <img
    src="/SilvicomLogoS.svg"
    alt="Silvicom 360"
    class="object-contain"
    :class="invert ? 'brightness-0 invert' : ''"
    aria-label="Silvicom 360 logo"
    draggable="false"
  />
</template>
