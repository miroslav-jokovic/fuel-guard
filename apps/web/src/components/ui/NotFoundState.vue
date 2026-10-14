<script setup lang="ts">
/**
 * The body of a record page whose record does not exist (D-US5, F21 — UI-STANDARDIZATION.md).
 *
 * Drawn by `QueryState` when its error is a `NotFoundError`, so a page opts in by throwing one from
 * its record read and never draws this itself. Before it, eight detail pages each met a missing
 * record differently: five drew a blank body under the header, Vehicle drew a truck with no data,
 * Fuel card said "Loading the card…" for good, and Driver printed TanStack's own message.
 *
 * ── THE WAY BACK IS THE ROUTE'S PARENT, NOT A PROP ────────────────────────────────────────────
 * Every record page names its list in `meta.parent` already — the breadcrumb trail and the shell's
 * Back chevron walk it — so the button reads that rather than taking a second copy per page
 * (D-DS17). It is offered only when the list opens for this reader (`useOpens`, SP5); otherwise, and
 * for a route with no parent, the way out is the dashboard, as on `NotFoundPage`.
 *
 * `inject` rather than `useRoute`/`useRouter`: `QueryState` is mounted in hundreds of component tests
 * that install no router, and this must render (with the dashboard fallback) in every one of them.
 */
import { computed, inject } from "vue";
import { routeLocationKey, routerKey } from "vue-router";
import { AppButton as BaseButton } from "@silvicom/ui";
import { MagnifyingGlassIcon } from "@silvicom/ui/icons";
import ErrorPanel from "@/components/ErrorPanel.vue";
import { useOpens } from "@/composables/useOpens";

defineProps<{
  /** What is missing, in the voice's "That asset is not on the books." form. */
  message: string;
}>();

const router = inject(routerKey, null);
const route = inject(routeLocationKey, null);
// No router, no route, no parent to offer — so no session to ask either (a component test).
const opens = router ? useOpens() : () => false;

const back = computed(() => {
  const parent = route?.meta.parent;
  if (!router || typeof parent !== "string" || !opens(parent)) return null;
  const title = router.resolve(parent).meta.title;
  return typeof title === "string" ? { to: parent, label: `Back to ${title}` } : null;
});
</script>

<template>
  <ErrorPanel :icon="MagnifyingGlassIcon" :message="message" role="status" data-state="not-found">
    <BaseButton v-if="back" variant="primary" :to="back.to">{{ back.label }}</BaseButton>
    <BaseButton v-else variant="primary" to="/">Go to the dashboard</BaseButton>
  </ErrorPanel>
</template>
