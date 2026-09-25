<script setup lang="ts">
import { ref, type Ref } from "vue";
import { AppButton as BaseButton, AppCard as BaseCard } from "@silvicom/ui";
import { formatDate } from "@/lib/format";
import { fetchApplicantCopy, fetchRoadTestCertificate, type ApplicantCopy } from "./useApplication";
import { APPLY_COPY } from "./strings";

/**
 * What happened, once the application is certified and filed (A1, X8/D-AX9).
 *
 * ⚠ It says what HAPPENED, not what will. The copy here used to promise a later signing step on a
 * link that submitting had just closed — the defect A1 fixed by making the link a session rather than
 * a fuse. There is no later step to promise now: the signature is given on the visit before this one.
 *
 * Split out of `ApplyPage.vue` on 2026-09-11 when that file reached the 500-line budget. It is a good
 * seam rather than a convenient one: the download owns its own two flags and its own failure
 * sentence, and none of it has anything to do with filling in a form.
 *
 * ── THE ROAD-TEST CERTIFICATE (RT4, §391.31(g)) ───────────────────────────────────────────────
 * Offered here, and only here, because of where step 13 sits: the road test is given in the office
 * before the packet is signed, so by the time this card is the page the certificate is already filed
 * — and a test recorded later shows up on the next load. Shown only when the link says there is one,
 * so a driver who has not passed is never handed a button that answers "not yet".
 */
const props = defineProps<{
  token: string;
  carrier: string;
  roadTestCertificate: { testedOn: string } | null;
}>();

const working = ref(false);
const failed = ref(false);
const certificateWorking = ref(false);
const certificateFailed = ref(false);

/**
 * Ask for a fresh link and open it.
 *
 * `window.open` rather than an `<a download>` with a stored href: the URL is signed for five minutes
 * and is fetched at the moment of the press, so there is never a stale one on the page waiting to
 * disappoint somebody. A popup blocked by the browser is indistinguishable here from a failure, and
 * both get the same sentence — which names the other way to get the document.
 */
async function openFresh(
  fetchCopy: (token: string) => Promise<ApplicantCopy>,
  busy: Ref<boolean>,
  refused: Ref<boolean>,
): Promise<void> {
  busy.value = true;
  refused.value = false;
  try {
    const copy = await fetchCopy(props.token);
    const opened = globalThis.open(copy.url, "_blank", "noopener");
    if (!opened) refused.value = true;
  } catch {
    refused.value = true;
  } finally {
    busy.value = false;
  }
}

const download = () => openFresh(fetchApplicantCopy, working, failed);
const downloadCertificate = () => openFresh(fetchRoadTestCertificate, certificateWorking, certificateFailed);
</script>

<template>
  <BaseCard>
    <h1 class="text-lg font-semibold text-ink">{{ APPLY_COPY.done.heading }}</h1>
    <p class="mt-2 text-sm text-ink-muted">{{ APPLY_COPY.done.body(carrier) }}</p>
    <p class="mt-2 text-sm text-ink-muted">{{ APPLY_COPY.done.reopen }}</p>

    <!-- X8/D-AX9. The consent the driver gave promises a copy at no charge; until now the only way
         to get one was to ask the carrier. -->
    <div class="mt-6 space-y-2">
      <BaseButton variant="secondary" :disabled="working" @click="download">
        {{ working ? APPLY_COPY.done.downloading : APPLY_COPY.done.download }}
      </BaseButton>
      <p class="text-xs text-ink-muted">{{ APPLY_COPY.done.downloadNote }}</p>
      <p v-if="failed" class="text-sm text-ink-secondary">{{ APPLY_COPY.done.downloadFailed }}</p>
    </div>

    <!-- RT4, §391.31(g): "a copy of the certificate shall be given to the person who was examined". -->
    <div v-if="roadTestCertificate" class="mt-6 space-y-2">
      <BaseButton variant="secondary" :disabled="certificateWorking" @click="downloadCertificate">
        {{ certificateWorking ? APPLY_COPY.done.certificateDownloading : APPLY_COPY.done.certificate }}
      </BaseButton>
      <p class="text-xs text-ink-muted">
        {{ APPLY_COPY.done.certificateNote(formatDate(roadTestCertificate.testedOn)) }}
      </p>
      <p v-if="certificateFailed" class="text-sm text-ink-secondary">{{ APPLY_COPY.done.certificateFailed }}</p>
    </div>
  </BaseCard>
</template>
