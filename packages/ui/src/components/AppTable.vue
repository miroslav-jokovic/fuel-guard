<script setup lang="ts">
defineOptions({ inheritAttrs: false });
</script>

<template>
  <div class="overflow-x-auto">
    <table v-bind="$attrs" class="min-w-full text-sm">
      <slot />
    </table>
  </div>
</template>
