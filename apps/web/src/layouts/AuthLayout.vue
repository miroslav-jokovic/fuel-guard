<script setup lang="ts">
// Centered card layout for unauthenticated/auth pages.
</script>

<template>
  <div class="flex min-h-full flex-col justify-center px-6 py-12 lg:px-8">
    <div class="sm:mx-auto sm:w-full sm:max-w-md">
      <div class="flex items-center justify-center gap-x-3">
        <span
          class="flex size-10 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white"
          >FG</span
        >
        <span class="text-2xl font-semibold text-gray-900">FleetGuard</span>
      </div>
    </div>
    <div class="mt-10 sm:mx-auto sm:w-full sm:max-w-md">
      <div class="bg-white px-6 py-8 shadow-sm ring-1 ring-gray-200 sm:rounded-lg sm:px-10">
        <slot />
      </div>
    </div>
  </div>
</template>
