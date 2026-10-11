<script setup lang="ts">
import { computed, ref } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { SELFIE_VERDICTS, SELFIE_VERDICT_LABELS, type SelfieVerdict } from "@silvicom/shared";
import { formatDateTime } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useRecordSelfieVerdict, useSelfieCheckQuery } from "@/features/recruitment/useSelfieCheck";

/**
 * Is the person in the selfie the person on the licence? (AW6, APPLICATION-FLOW-V2-PLAN §6.7, D-AW10
 * phase 1, Q-AW5 (a).)
 *
 * ── A PERSON LOOKS, AND SAYS SO ───────────────────────────────────────────────────────────────
 * The two photographs side by side, the same size, and three words — 0376's CHECK. Nothing on this
 * screen suggests an answer: no score, no highlight. The owner ruled out automated matching, and a
 * hint from software here would be exactly that, arrived by the side door.
 *
 * ── NEVER A HARD BLOCK ────────────────────────────────────────────────────────────────────────
 * §6.7: a driver who could not take a selfie, or whose selfie does not match, is checked in person on
 * arrival. So the reading gates nothing — the checklist does not read it — and "Not the same person"
 * says what to do next rather than stopping anything.
 *
 * ⚠ Each photo URL lives five minutes (`applicantSelfie.ts`). A reader who leaves the drawer open longer
 * sees a broken image, and the image's error handler refetches rather than showing it broken.
 */
const props = defineProps<{ driverId: string }>();

const session = useSessionStore();
const toast = useToastStore();
const driverId = computed(() => props.driverId);
const check = useSelfieCheckQuery(driverId);
const record = useRecordSelfieVerdict();

const data = computed(() => check.data.value ?? null);
const canRecord = computed(() => session.can("recruitment"));

async function say(verdict: SelfieVerdict): Promise<void> {
  try {
    await record.mutateAsync({ driverId: props.driverId, verdict });
    toast.success("Reading saved", SELFIE_VERDICT_LABELS[verdict]);
  } catch (e) {
    toast.error("Could not save the reading", e instanceof Error ? e.message : undefined);
  }
}

/**
 * A lapsed signed URL: ask for fresh ones rather than leave a broken picture — ONCE, until a picture
 * loads again. A photo whose object is gone (the staging sweep, a purge) fails on a fresh URL too, and
 * every refetch is a new answer with new URLs, so "once per answer" asked the API forever (caught by
 * "asks for fresh photo URLs once when an image fails").
 */
const retried = ref(false);
function lapsed(): void {
  if (retried.value) return;
  retried.value = true;
  void check.refetch();
}
function loaded(): void {
  retried.value = false;
}
</script>

<template>
  <div class="space-y-4 border-t border-edge pt-6" data-selfie-check>
    <div>
      <p class="text-sm font-medium text-ink">Is it them?</p>
      <p class="mt-1 text-xs text-ink-secondary">
        Their photo beside their licence photo. Look, and say what you see — no software compares them.
      </p>
    </div>

    <p v-if="check.isLoading.value" class="text-xs text-ink-muted">Loading the photos…</p>
    <p v-else-if="check.isError.value" class="text-xs text-danger-700" role="alert">The photos could not be loaded.</p>

    <template v-else-if="data?.selfie">
      <div class="grid grid-cols-2 gap-3">
        <figure class="space-y-1">
          <img
            :src="data.licenceFront?.url"
            alt="Front of their licence"
            class="aspect-[3/4] w-full rounded-surface bg-surface-muted object-contain ring-1 ring-edge"
            @error="lapsed"
            @load="loaded"
          >
          <figcaption class="text-2xs text-ink-tertiary">
            {{ data.licenceFront ? "Their licence" : "No licence photo on file" }}
          </figcaption>
        </figure>
        <figure class="space-y-1">
          <img
            :src="data.selfie.url"
            alt="The photo they took of themselves"
            class="aspect-[3/4] w-full rounded-surface bg-surface-muted object-contain ring-1 ring-edge"
            @error="lapsed"
            @load="loaded"
          >
          <figcaption class="text-2xs text-ink-tertiary">Their photo, {{ formatDateTime(data.selfie.capturedAt) }}</figcaption>
        </figure>
      </div>

      <p v-if="data.verdict" class="text-xs text-ink-secondary" data-selfie-verdict>
        Reading on file: <span class="font-medium text-ink">{{ SELFIE_VERDICT_LABELS[data.verdict.verdict] }}</span>,
        {{ formatDateTime(data.verdict.at) }}.
      </p>
      <p v-if="data.verdict?.verdict === 'does_not_match' || data.verdict?.verdict === 'unclear'" class="text-xs text-warning-700">
        Check their licence against them in person when they come to the office.
      </p>

      <div v-if="canRecord" class="flex flex-wrap gap-2">
        <BaseButton
          v-for="v in SELFIE_VERDICTS"
          :key="v"
          size="sm"
          :variant="data.verdict?.verdict === v ? 'primary' : 'secondary'"
          :aria-pressed="data.verdict?.verdict === v"
          :disabled="record.isPending.value"
          @click="say(v)"
        >
          {{ SELFIE_VERDICT_LABELS[v] }}
        </BaseButton>
      </div>
    </template>

    <p v-else-if="data?.partOneDone" class="text-xs text-ink-secondary">
      They finished Part 1 without a photo of themselves. Check their licence against them in person when
      they come to the office.
    </p>
    <p v-else class="text-xs text-ink-muted">
      No photo yet — they take it near the end of Part 1.
    </p>
  </div>
</template>
