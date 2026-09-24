<script setup lang="ts">
import { computed, ref, toRef, watch } from "vue";
import { AppButton as BaseButton, AppCallout } from "@silvicom/ui";
import { OPEN_SIGNING_WARNS_ON, hiringStep, packetDriverMarkCount, rolesThatManage } from "@silvicom/shared";
import { formatDate } from "@/lib/format";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import ApplicationLinkOnce from "@/features/recruitment/ApplicationLinkOnce.vue";
import { useApplicantChecklistQuery } from "@/features/recruitment/useApplicantChecklist";
import { useApplicationInvitesQuery } from "@/features/recruitment/useApplicationInvites";
import { useOpenSigning, type SigningOpened } from "@/features/recruitment/useOpenSigning";

/**
 * "Open signing on this screen" — the office's act at the desk (AF5, D-AF3, D-AF6).
 *
 * ── THE PRESS IS THE IN-PERSON ACT ────────────────────────────────────────────────────────────
 * D-AF6: whether the applicant is standing in the office is not something software can check; the
 * office pressing this, in the office, is the check. So the button opens the sign link in a new tab
 * ON THIS COMPUTER, for the applicant to sign in front of whoever pressed it, and the link is shown
 * once with copy for a tablet in the same room. ⚠ It is never emailed (see `applicationOpenSigning.ts`).
 *
 * ── IT SAYS WHAT IS OUTSTANDING BEFORE THE PRESS, AND OPENS ANYWAY ────────────────────────────
 * The warning is read from the SAME checklist query the page shows (`OPEN_SIGNING_WARNS_ON`), so the
 * sentence above the button and the rows beside the drawer cannot disagree, and the server's own
 * reading replaces it once the press has happened. The only refusal is the database's: not approved.
 *
 * ⚠ The tab is opened BEFORE the request and pointed at the link after it, because a browser only lets
 * a click open a window while it is still handling that click — a `window.open` after an `await` is a
 * pop-up, and pop-up blockers exist to stop exactly that.
 */
const props = defineProps<{ invitationId: string; driverId: string }>();

const session = useSessionStore();
const toast = useToastStore();
const open = useOpenSigning();
const checklistQ = useApplicantChecklistQuery(toRef(props, "driverId"));
const invitesQ = useApplicationInvitesQuery(toRef(props, "driverId"));

const invite = computed(() => invitesQ.data.value?.find((i) => i.id === props.invitationId) ?? null);
/** When it was first opened — 0369 keeps the first date, however many times it is opened again. */
const openedAt = computed(() => invite.value?.signing_opened_at ?? null);

const canOpen = computed(() => Boolean(session.role) && rolesThatManage("recruitment").includes(session.role!));
const result = ref<SigningOpened | null>(null);

/** The federal gates and road test not done yet, in the checklist's own words. */
const outstanding = computed(() =>
  (checklistQ.data.value?.steps ?? [])
    .filter((s) => OPEN_SIGNING_WARNS_ON.includes(s.key) && s.state !== "done")
    .map((s) => s.label),
);
const warnedAfter = computed(() => (result.value?.warnings ?? []).map((k) => hiringStep(k).label));

// The drawer swaps applicants without unmounting; one applicant's sign link must never greet the next.
watch(() => props.invitationId, () => { result.value = null; });

async function press(): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    result.value = await open.mutateAsync({ invitationId: props.invitationId, driverId: props.driverId });
    if (tab) {
      tab.opener = null;
      tab.location.href = result.value.link;
    }
  } catch (e) {
    tab?.close();
    toast.error("Could not open signing", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <section class="space-y-3">
    <p v-if="invite?.submitted_at" class="text-xs text-ink-secondary">
      Signed and filed {{ formatDate(invite.submitted_at) }}.
    </p>
    <p v-else-if="!invite?.approved_at" class="text-xs text-ink-secondary">
      The applicant signs the packet — {{ packetDriverMarkCount() }} places — in the office. Approve the
      application first; signing opens once they are here.
    </p>
    <template v-else>
      <p v-if="openedAt && !result" class="text-xs text-ink-secondary">
        Opened {{ formatDate(openedAt) }}. Opening again makes a new sign link, and the one before stops working.
      </p>
      <p v-else-if="!result" class="text-xs text-ink-secondary">
        Approved. When the applicant is here, open signing on this screen and hand it to them —
        {{ packetDriverMarkCount() }} places in the packet.
      </p>

      <AppCallout v-if="!result && outstanding.length > 0" tone="caution">
        Still outstanding: {{ outstanding.join(", ") }}. You can open signing now; these stay on the checklist.
      </AppCallout>

      <template v-if="result">
        <AppCallout v-if="warnedAfter.length > 0" tone="caution">
          Opened with these still outstanding: {{ warnedAfter.join(", ") }}.
        </AppCallout>
        <ApplicationLinkOnce
          :link="result.link"
          heading="Opened in a new tab — hand this screen to the applicant, or open this link on a tablet in the room"
          if-lost="open signing again if it is lost; that makes a new link."
        />
      </template>

      <BaseButton v-if="canOpen" size="sm" :variant="result || openedAt ? 'secondary' : 'primary'"
        :disabled="open.isPending.value" @click="press">
        {{ open.isPending.value ? "Opening…" : result || openedAt ? "Open signing again" : "Open signing on this screen" }}
      </BaseButton>
      <p v-else class="text-xs text-ink-muted">Somebody who manages recruitment opens signing.</p>
    </template>
  </section>
</template>
