<script setup lang="ts">
import { computed } from "vue";
import {
  AUTHORIZATION_PURPOSE_LABELS,
  hiringStep,
  isHiringRecordedActStep,
  type HiringStep,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { hiringStepStateBadge } from "@/lib/badges.recruiting";
import { hiringArtifactLink } from "@/features/recruitment/hiringArtifacts";
import { hiringDrawerBody } from "@/features/recruitment/hiringStepDrawers";
import { useSessionStore } from "@/stores/session";
import ApplicationInviteCard from "@/features/recruitment/ApplicationInviteCard.vue";
import AuthorizationsPanel from "@/features/recruitment/AuthorizationsPanel.vue";
import ApplicantIdentityCorrection from "@/features/recruitment/ApplicantIdentityCorrection.vue";
import SendApplicationPanel from "@/features/recruitment/SendApplicationPanel.vue";
import SendForSigningPanel from "@/features/recruitment/SendForSigningPanel.vue";
import EmploymentHistorySection from "@/features/recruitment/EmploymentHistorySection.vue";
import EmployerInquirySection from "@/features/recruitment/EmployerInquirySection.vue";
import PspRecordsSection from "@/features/recruitment/PspRecordsSection.vue";
import RecordedActPanel from "@/features/recruitment/RecordedActPanel.vue";
import VendorPortalCard from "@/features/recruitment/VendorPortalCard.vue";
import RoadTestPanel from "@/features/recruitment/RoadTestPanel.vue";
import HandbookPanel from "@/features/recruitment/HandbookPanel.vue";
import TravelPanel from "@/features/recruitment/TravelPanel.vue";
import OrientationVideosPanel from "@/features/recruitment/OrientationVideosPanel.vue";
import DrugTestPanel from "@/features/recruitment/DrugTestPanel.vue";
import MedstopTestCard from "@/features/recruitment/MedstopTestCard.vue";
import ClearinghouseConsentPanel from "@/features/recruitment/ClearinghouseConsentPanel.vue";
import EmployerCallsPanel from "@/features/recruitment/EmployerCallsPanel.vue";
import SelfieCheckPanel from "@/features/recruitment/SelfieCheckPanel.vue";
import ApplicantPhotoStrip from "@/features/recruitment/ApplicantPhotoStrip.vue";
import { useAuthorizationsQuery } from "@/features/recruitment/useAuthorizations";

/**
 * One step's work, inside the drawer of the row that holds it (HIRING-WORKFLOW-AUDIT §14, D-OF2).
 *
 * ⚠ Split out of `HiringStepDrawer.vue` on 2026-11-03, and every comment below came with it. The drawer
 * now opens a ROW, and a row can hold two steps — Part 1 and its permissions, the driving record and
 * the medical card, the application and its approval — so the body that used to BE the drawer is drawn
 * once per step. Nothing in it changed: each step still opens the same panel, says its own state and
 * names its own blocker, because each half is still its own fact (the hire refuses on the medical card,
 * the MVR order on the permissions).
 *
 * ── WHICH BODY ────────────────────────────────────────────────────────────────────────────────
 * `hiringStepDrawers.ts` maps the step to its body and carries the argument. D1 (2026-09-19) gave the
 * MVR, the Clearinghouse query and the drug test `RecordedActPanel`, which performs the act instead of
 * naming where it is performed.
 *
 * ⚠ No nested drawer. `ApplicationReviewDrawer` is itself a `SlideOver`, so the application body
 * EMITS `review` and the page swaps one drawer for the other — two dialogs open at once is a focus
 * trap inside a focus trap.
 */
const props = defineProps<{
  step: HiringStep;
  driverId: string;
  driverStatus: string;
  /** The live invitation, resolved by the page. Null before one exists. */
  invitationId: string | null;
  /** The driver row's date of birth and licence (AF3), read by the page; null while it loads. */
  identity?: { date_of_birth?: string | null; cdl_number?: string | null; cdl_state?: string | null; full_name?: string | null } | null;
}>();
const fullName = computed(() => props.identity?.full_name ?? null);

// `orderTest` (UX4): the drug-test step's Med-Stop card asks for the order drawer, which the page
// opens in place of this one — for the reason `review` is emitted rather than opened here.
// `openStep` (§9 P2, D-2): a body that cannot work yet hands the office to the row that comes first.
const emit = defineEmits<{
  review: [invitationId: string];
  orderTest: [order: { medstopId: string; zip: string | null }];
  openStep: [key: HiringStep["key"]];
}>();

/**
 * D-3 (§9 P2): the qualification file is written by `roster: manage` (the compliance routes' gate), so
 * its link is offered only to a role that can act there; anybody else is told who records it.
 * The same answer gates the hire (SP5), which is why the hired row can say who hires.
 */
const session = useSessionStore();
const canWriteFile = computed(() => session.can("roster"));

const body = computed(() => hiringDrawerBody(props.step.key));
const badge = computed(() => hiringStepStateBadge(props.step.state));

/**
 * Where the artifact is read, for the bodies whose whole job is to point at it.
 *
 * ⚠ Reads `step.evidence` and NOT `step.artifact`, and the difference is deliberate. B5 made
 * `artifact` null until the step is done, because naming a proof that does not exist is the failure
 * the artifact column was built to avoid. A drawer asks a different question: *where would I go to
 * do this*, which has the same answer before and after. So the row says nothing until there is
 * something, and the drawer says where regardless.
 */
const artifact = computed(() => {
  const evidence = props.step.evidence;
  if (!evidence) return null;
  return { ...evidence, ...hiringArtifactLink(evidence.table, props.driverId) };
});

/**
 * The step key, narrowed to one `RecordedActPanel` can file (D1).
 *
 * ⚠ Null rather than a cast. `hiringStepDrawers.ts` and `hiringEvidence.ts` are two files that have
 * to agree about which three steps are recordable, and a `step.key as HiringRecordedActStep` here
 * would compile on the day they stopped agreeing — which is the delay fuse this component's own
 * `Record<HiringStepKey, …>` was built to refuse.
 */
const recordedActStep = computed(() =>
  isHiringRecordedActStep(props.step.key) ? props.step.key : null,
);

const blockedBy = computed(() =>
  props.step.blockedBy ? hiringStep(props.step.blockedBy).label : null,
);
const advisedFirst = computed(() =>
  props.step.advisedFirst ? hiringStep(props.step.advisedFirst).label : null,
);

const driverId = computed(() => props.driverId);
const authorizationsQ = useAuthorizationsQuery(driverId);
</script>

<template>
<div class="space-y-6">
    <!-- The state, and the blocker in words when there is one. Same vocabulary as the row that
         opened this, from the same record — a drawer that re-worded the state would be a second
         answer to the question the row already answered. -->
    <div class="flex flex-wrap items-center gap-2">
      <span v-if="badge" :class="[BADGE_BASE, toneClass(badge.tone)]">
        <AppIcon :icon="badge.icon" class="size-3.5" aria-hidden="true" />
        {{ badge.label }}
      </span>
      <span v-if="blockedBy" class="text-xs text-ink-secondary">Needs: {{ blockedBy }}</span>
      <!-- §9 P4: the owner's order as advice — never a refusal. -->
      <span v-else-if="advisedFirst" class="text-xs text-ink-muted" data-testid="advised-first-line">
        Usually after: {{ advisedFirst }}
      </span>
      <span v-else-if="step.outstandingJurisdictions.length" class="text-xs text-ink-secondary">
        Still needed from: {{ step.outstandingJurisdictions.join(", ") }}
      </span>
      <!-- A-4: the link will never ask for these again, so the paper door below is the only way. -->
      <span v-else-if="step.paperOnlyPurposes.length" class="text-xs text-ink-secondary">
        Their link no longer asks for {{ step.paperOnlyPurposes.map((p) => AUTHORIZATION_PURPOSE_LABELS[p]).join(", ") }}.
        Record {{ step.paperOnlyPurposes.length === 1 ? "it" : "them" }} on paper below.
      </span>
    </div>

    <ApplicationInviteCard
      v-if="body === 'invitation'"
      :driver-id="driverId"
      :driver-status="driverStatus"
      @review="emit('review', $event)"
    />

    <!-- §7 (D-AW1): Part 1 is the applicant's, on their link, so the office's levers are the link's. -->
    <template v-else-if="body === 'intake'">
      <p class="text-xs text-ink-secondary">
        The applicant fills in Part 1 on their link: who they are, their address, their licences and
        photos. Check their photo against their licence, and read what they sent, below.
      </p>
      <ApplicationInviteCard
        :driver-id="driverId"
        :driver-status="driverStatus"
        @review="emit('review', $event)"
      />
      <!-- AW6 (§6.7): the one thing the office DOES on Part 1 — look at the selfie beside the licence. -->
      <SelfieCheckPanel :driver-id="driverId" />
      <!-- §14 D-OF6: every picture they sent, in the trucks' and trailers' gallery. -->
      <ApplicantPhotoStrip :driver-id="driverId" :full-name="fullName ?? 'Applicant'" />
    </template>

    <template v-else-if="body === 'authorizations'">
      <AuthorizationsPanel
        :invitation-id="invitationId"
        :driver-id="driverId"
        :rows="authorizationsQ.data.value ?? []"
        :loading="authorizationsQ.isLoading.value"
        :error="authorizationsQ.error.value ? 'Could not load the signed releases.' : null"
        :retrying="authorizationsQ.isFetching.value"
        @retry="authorizationsQ.refetch()"
      />
      <!-- AF3/D-AF8: identity is given with the permissions, and corrected here before screening. -->
      <ApplicantIdentityCorrection
        v-if="invitationId"
        :invitation-id="invitationId"
        :driver-id="driverId"
        :identity="identity ?? null"
      />
    </template>

    <SendApplicationPanel
      v-else-if="body === 'send_application' && invitationId"
      :invitation-id="invitationId"
      :driver-id="driverId"
    />

    <!-- D-AW14 (C3s3a): the packet is signed on the applicant's phone, on a link the office sends from the desk. -->
    <SendForSigningPanel
      v-else-if="body === 'packet' && invitationId"
      :invitation-id="invitationId"
      :driver-id="driverId"
    />

    <template v-else-if="body === 'application'">
      <!-- ⚠ The §391.21(b)(10) employment history is here because it IS the application's content.
           The §391.23 investigation OF that history used to be here too, parked, with a comment
           saying it was not one of D-HM9's steps despite being a §391.51 file requirement this
           product already builds. **Q-HM9 ruled it in on 2026-09-18**, so it has its own row and
           its own drawer (`body === 'investigation'`) and no longer rides along with this one. -->
      <!-- ⚠ The application itself is a button and not this drawer's body: `ApplicationReviewDrawer`
           is a `SlideOver` of its own AND lives in `features/apply`, which this feature may not
           import. Both facts say the same thing — hand it up to the page. -->
      <BaseButton v-if="invitationId" size="sm" variant="primary" @click="emit('review', invitationId)">
        Open the application
      </BaseButton>
      <p v-else class="text-xs text-ink-muted">No application yet. Send the invitation first.</p>

      <EmploymentHistorySection :driver-id="driverId" />
    </template>

    <!-- §14 D-OF2: approving is the last act of the review, pressed inside the application. -->
    <div v-else-if="body === 'approval'" class="space-y-3" data-testid="approval-body">
      <p v-if="step.state === 'done'" class="text-xs text-ink-secondary">Approved. It can be sent for signing.</p>
      <template v-else>
        <p class="text-xs text-ink-secondary">
          Read the application, correct what needs correcting, then approve it at the end of the review.
        </p>
        <BaseButton v-if="invitationId" size="sm" @click="emit('review', invitationId)">Review and approve</BaseButton>
      </template>
    </div>

    <PspRecordsSection v-else-if="body === 'psp'" :driver-id="driverId" />

    <!-- ⚠ D1. The step key is passed to a prop typed as the three steps this panel can file, so a
         row wired to `"record"` without a kind behind it is a TYPE error here rather than a form
         that posts and 400s. `recordedActStep` is where that narrowing happens. -->
    <template v-else-if="body === 'record' && recordedActStep">
      <!-- §14 D-OF8: the portal the act is done in (SambaSafety, the Clearinghouse), then the form below
           files what it gave back. Nothing for the drug test, which is Med-Stop's card. -->
      <VendorPortalCard :step="step.key" />
      <RecordedActPanel
        :driver-id="driverId"
        :step="recordedActStep"
        :done="step.state === 'done'"
        :outstanding-jurisdictions="step.outstandingJurisdictions"
      />
      <!-- C2b3: what the office arranges around two of the acts — never what proves them. The
           Clearinghouse row rests on the driver until their portal consent is recorded (D-AW5), so
           the row's own state is the consent's reading. -->
      <DrugTestPanel v-if="step.key === 'drug_test'" :driver-id="driverId" :done="step.state === 'done'" />
      <!-- MS2c (MEDSTOP-PLAN F-4): the same step as Med-Stop sees it — order, stage, expected by.
           Renders nothing for a carrier that has not connected Med-Stop. -->
      <MedstopTestCard v-if="step.key === 'drug_test'" :driver-id="driverId" @order="emit('orderTest', $event)" />
      <ClearinghouseConsentPanel
        v-if="step.key === 'clearinghouse'"
        :driver-id="driverId"
        :consented="step.state !== 'waiting_on_them'"
        :done="step.state === 'done'"
      />
    </template>

    <!-- §9 P1: the licence (RT-A1) and the step advised first (RT-A10) come from what this drawer holds. -->
    <RoadTestPanel
      v-else-if="body === 'road_test'"
      :driver-id="driverId"
      :done="step.state === 'done'"
      :invitation-id="invitationId"
      :identity="identity ?? null"
      :advised-first="step.key === 'road_test' && step.advisedFirst === 'drug_test' ? advisedFirst : null"
    />
    <HandbookPanel v-else-if="body === 'handbook'" :driver-id="driverId" :done="step.state === 'done'" />
    <TravelPanel v-else-if="body === 'travel'" :driver-id="driverId" />
    <OrientationVideosPanel v-else-if="body === 'videos'" :driver-id="driverId" />

    <!-- ⚠ Q-HM9's step. The section is unchanged — it was already the whole §391.23(c)(2) record,
         it simply had no row to open it. What the row adds is that the investigation is now
         COUNTED: it blocks Hired, so nobody reaches the end of the checklist with it untouched. -->
    <!-- D-AW8 (C2b3): the calls made before filing sit above the list filing copies them onto. -->
    <template v-else-if="body === 'investigation'">
      <EmployerCallsPanel :driver-id="driverId" />
      <EmployerInquirySection :driver-id="driverId" />
    </template>

    <!-- D-2 (§9 P2): sending the form or the packet needs the invitation's link — say so, and open
         the row that sends it, instead of a dead end. -->
    <div v-else-if="body === 'send_application' || body === 'packet'" class="space-y-3" data-testid="needs-invitation">
      <p class="text-xs text-ink-secondary">Send the invitation first — this goes out on the same link.</p>
      <BaseButton size="sm" @click="emit('openStep', 'invitation_sent')">Send the invitation</BaseButton>
    </div>

    <!-- The medical certificate (D-HM6): recorded in the qualification file, where the office keeps it.
         D-3: the link only for a role that can write there; anybody else is told who can. -->
    <div v-else-if="body === 'recorded_act'" class="space-y-3">
      <p class="text-xs text-ink-secondary">
        Record the {{ artifact?.label?.toLowerCase() ?? "record" }} in the driver's qualification file.
      </p>
      <BaseButton v-if="artifact?.to && canWriteFile" :to="artifact.to" size="sm">
        Open the driver's qualification file
      </BaseButton>
      <p v-else-if="artifact?.to" class="text-xs text-ink-muted" data-testid="ask-file-keeper">
        Ask a safety manager or an administrator to record it there.
      </p>
    </div>

    <!-- D-1 (§9 P2): the page opens HireDrawer for anybody who may close the application; this is what
         everybody else, and an application already closed, sees. §14 D-OF5: the hire itself is McLeod's. -->
    <div v-else-if="body === 'hire'" class="space-y-3" data-testid="hire-body">
      <p v-if="step.state === 'done'" class="text-xs text-ink-secondary">
        Closed. They are on the roster, and their McLeod driver record links to this file.
      </p>
      <p v-else class="text-xs text-ink-secondary">
        Closing the application puts them on the roster, so it needs roster access. Ask an administrator to
        close it, or to give your role roster access in Settings → Permissions.
      </p>
    </div>

    <p v-else class="text-xs text-ink-muted">Nothing to record here yet.</p>
  </div>
</template>
