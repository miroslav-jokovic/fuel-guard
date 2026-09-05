<script setup lang="ts">
import { ref } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { apiDownload } from "@/lib/api";
import { useToastStore } from "@/stores/toast";

/**
 * "This filter bar, as a file."
 *
 * ── WHY IT NAMES ITS OWN SCOPE ──────────────────────────────────────────────────────────────────
 * `ReportExportButton` learnt this on the spend page and the sentence is worth keeping: the filter bar
 * already controls the period and the trucks and the export has always followed it, but nothing SAID
 * so, so a 90-day default read as "the report is stuck on three months" rather than as "the filter is
 * set to three months". Stating the range and the truck count turns an invisible coupling into an
 * obvious one — and the server prints the same sentence ON the artefact (D-FUI15), because a file
 * outlives the screen it came from.
 *
 * ── WHY THERE IS ONE OF THESE AND NOT SIX ───────────────────────────────────────────────────────
 * FUEL-P2 puts an export on five list surfaces. Five buttons, each with its own busy flag, its own
 * toast and its own idea of how to say "2 trucks", is how a section ends up with five controls that
 * look almost but not quite alike — the thing `apps/web/CLAUDE.md`'s "one primitive per job" exists to
 * prevent. `ReportExportButton` is now a wrapper over this that knows the spend PDF's address.
 *
 * The failure path is a toast, not an inline banner, and it carries the SERVER's sentence: the one
 * refusal this can produce is "that selection is 84,000 rows", which is only useful if the number
 * survives to the reader.
 */
const props = withDefaults(
  defineProps<{
    /** API path with its query string already encoded — the page's own parameters, unrewritten. */
    href: string;
    /** What the browser saves it as. */
    filename: string;
    /** The scope sentence shown beside the button, e.g. "2026-08-01 → 2026-08-31 · 2 trucks". */
    scope: string;
    label?: string;
    /** Shown while the request is in flight; the button is disabled throughout. */
    busyLabel?: string;
    disabled?: boolean;
    variant?: "secondary" | "ghost";
  }>(),
  { label: "Export CSV", busyLabel: "Building…", disabled: false, variant: "ghost" },
);

const toast = useToastStore();
const busy = ref(false);

async function run() {
  if (busy.value) return;
  busy.value = true;
  try {
    await apiDownload(props.href, props.filename);
  } catch (e) {
    toast.error("Could not build the file", e instanceof Error ? e.message : undefined);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex items-center gap-2">
    <span class="hidden text-2xs text-ink-tertiary sm:inline">{{ scope }}</span>
    <BaseButton :variant="variant" :disabled="disabled || busy" @click="run">
      {{ busy ? busyLabel : label }}
    </BaseButton>
  </div>
</template>
