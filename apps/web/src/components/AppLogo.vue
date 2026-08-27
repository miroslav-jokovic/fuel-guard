<script setup lang="ts">
// Silvicom 360 brand mark (shield + fuel pump + drop + chart).
// Pass dark=true when rendered on a dark background (sidebar) — inverts to white.
// Size it from the parent via a class, e.g. <AppLogo class="size-9" />.
withDefaults(defineProps<{ dark?: boolean }>(), { dark: false });
</script>

<template>
  <img
    src="/logo-mark.png"
    alt="Silvicom 360"
    class="object-contain"
    :class="dark ? 'brightness-0 invert' : ''"
    aria-label="Silvicom 360 logo"
    draggable="false"
  />
</template>
