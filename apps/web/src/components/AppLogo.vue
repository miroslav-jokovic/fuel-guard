<script setup lang="ts">
// FuelGuard logomark: a shield (guard) around a fuel droplet with a verify check.
// Colors follow the brand ramp tokens (style.css), so a re-brand recolors the mark too.
// Size it from the parent via a class, e.g. <AppLogo class="size-9" />.
</script>

<template>
  <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="FuelGuard logo">
    <defs>
      <linearGradient id="fuelguardMark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="var(--ramp-brand-500)" />
        <stop offset="1" stop-color="var(--ramp-brand-700)" />
      </linearGradient>
    </defs>
    <!-- shield -->
    <path d="M16 3 L28 8 L28 16 C28 22.5 22.9 26.6 16 29 C9.1 26.6 4 22.5 4 16 L4 8 Z" fill="url(#fuelguardMark)" />
    <!-- fuel droplet -->
    <path d="M16 8.5 C19.2 13.5 21 15.4 21 18 A5 5 0 1 1 11 18 C11 15.4 12.8 13.5 16 8.5 Z" fill="white" />
    <!-- verify check -->
    <path d="M13 18.4 l2.4 2.4 l4-4.8" fill="none" stroke="var(--ramp-brand-700)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>
