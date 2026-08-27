<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { outcomeNotice } from "./cardControlModel";
import type { CardMutationOutcome } from "./useCardControl";
import type { CardOperationId } from "./cardOperations";

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
 *
 * The retry caution is NOT written here. It comes from the notice (`sentNotice`), because "we could
 * not confirm what happened" is false of `override_grant` — that outcome is reachable only with the
 * use count confirmed — and two hand-written copies of the same sentence drifted apart exactly that
 * way once already.
 */

const props = defineProps<{
  outcome: CardMutationOutcome;
  doneLabel: string;
  cardId: string;
  /** Which operation settled. `sent` reads it, so a grant is not told it may have done nothing. */
  operationId?: CardOperationId;
}>();
const emit = defineEmits<{ retry: []; close: [] }>();

const notice = computed(() => outcomeNotice(props.outcome, props.doneLabel, props.operationId));
const unconfirmed = computed(() => props.outcome.status === "sent");
</script>

<template>
  <section class="space-y-4" aria-labelledby="result-heading">
    <h3 id="result-heading" class="text-base font-semibold text-ink">{{ notice.title }}</h3>
    <p class="text-sm leading-6 text-ink-muted">
      {{ notice.message ?? "The card now reads as shown on this page." }}
    </p>

    <p
      v-if="unconfirmed && notice.retryNote"
      class="rounded-control bg-caution-50 px-3 py-2 text-sm text-caution-700"
    >
      {{ notice.retryNote }}
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
