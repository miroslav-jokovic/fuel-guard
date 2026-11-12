<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton, FactList, type Fact } from "@silvicom/ui";
import { formatDate } from "@/lib/format";
import { useSessionStore } from "@/stores/session";

/**
 * The applicant's date of birth and licence as screening will use them (AF3, D-AF8), with the way to
 * correct them — which is the application's Applicant facts card, not a form of its own.
 *
 * ── WHY IT IS SHOWN HERE ──────────────────────────────────────────────────────────────────────
 * The applicant gives these with the permissions (D-AF1), and they are what PSP, the driving record and
 * the Clearinghouse query run on. The office looking at "permissions signed" is the office about to order
 * those, so a typo in a licence number is caught here, before money is spent on somebody else's report.
 *
 * ── WHY IT NO LONGER CORRECTS THEM (APPLICATION-FIX-PLAN F3c part 2, step 6) ─────────────────
 * Until step 6 this was a second editor of the same three answers, beside the card's (owner D-AM7: "do not
 * keep two editors of one answer"). Both posted to the one identity route, so they could not disagree on
 * the VALUE — but only the card shows each correction as the driver will read it on 3.1, says when the
 * window has shut (the first packet mark), and sits beside the rest of the application. "Correct them in
 * the application" asks the page to open the review drawer at these rows (`correct`); the page swaps one
 * drawer for the other (no nested dialogs) and brings the step back when the review is closed.
 *
 * ⚠ `session.can("recruitment")`, the test the identity route enforces (`requireSection`). A reader sees
 * the values and no button.
 */
const props = defineProps<{
  identity: { date_of_birth?: string | null; cdl_number?: string | null; cdl_state?: string | null } | null;
}>();
const emit = defineEmits<{ correct: [] }>();

const session = useSessionStore();
const canCorrect = computed(() => session.can("recruitment"));

const onFile = computed(() => Boolean(props.identity?.date_of_birth && props.identity.cdl_number && props.identity.cdl_state));
/** The licence number keeps its monospace (D-US6). */
const facts = computed<Fact[]>(() => [
  { label: "Date of birth", value: formatDate(props.identity?.date_of_birth) },
  { label: "Licence number", value: props.identity?.cdl_number, tone: "font-mono text-ink" },
  { label: "State", value: props.identity?.cdl_state },
]);
</script>

<template>
  <section class="space-y-3 border-t border-edge pt-4" data-identity-on-file>
    <div>
      <h3 class="text-sm font-semibold text-ink">Date of birth and licence</h3>
      <p class="mt-0.5 text-2xs text-ink-muted">
        PSP, the driving record and the Clearinghouse query run on these. They are corrected in the
        application, where the applicant is shown each change before they sign.
      </p>
    </div>
    <FactList v-if="onFile" :columns="3" :facts="facts" />
    <p v-else class="text-xs text-ink-muted">Not given yet. The applicant enters these before signing.</p>
    <BaseButton v-if="canCorrect" size="sm" variant="secondary" @click="emit('correct')">
      {{ onFile ? "Correct them in the application" : "Enter them in the application" }}
    </BaseButton>
  </section>
</template>
