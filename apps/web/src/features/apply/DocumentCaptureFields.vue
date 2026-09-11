<script setup lang="ts">
import { computed, toRef } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import type { ApplicationCaptureView } from "@silvicom/shared";
import { useApplicationCaptures } from "@/features/apply/capture/useApplicationCaptures";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The capture screen (A8) — four slots, each one photograph, each replaceable.
 *
 * ── WHY A REFUSED PHOTOGRAPH IS THE MOST IMPORTANT STATE ON THIS SCREEN ───────────────────────
 * The gate runs in the browser before anything is uploaded (A7), so the common case is a driver in a
 * truck-stop car park being told to move away from the light and try again — and being told that in
 * a tenth of a second, at no cost in bytes. Every rejection therefore names what to fix. "That did
 * not work" would send the driver to a support call the carrier cannot answer either.
 *
 * ── AND WHY NOTHING HERE IS REQUIRED ──────────────────────────────────────────────────────────
 * §391.21 is a form and none of its twelve paragraphs is a photograph; §391.51's file is assembled
 * over the whole hiring process. A driver whose camera will not open must still be able to certify
 * and send, or the carrier loses the candidate over a picture a recruiter can ask for by email.
 */
const props = defineProps<{ token: string; captures: ApplicationCaptureView[] }>();

const copy = APPLY_COPY.documents;
const captures = useApplicationCaptures(toRef(props, "token"), toRef(props, "captures"));
const anyBusy = computed(() => captures.busy.value !== null);
</script>

<template>
  <div class="space-y-4">
    <div>
      <p class="text-sm text-ink-muted">{{ copy.intro }}</p>
      <p class="mt-1 text-sm text-ink-muted">{{ copy.optional }}</p>
    </div>

    <ul class="space-y-3">
      <li
        v-for="slot in captures.slots.value"
        :key="slot.slot"
        class="flex flex-wrap items-center justify-between gap-3 rounded-surface bg-surface-muted p-4"
      >
        <!-- ⚠ The picture, when this browser is the one that took it (X6). A driver who
             photographed the wrong side of a licence had no way to know: the slot said "Received"
             and nothing else, and the server returns slots and dates rather than pictures on
             purpose — re-serving them would mean a signed read URL per slot on an unauthenticated
             surface on every page load. So this is what is in THIS browser's hands, and a capture
             from a previous visit correctly shows none. -->
        <img
          v-if="slot.previewUrl"
          :src="slot.previewUrl"
          :alt="slot.label"
          class="h-14 w-20 shrink-0 rounded-detail object-cover ring-1 ring-inset ring-edge"
        />
        <!-- `flex-1` so the thumbnail and the label stay together on the left and the button keeps
             the right; without it `justify-between` strands the text in the middle of the row. -->
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-ink">{{ slot.label }}</p>
          <p v-if="slot.state === 'done'" class="mt-1 text-sm text-ink-muted">{{ copy.done }}</p>
          <!-- The gate's verdict, in the driver's words. `reason` is always one of the taxonomy's
               members, and the copy map is total over it, so this cannot render a blank. -->
          <p v-else-if="slot.state === 'rejected' && slot.reason" class="mt-1 text-sm text-ink-secondary">
            {{ copy.rejected[slot.reason] }}
          </p>
          <p v-else-if="slot.state === 'failed'" class="mt-1 text-sm text-ink-secondary">{{ copy.failed }}</p>
        </div>
        <BaseButton
          :variant="slot.state === 'done' ? 'ghost' : 'secondary'"
          :disabled="anyBusy"
          @click="captures.capture(slot.slot)"
        >
          <template v-if="slot.state === 'working'">{{ copy.working }}</template>
          <template v-else-if="slot.state === 'done'">{{ copy.retake }}</template>
          <template v-else>{{ copy.take }}</template>
        </BaseButton>
      </li>
    </ul>
  </div>
</template>
