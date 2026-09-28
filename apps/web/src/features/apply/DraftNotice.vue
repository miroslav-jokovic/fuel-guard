<script setup lang="ts">
import { AppButton, AppCallout } from "@silvicom/ui";
import { APPLY_COPY } from "./strings";
import type { DraftReplayNotice, DraftSaveState } from "./useApplicationDraft";

/**
 * What autosave has to tell the driver beyond its one-line status (AW10, C3d1b).
 *
 * ⚠ A conflict gets a callout and a button, not just the status line: from that moment NOTHING this tab
 * types is saved (`useApplicationDraft` stops for good, because its copy is the older one), and a driver
 * who reads only "Not saved" keeps typing into it. The status line alone is right for a signal problem,
 * which heals itself on the next keystroke; this does not.
 */
defineProps<{ state: DraftSaveState; notice: DraftReplayNotice }>();

const copy = APPLY_COPY.save;
/** A full reload, not a refetch: the page's restore, the unlock and the revision all start again from the server. */
const reload = (): void => window.location.reload();
</script>

<template>
  <AppCallout v-if="state === 'conflict'" tone="caution" role="alert">
    <p class="font-medium">{{ copy.conflict }}</p>
    <p class="mt-1">{{ copy.conflictDetail }}</p>
    <AppButton class="mt-3" variant="primary" size="touch" @click="reload">{{ copy.reload }}</AppButton>
  </AppCallout>
  <AppCallout v-else-if="notice === 'restored'" tone="info">{{ copy.restored }}</AppCallout>
  <AppCallout v-else-if="notice === 'dropped'" tone="caution">{{ copy.dropped }}</AppCallout>
</template>
