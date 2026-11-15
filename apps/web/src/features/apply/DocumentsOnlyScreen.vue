<script setup lang="ts">
import { computed } from "vue";
import { AppCard as BaseCard } from "@silvicom/ui";
import { formatDisplayDate, type ApplicationCaptureView, type DocumentsLinkBundle } from "@silvicom/shared";
import DocumentCaptureFields from "./DocumentCaptureFields.vue";
import { provideLocalCopy } from "./deviceCopies";
import { APPLY_COPY } from "./strings";

/**
 * What a documents-only link opens on (APPLICATION-FIX-PLAN.md, Q-AM19; migration 0608): the photo
 * list, and nothing else.
 *
 * ── WHY IT IS A SCREEN OF ITS OWN AND NOT A MODE OF THE APPLICATION'S PAGE ────────────────────
 * The application's page is a chain of phases, and every one of them reads something this link's bundle
 * does not have — and must not: a draft, a release, a packet. So the door is chosen above that page
 * (`ApplyDoorPage`), and this screen is handed the small bundle and draws the one thing the link is
 * for. There is no stage bar (the driver is not on a stage), no Send button (there is no application to
 * send here) and no date-of-birth question (it shows no answer).
 *
 * The list itself is the application's own "Your documents" (`DocumentCaptureFields`), so a photograph
 * is gated, staged and kept on the phone exactly as it is there.
 */
const props = defineProps<{ token: string; bundle: DocumentsLinkBundle }>();
// The device's copy of a photograph not yet confirmed is kept under the same key on every door.
provideLocalCopy(() => props.bundle);
const copy = APPLY_COPY.documentsLink;
const captures = computed(() => props.bundle.captures as ApplicationCaptureView[]);
</script>

<template>
  <div class="space-y-6" data-documents-only>
    <div>
      <h1 class="text-2xl font-semibold text-ink">{{ copy.heading(bundle.carrier) }}</h1>
      <p class="mt-1 text-sm text-ink-muted">{{ copy.intro }}</p>
    </div>
    <BaseCard>
      <DocumentCaptureFields :token="token" :captures="captures" bare />
    </BaseCard>
    <p class="text-sm text-ink-muted">{{ copy.saved }}</p>
    <p class="text-xs text-ink-tertiary">{{ copy.until(formatDisplayDate(bundle.expiresAt), bundle.carrier) }}</p>
  </div>
</template>
