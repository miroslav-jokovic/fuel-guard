<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import type { Driver, HiringStepKey } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/ui/PageHeader.vue";
import ExplainerPanel from "@/components/ui/ExplainerPanel.vue";
import { QueryState, NotFoundError, isNotFound } from "@silvicom/ui";
import DispositionSection from "@/features/recruitment/DispositionSection.vue";
import HiringChecklistCard from "@/features/recruitment/HiringChecklistCard.vue";
import HiringStepDrawer from "@/features/recruitment/HiringStepDrawer.vue";
import HireDrawer from "@/features/recruitment/HireDrawer.vue";
import { useSessionStore } from "@/stores/session";
import ApplicationReviewDrawer from "@/features/apply/ApplicationReviewDrawer.vue";
import OrderTestDrawer, { type OrderSeed } from "@/components/medstop/OrderTestDrawer.vue";
import { useApplicantChecklistQuery } from "@/features/recruitment/useApplicantChecklist";
import {
  liveApplicationInvitation,
  useApplicationInvitesQuery,
} from "@/features/recruitment/useApplicationInvites";

/**
 * One applicant's hire — the checklist, and the drawer behind every row (B6, `HIRING-UI-PLAN.md` §4.2).
 *
 * ── WHAT CHANGED AT B6, AND THE SENTENCE IT HAS TO MAKE TRUE ──────────────────────────────────
 * *A recruiter can do the next thing for an applicant without leaving the page.* Until B6 this page
 * was five sections stacked by regulation, and doing the next thing meant knowing which of them held
 * it — or, for five of the twelve steps, knowing to go to an entirely different page. Now the
 * checklist leads, every row opens the work behind it, and the lead action is a button rather than a
 * sentence.
 *
 * ── THE FIVE SECTIONS ARE NOT REWRITTEN, BUT THEY DO NOT MAP ONE-TO-ONE EITHER ────────────────
 * ⚠ §4.2 says *"each becomes a step's drawer body"*. Measured against the fold on 2026-09-18 that is
 * not a mapping that exists: **five of the twelve emitted steps have a body and seven do not**, and
 * three of the five sections are not steps at all. `hiringStepDrawers.ts` carries the full argument
 * and the resolution; what matters here is the one section that stayed on the page.
 *
 * ⚠ **`DispositionSection` is NOT behind a row, and that is a ruling rather than an oversight.**
 * Recording that an application ended — declined, withdrawn, no response (0238) — is not one of
 * D-HM9's fourteen steps and must not become one: it is how the whole process EXITS, and the
 * checklist describes the process. Putting it behind a step's row would have meant inventing a
 * fifteenth step for it, which is the invented-capability half of `CLAUDE.md`'s *no workarounds*.
 * So it stays a section, below the checklist, where the act it performs is about the application and
 * not about any step in it.
 *
 * ── AND ONE DRAWER CANNOT OPEN INSIDE ANOTHER ─────────────────────────────────────────────────
 * ⚠ `ApplicationReviewDrawer` is itself a `SlideOver`, and it lives in `features/apply` — which
 * `features/recruitment` may not import (`lint:boundaries`). Both facts point the same way: the step
 * drawer EMITS `review` and this page swaps one drawer for the other. Two dialogs open at once is a
 * focus trap inside a focus trap, and the boundary rule was already the reason the old page owned
 * this drawer rather than the invitation card.
 */
const route = useRoute();
const id = computed(() => String(route.params.id ?? ""));

const checklistQ = useApplicantChecklistQuery(id);
const invitesQ = useApplicationInvitesQuery(id);

/**
 * The live invitation — the newest that is not revoked — which is what the review drawer opens.
 *
 * ⚠ Read through `liveApplicationInvitation` rather than a `.find()` here. That rule exists on the
 * server too and the two must agree; before B4 they did not, and the same driver could be described
 * by two different applications on two adjacent surfaces.
 */
const invitationId = computed(
  () => liveApplicationInvitation(invitesQ.data.value ?? [])?.id ?? null,
);

const driverQ = useQuery({
  queryKey: ["driver-detail", id],
  enabled: computed(() => Boolean(id.value)),
  queryFn: async (): Promise<Driver> => {
    const { data, error } = await supabase.from("drivers").select("*").eq("id", id.value).maybeSingle();
    if (error) throw new Error(error.message);
    // No row is not-found (F21): the page drew an "Applicant" checklist that could not load, for
    // somebody who was never on file.
    if (!data) throw new NotFoundError("That applicant is not on file.");
    return data as Driver;
  },
});
const driver = driverQ.data;
const missing = computed(() => isNotFound(driverQ.error.value));

/**
 * The step whose drawer is open — its KEY, and the row itself derived from the live fold.
 *
 * ── ⚠ THE ROW IS DERIVED BECAUSE A STORED ONE GOES STALE UNDER ITS OWN READER (D1) ────────────
 * It held the `HiringStep` object until 2026-09-19, which is a COPY of one element of a response.
 * Recording an act from inside the drawer refetches the checklist — the list behind it went green
 * and the header count moved — and the open drawer went on showing *"Waiting on you"* over the
 * record that had just been filed, with the form still asking for it. Found by filing one in a
 * browser; every test was green, because a test that mounts the drawer with a prop cannot see that
 * the page never changes the prop.
 *
 * ⚠ Null is closed. There is no "which drawer" state beside this, and the drawer closes by itself
 * if the fold ever stops emitting the step — which is the honest response to a row that no longer
 * exists, rather than a panel describing something the server no longer reports.
 */
