<template>
  <div
    class="flex min-h-9 items-stretch overflow-hidden rounded-control bg-surface ring-1 ring-inset ring-edge-control focus-within:ring-2 focus-within:ring-focus-ring"
  >
    <div v-if="$slots.prefix" class="flex items-center pl-3 text-sm text-ink-tertiary">
      <slot name="prefix" />
    </div>
    <div class="min-w-0 flex-1 [&_input]:rounded-none [&_input]:ring-0 [&_input]:focus:ring-0">
      <slot />
    </div>
    <div v-if="$slots.suffix" class="flex items-center pr-1 text-sm text-ink-tertiary">
      <slot name="suffix" />
    </div>
  </div>
</template>
