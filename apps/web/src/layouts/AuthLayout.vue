<script setup lang="ts">
// Centered card layout for unauthenticated/auth pages.
import AppLogo from "@/components/AppLogo.vue";
</script>

<template>
  <div class="flex min-h-full flex-col justify-center px-6 py-12 lg:px-8">
    <div class="sm:mx-auto sm:w-full sm:max-w-md">
      <div class="flex items-center justify-center gap-x-3">
        <AppLogo class="size-10" />
        <img src="/logo-wordmark.png" alt="FuelGuard" class="h-8 object-contain brightness-0" draggable="false" />
      </div>
    </div>
    <div class="mt-10 sm:mx-auto sm:w-full sm:max-w-md">
      <div class="bg-surface px-6 py-8 shadow-sm ring-1 ring-edge sm:rounded-lg sm:px-10">
        <slot />
      </div>
    </div>
  </div>
</template>
