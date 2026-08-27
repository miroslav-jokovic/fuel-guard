<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { buildTrail } from "@/lib/breadcrumbs";
import BreadcrumbTrail from "@/components/ui/BreadcrumbTrail.vue";

const props = withDefaults(defineProps<{ title?: string; description?: string }>(), {
  title: undefined,
  description: undefined,
});
const route = useRoute();
const router = useRouter();
const resolvedTitle = computed(() => props.title ?? (route.meta.title as string) ?? "Silvicom 360");

/**
 * The breadcrumb trail (G2, UI-GAPS-PLAN.md), walked from `meta.parent` by `lib/breadcrumbs.ts`.
 *
 * ⚠ `router.resolve` never returns null — since G1 an unknown path matches the catch-all — so the
 * "does this route exist" question is answered by checking the resolved name, not by a null test.
 * A dead parent must truncate the trail rather than produce a crumb labelled "Page not found".
 *
 * `BreadcrumbTrail` decides whether a trail is worth rendering; this only decides what the trail is.
 */
const trail = computed(() =>
  buildTrail(route.path, (path) => {
    const resolved = router.resolve(path);
    return resolved.name === "not-found" ? null : resolved.meta;
  }),
);
</script>

<template>
  <header class="flex flex-col gap-4 border-b border-edge-subtle pb-5 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0">
      <BreadcrumbTrail :trail="trail" />
      <h1 class="text-2xl font-semibold tracking-tight text-ink">{{ resolvedTitle }}</h1>
      <p v-if="description || $slots.default" class="mt-1 max-w-3xl text-sm text-ink-tertiary">
        <slot>{{ description }}</slot>
      </p>
      <div v-if="$slots.freshness" class="mt-2 text-xs text-ink-tertiary">
        <slot name="freshness" />
      </div>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
