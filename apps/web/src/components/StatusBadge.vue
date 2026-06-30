<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ status: string }>();

const cls = computed(() => {
  switch (props.status) {
    case "active":
      return "bg-green-100 text-green-800";
    case "maintenance":
      return "bg-amber-100 text-amber-800";
    case "retired":
    case "inactive":
      return "bg-gray-100 text-gray-600";
    default:
      return "bg-gray-100 text-gray-600";
  }
});
</script>

<template>
  <span :class="['inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', cls]">
    {{ status }}
  </span>
</template>