const openStepKey = ref<HiringStepKey | null>(null);
const openStep = computed(
  () => checklistQ.data.value?.steps.find((s) => s.key === openStepKey.value) ?? null,
);
const reviewing = ref<string | null>(null);

/** One drawer at a time: opening the review closes the step it was opened from. */
function openReview(invitation: string): void {
  openStepKey.value = null;
  reviewing.value = invitation;
}

/**
 * D-1 (HIRING-WORKFLOW-AUDIT-2026-10-31 §9 P2): the Hired row opens the hire itself — `HireDrawer`,
 * the same drawer the board opens — not a step drawer with nothing in it. Gated as the board gates it
 * (SP5: `roster: manage` from the org's matrix, the gate `POST /api/recruitment/hire` reads); anybody
 * else, and a hire already done, get the step drawer, which says what to do.
 */
const session = useSessionStore();
const canHire = computed(() => session.can("roster"));
const hiring = ref(false);
function openRow(step: { key: HiringStepKey; state: string }): void {
  if (step.key === "hired" && canHire.value && step.state !== "done") {
    openStepKey.value = null;
    hiring.value = true;
    return;
  }
  openStepKey.value = step.key;
}

/** UX4 (MEDSTOP-PLAN §7A.5): the drug-test step's pre-employment order, swapped in the same way. */
const ordering = ref<OrderSeed | null>(null);
function openOrder(medstopId: string): void {
  openStepKey.value = null;
  ordering.value = { kind: "applicant", medstopId, name: driver.value?.full_name ?? "Applicant" };
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="driver?.full_name ?? 'Applicant'"
      description="Everything needed before this driver can be hired, and who owes the next move."
    />

    <!-- The applicant's own read: loading, failure with a Retry, or the not-found answer that
         replaces the page (F21). The checklist below has its own read and its own states. -->
    <QueryState
      :loading="driverQ.isPending.value"
      :error="driverQ.isError.value ? driverQ.error.value : null"
      :retrying="driverQ.isFetching.value"
      loading-text="Loading the applicant…"
      error-text="Could not load the applicant."
      not-found-text="That applicant is not on file. They may have been removed, or the link is incomplete."
      @retry="driverQ.refetch()"
    />

    <template v-if="!missing">
      <HiringChecklistCard
        :driver-id="id"
        :checklist="checklistQ.data.value ?? null"
        :loading="checklistQ.isLoading.value"
        :error="checklistQ.error.value ? 'Could not load the hiring checklist.' : null"
        :retrying="checklistQ.isFetching.value"
        @retry="checklistQ.refetch()"
        @open="openRow($event)"
      />

      <!-- ⚠ Collapsed, and below the work. D-HUI3's rule that a row answers three questions only
           holds if the caveats have somewhere else to be; a page that explains itself in front of the
           work is the surface this rebuild replaced. -->
      <ExplainerPanel title="How this checklist is worked out">
        <p>
          Every row is derived from the records on file — an authorization, a qualification record, a
          packet mark — rather than from a box somebody ticked. Recording the evidence is what moves a
          step; there is nothing to mark as done.
        </p>
        <p>
          A step only appears when this system holds something that can prove it. Orientation videos,
          the orientation day and the handbook are part of the process and are not listed yet, which is
          why “ready to travel” stays open even when every row above is green.
        </p>
        <p>
          Steps are blocked only by law or by a rule the database enforces. Anything else can be done in
          whatever order suits the day.
        </p>
      </ExplainerPanel>

      <!-- Not a step: how an application ENDS without a hire (0238). See the header for why it did not
           go behind a row. -->
      <DispositionSection :driver-id="id" :driver-status="driver?.status ?? ''" />

      <HiringStepDrawer
        :open="openStep !== null"
        :step="openStep"
        :driver-id="id"
        :driver-status="driver?.status ?? ''"
        :invitation-id="invitationId"
        :identity="driver ?? null"
        @close="openStepKey = null"
        @review="openReview"
        @order-test="openOrder"
        @open-step="openStepKey = $event"
      />

      <!-- Reading the answers, correcting them, and approving them so the applicant can sign. The
           owner's words: *"complete application should be reviewable and editable on our side in
           dashboard and after that when approved and reviewed we should send it back to driver for
           signing"* — and until F4 there was no surface that showed a filed application at all. -->
      <ApplicationReviewDrawer
        :open="reviewing !== null"
        :invitation-id="reviewing"
        @close="reviewing = null"
      />

      <OrderTestDrawer :open="ordering !== null" :seed="ordering" @close="ordering = null" />

      <HireDrawer :open="hiring" :driver-id="id" :full-name="driver?.full_name ?? ''" @close="hiring = false" />
    </template>
  </div>
</template>
