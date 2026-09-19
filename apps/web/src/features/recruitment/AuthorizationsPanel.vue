<script setup lang="ts">
import { computed } from "vue";
import {
  APPLICATION_RELEASE_ORDER,
  AUTHORIZATION_PURPOSE_LABELS,
  liveAuthorization,
  type AuthorizationPurpose,
} from "@silvicom/shared";
import { AppButton, AppIcon } from "@silvicom/ui";
import { CheckCircleIcon, ClockIcon } from "@silvicom/ui/icons";
import { formatDateTime } from "@/lib/format";
import { openPdf } from "@/lib/documentDownload";
import { useToastStore } from "@/stores/toast";
import type { AuthorizationDetail } from "@/features/recruitment/useAuthorizations";

/**
 * The four releases an applicant signed, with the wording version each one was signed against
 * (B6, and the answer to Q-HUI6).
 *
 * ── WHAT THIS IS FOR, WHICH IS NOT "COMPLETENESS" ─────────────────────────────────────────────
 * Every screening act the carrier performs rests on one of these: `SCREENING_PREREQUISITES` names
 * the FCRA disclosure as what makes ordering an MVR lawful, and the previous-employer release as
 * what makes a §391.23 inquiry lawful. Until B6 the office had **no screen at all** that showed
 * them — the read endpoint existed and nothing called it. So the carrier was relying on four
 * documents it could not produce.
 *
 * ⚠ **The VERSION is the load-bearing column**, not the tick. FCRA §604(b)(2) is about what the
 * person was shown, so a dispute is settled by *which wording* they accepted, and
 * `disclosure_version` is the only field that answers it. A panel that showed "signed ✓" and a date
 * would look complete and be useless on the one day it is needed.
 *
 * ── LIVE, NOT LATEST (D-REC3) ─────────────────────────────────────────────────────────────────
 * ⚠ These rows are APPEND-ONLY and a revocation is a new row pointing at the grant it revokes, so
 * "is this release in force" is a fold rather than a column read. `liveAuthorization` in
 * `packages/shared` is that fold and is the same one `hiringChecklist` uses for the step's state —
 * reading `rows[0]` here would let this panel say *signed* about a release the checklist calls
 * outstanding, which is the D-HM2 disagreement in miniature.
 *
 * ⚠ **Four, from `APPLICATION_RELEASE_ORDER` and not from `AUTHORIZATION_PURPOSES`.** The fifth
 * purpose, `clearinghouse`, is consented to inside FMCSA's own portal (D-REC4) and no applicant
 * ever signs it here; listing it would show a permanently missing release for a consent the carrier
 * is not supposed to hold.
 */
const props = defineProps<{
  rows: readonly AuthorizationDetail[];
  loading?: boolean;
  error?: string | null;
  /**
   * The live invitation, for the printable copy (B2). Null before one exists.
   *
   * ⚠ The panel is DRIVER-keyed and the document is INVITATION-keyed, and that is the decision rather
   * than an inconsistency: a recruiter looking at a person wants every release that person ever
   * signed, and a printed instrument belongs to one hire — a rehire's older signatures belong to
   * their own application, and a document spanning two invitations could not be dated.
   */
  invitationId?: string | null;
}>();

const toast = useToastStore();

/**
 * Printing what the applicant has signed (B2).
 *
 * ── WHY THE OFFICE NEEDS PAPER FOR THIS AT ALL ────────────────────────────────────────────────
 * Every screening act rests on one of these releases (`SCREENING_PREREQUISITES`), and until B2 the
 * only place they existed was this panel — a screen, behind a login, inside a drawer. So a carrier
 * asked to produce the FCRA disclosure somebody signed had four instruments it could not hand over.
 * The application's own PDF carries them and does not exist until the driver certifies, which can be
 * a fortnight later or never.
 *
 * ⚠ Shown only once something has been signed, because the API refuses an empty one in a sentence
 * rather than printing a sheet of "Not signed yet" rows — a button whose only outcome is a refusal is
 * worse than no button. The consent-only moment (they agreed to sign electronically and have signed
 * nothing else) lasts seconds and is the one state this hides a real document in.
 */
const canPrint = computed(() => Boolean(props.invitationId) && props.rows.length > 0);

async function openPermissions(): Promise<void> {
  try {
    /**
     * ⚠ **A new tab, and it should not stay one.** B8 teaches `DocumentPreview.vue` — this repo's
     * sanctioned viewer — to take a document the API renders on demand rather than a stored
     * `DocumentRow`, which is exactly what this is; it was an open PR when B2 shipped, so this uses
     * the path that exists on `main` today. **When B8 lands, this becomes that viewer**: it is one
     * prop and a modal, not a rewrite, and leaving it a new tab afterwards would mean the office
     * reads one rendered PDF beside the record and another one somewhere else entirely.
     */
    await openPdf(
      `/api/recruitment/applications/${encodeURIComponent(props.invitationId ?? "")}/permissions.pdf`,
    );
  } catch (e) {
    toast.push("error", e instanceof Error ? e.message : "That could not be opened.");
  }
}

interface ReleaseRow {
  purpose: AuthorizationPurpose;
  label: string;
  live: AuthorizationDetail | null;
}

const releases = computed<ReleaseRow[]>(() =>
  APPLICATION_RELEASE_ORDER.map((purpose) => ({
    purpose,
    label: AUTHORIZATION_PURPOSE_LABELS[purpose],
    // `liveAuthorization` takes the narrow `AuthorizationRow`; these rows are a superset of it.
    live: (liveAuthorization(props.rows, purpose) as AuthorizationDetail | null) ?? null,
  })),
);
</script>

<template>
  <div class="space-y-4">
    <p v-if="loading" class="text-xs text-ink-muted">Loading the signed releases…</p>
    <p v-else-if="error" class="text-xs text-danger-700">{{ error }}</p>

    <ul v-else class="divide-y divide-edge border-y border-edge">
      <li v-for="release in releases" :key="release.purpose" class="flex items-start gap-3 py-3">
        <AppIcon
          :icon="release.live ? CheckCircleIcon : ClockIcon"
          class="mt-0.5 size-4 shrink-0"
          :class="release.live ? 'text-success-600' : 'text-ink-muted'"
          aria-hidden="true"
        />
        <div class="min-w-0 flex-1">
          <p class="text-xs font-medium text-ink">{{ release.label }}</p>
          <!-- ⚠ The version, always, and never only the date. A dispute under FCRA §604(b)(2) is
               about the wording somebody was shown, and this is the only field that answers it. -->
          <p v-if="release.live" class="mt-0.5 text-2xs text-ink-secondary">
            Signed {{ formatDateTime(release.live.accepted_at) }} ·
            wording {{ release.live.disclosure_version }}
            <span v-if="release.live.signed_name"> · typed “{{ release.live.signed_name }}”</span>
          </p>
          <p v-else class="mt-0.5 text-2xs text-ink-muted">Not signed yet.</p>
        </div>
      </li>
    </ul>

    <AppButton v-if="canPrint" size="sm" variant="secondary" @click="openPermissions">
      Print what they have signed
    </AppButton>

    <p class="text-2xs text-ink-tertiary">
      The Clearinghouse query consent is not listed: it is given inside the FMCSA portal, not here.
    </p>
  </div>
</template>
