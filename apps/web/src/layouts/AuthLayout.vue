<script setup lang="ts">
// Centered card layout for unauthenticated/auth pages.
import { useColorScheme } from "@/composables/useColorScheme";

const { isDark } = useColorScheme();
</script>

<template>
  <div class="flex min-h-full flex-col justify-center px-6 py-12 lg:px-8">
    <div class="sm:mx-auto sm:w-full sm:max-w-md">
      <div class="flex items-center justify-center">
        <img
          src="/SilvicomLogoText.svg"
          alt="Silvicom 360"
          class="h-8 object-contain"
          :class="isDark ? 'brightness-0 invert' : ''"
          draggable="false"
        />
      </div>
    </div>
    <div class="mt-10 sm:mx-auto sm:w-full sm:max-w-md">
      <div class="bg-surface px-6 py-8 ring-1 ring-edge sm:rounded-surface sm:px-10">
        <slot />
      </div>
    </div>
  </div>
</template>
