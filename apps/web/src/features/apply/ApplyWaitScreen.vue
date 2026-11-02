<script setup lang="ts">
import type { ApplicantOwedKind } from "@silvicom/shared";
import SmsOptInCard from "@/features/apply/SmsOptInCard.vue";
import ApplicantStatusPanel from "@/features/apply/ApplicantStatusPanel.vue";
import type { ApplyPhases } from "@/features/apply/useApplication";

/**
 * A screen that says the next move is the carrier's, not the applicant's — and nothing else.
 *
 * Three of them since AF5: permissions received and the application not yet sent (plan §3.1 row 5),
 * the application handed over and not yet read (F4), and approved with signing waiting in the office.
 * They are the same shape on purpose — what happened, what happens next, what to do meanwhile — so a
 * driver who meets more than one reads them the same way. Extracted from `ApplyPage.vue` when the
 * second one arrived (500-line budget).
 *
 * ── AND IT IS WHERE TEXTS ARE OFFERED (SMS-OPT-IN-PLAN D-SMS1) ────────────────────────────────
 * Every waiting screen carries the optional text-message card beneath it, because waiting is the
 * moment "we will text you when it is your turn" is useful — and because a card on a screen that
 * asks nothing is the one place an offer cannot be mistaken for a step. The first of these screens
 * comes before the office sends the application, which is what lets a consent given here cover
 * texting the application link itself.
 *
 * ── AND WHERE THE APPLICATION STANDS (§13 SP1) ────────────────────────────────────────────────
 * Each screen shows the four stages and what the applicant still owes (`ApplicantStatusPanel`). The
 * "nothing more to do" note is shown only when nothing is owed — the drug test booked, the videos sent,
 * the trip booked would make it untrue.
 */
withDefaults(defineProps<{
  heading: string; body: string; note: string; token: string; carrier: string;
  /** §13: absent on a bundle from before SP1, when the screen reads as it did. */
  phases?: ApplyPhases | null; owes?: readonly ApplicantOwedKind[];
}>(), { phases: null, owes: () => [] });
</script>

<template>
  <div>
    <h1 class="text-lg font-semibold text-ink">{{ heading }}</h1>
    <p class="mt-2 text-sm text-ink-muted">{{ body }}</p>
    <p v-if="owes.length === 0" class="mt-2 text-sm text-ink-muted" data-testid="wait-note">{{ note }}</p>
    <ApplicantStatusPanel v-if="phases" :phases="phases" :owes="owes" :carrier="carrier" :token="token" />
    <!-- What the applicant can do while they wait, when there is something (C3a: the Clearinghouse). -->
    <slot />
    <SmsOptInCard :token="token" :carrier="carrier" />
  </div>
</template>
