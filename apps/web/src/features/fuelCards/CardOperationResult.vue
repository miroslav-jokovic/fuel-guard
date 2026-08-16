<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { outcomeNotice } from "./cardControlModel";
import type { CardMutationOutcome } from "./useCardControl";

/**
 * What happened, kept IN the drawer — invariant 4.
 *
 * A toast that vanishes after four seconds is the wrong place for an outcome the operator may need
 * to act on, and three of the four possible outcomes are not "it worked": `drift_detected` means
 * something else on the card moved too, `failed` carries EFS's own words and the reference WEX asks
 * for, and `sent` means we do not know.
 *
 * ── `sent` disables the retry, and that is the whole point of separating it ─────────────────────
 * The write reached EFS and the re-read did not confirm it. Retrying could apply it twice — a second
 * fuel exception is a second free tank — so the button is disabled and the copy sends the operator
 * to the WEX portal instead. This is the most dangerous state in the system and the one the old
 * drawer expressed only as a warning-coloured toast.
 */

const props = defineProps<{ outcome: CardMutationOutcome; doneLabel: string; cardId: string }>();
const emit = defineEmits<{ retry: []; close: [] }>();

const notice = computed(() => outcomeNotice(props.outcome, props.doneLabel));
const unconfirmed = computed(() => props.outcome.status === "sent");
</script>

<template>
  <section class="space-y-4" aria-labelledby="result-heading">
    <h3 id="result-heading" class="text-base font-semibold text-ink">{{ notice.title }}</h3>
    <p class="text-sm leading-6 text-ink-muted">
      {{ notice.message ?? "The card now reads as shown on this page." }}
    </p>

    <p v-if="unconfirmed" class="rounded-control bg-caution-50 px-3 py-2 text-sm text-caution-700">
      Trying again is disabled for this one. The change was sent and we could not confirm what
      happened, so a retry could apply it twice — check the card in the WEX portal first.
    </p>

    <div class="flex flex-wrap justify-end gap-3">
      <BaseButton variant="soft" size="sm" :to="`/fuel-cards/${props.cardId}`">
        Open this card's history
      </BaseButton>
      <BaseButton
        v-if="props.outcome.status !== 'succeeded'"
        variant="secondary"
        size="sm"
        :disabled="unconfirmed"
        @click="emit('retry')"
      >
        Try again
      </BaseButton>
    </div>
  </section>
</template>
