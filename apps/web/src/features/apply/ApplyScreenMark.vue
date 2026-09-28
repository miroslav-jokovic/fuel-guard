<script setup lang="ts">
import type { ApplyScreen } from "@silvicom/shared";
import { useApplyScreen } from "@/features/apply/useScreenEvents";

/**
 * Names the branch of the phase chain it sits in, for the screen reports (AW14, C3d3a). Renders an
 * empty hidden span and nothing else. Placed FIRST in its branch, so any screen the branch's own flow names (Part 1's, a
 * permission, the handbook) registers after it and wins while it is showing — see `useScreenEvents.ts`.
 */
const props = defineProps<{ name: ApplyScreen }>();
useApplyScreen(() => props.name);
</script>

<template>
  <!-- A name, not a thing on the page: an empty, hidden span, because a template must have a root. -->
  <span hidden />
</template>
