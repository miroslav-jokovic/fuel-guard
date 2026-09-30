<script setup lang="ts">
import { ref } from "vue";
import { AppTabs, type TabItem } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import RolesTab from "@/features/permissions/RolesTab.vue";
import PeopleTab from "@/features/permissions/PeopleTab.vue";
import WhoHasAccessTab from "@/features/permissions/WhoHasAccessTab.vue";
import SlideOver from "@/components/SlideOver.vue";
import StepUpPrompt from "@/components/StepUpPrompt.vue";
import { useStepUpRetry } from "@/composables/useStepUpRetry";

/**
 * Permissions (SURFACE-ENTITLEMENTS-PLAN.md S6; EDITABLE-PERMISSIONS-PLAN.md P5).
 *
 * ── WHAT THIS PAGE BECAME ───────────────────────────────────────────────────────────────────────
 * P0 shipped it read-only, with a card saying in as many words that the matrix could not be changed
 * here — honest at the time, because the matrix was a compile-time literal mirrored into ~89 RLS
 * predicates and an "edit" control would have changed what the UI hid and nothing about what the
 * database allowed. S1–S5 removed that reason: an org's answers now live in four tables, travel in
 * the JWT (sections) and in `/api/me` (screens), and are enforced by RLS, the API, the router guard
 * and the sidebar. Until this step the only way to write one was a `PUT` with curl.
 *
 * ── TWO TABS, BECAUSE THEY ANSWER TWO DIFFERENT QUESTIONS ───────────────────────────────────────
 * Roles is the default setup — the 7 × 11 matrix and the screens each role opens. People is the
 * custom setup the owner asked for on 2026-09-02, and it is not a shortcut into the same rows: a
 * person's answer outlives their role changing underneath them, and it is the only layer where
 * "shown" is a real answer rather than a reset (D-SURF6, D-SURF7).
 *
 * ── A THIRD TAB, THE SAME QUESTION ASKED BACKWARDS (SP10, Q-SET10) ───────────────────────────
 * "Who has access" answers "who can open Card control" — the question an access review asks first,
 * which the two tabs above can only answer one member at a time. It edits nothing: every change is
 * still made on Roles or People, and this view recomputes from the same layers when one is.
 *
 * ── WHY THE PAGE NO LONGER EXPLAINS ITSELF AT THE TOP ───────────────────────────────────────────
 * The first editable version opened with a paragraph on the two staleness contracts and closed with
 * a paragraph on what the page does not govern. Both were true and both were in the wrong place: the
 * staleness sentence belongs beside the control it qualifies (each card's header says its own), and
 * the "outside this page" list is a reference an admin needs once, so it folds away at the foot.
 *
 * ── WHAT THIS PAGE DOES NOT GOVERN, SAID OUT LOUD ───────────────────────────────────────────────
 * S7 measured it: every one of the API's 351 routes either derives its answer from the matrix,
 * carries a role gate an org cannot reach by design, or is recorded in `testing/routeLedger.ts` with
 * the argument for why it is open — and two fitness functions fail the build if a new one appears
 * unexamined. What remains outside this page is therefore a short, named list rather than an unknown,
 * and the disclosure below says it in the reader's words.
 */
const tabs: TabItem[] = [
  { value: "roles", label: "Roles" },
  { value: "people", label: "People" },
  { value: "access", label: "Who has access" },
];
const tab = ref("roles");

/**
 * ── EVERY CHANGE HERE ASKS FOR THE PASSWORD, ONCE PER FIVE MINUTES (SP9) ─────────────────────────
 * Q-SET8 (a), ruled 2026-09-30: each write on this page is behind the same step-up card control
 * uses, because a stolen admin session that can edit this matrix can hand anyone every other
 * capability in the product. ONE prompt for the page, not one per tab: both tabs write, and the
 * token `lib/stepUp.ts` holds covers either for its five minutes, so a second prompt would ask for a
 * password the admin has already given. It opens in a drawer so the tab that asked stays mounted and
 * its write re-runs as it was — the same `useStepUpRetry` MemberPasswordResetDrawer uses.
 */
const { stepUpFor, holdForStepUp, confirmed, cancel } = useStepUpRetry();
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      description="What each role can reach, what one person can reach, and exactly what they see in the sidebar."
    />

    <AppTabs v-model="tab" :tabs="tabs" label="Permission views" id-prefix="permissions" />

    <div v-if="tab === 'roles'" id="permissions-panel-roles" role="tabpanel" aria-labelledby="permissions-tab-roles">
      <RolesTab :hold-for-step-up="holdForStepUp" />
    </div>
    <div v-else-if="tab === 'people'" id="permissions-panel-people" role="tabpanel" aria-labelledby="permissions-tab-people">
      <PeopleTab :hold-for-step-up="holdForStepUp" />
    </div>
    <div v-else id="permissions-panel-access" role="tabpanel" aria-labelledby="permissions-tab-access">
      <WhoHasAccessTab :hold-for-step-up="holdForStepUp" />
    </div>

    <SlideOver :open="stepUpFor !== null" title="Confirm your password" @close="cancel">
      <StepUpPrompt v-if="stepUpFor" :reason="stepUpFor" @confirmed="confirmed" @cancel="cancel" />
    </SlideOver>

    <details class="border-t border-edge-subtle pt-4">
      <summary class="cursor-pointer text-sm font-medium text-ink-muted">What this page does not decide</summary>
      <p class="mt-2 max-w-prose text-sm text-ink-muted">
        A few acts are granted by name rather than by section — issuing a driver's app login, merging
        two driver records — because taking them away from one person should not depend on a whole
        section. A few endpoints are open on purpose, such as accepting an invitation before you
        belong to an organisation. Each one is recorded with its reason; nothing else in the product
        decides access anywhere but here.
      </p>
    </details>
  </div>
</template>
