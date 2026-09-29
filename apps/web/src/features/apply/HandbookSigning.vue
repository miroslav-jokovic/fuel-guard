<script setup lang="ts">
import { computed, ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { HANDBOOK_PLACEMENTS, type HandbookPlacementId, type LinkHandbookStatus } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import PermissionDocumentView from "@/features/apply/signing/PermissionDocumentView.vue";
import { publicFetch } from "./useApplication";
import { useApplyScreen } from "./useScreenEvents";
import { APPLY_COPY } from "./strings";

/**
 * The driver handbook, signed on the applicant's own link (HANDBOOK-SIGNING-PLAN.md HB4; D-HB1).
 *
 * ── WHAT IT SHOWS, AND WHEN ───────────────────────────────────────────────────────────────────
 * Nothing until the application is filed (the link's `handbook` is null). Then, until the office
 * opens it, where it happens and a button to look again — never a poll, because several drivers in
 * one office share one address and the intake's bucket is 20 a minute. Once open: the carrier's
 * handbook, every page, from the same viewer the permissions use, and its five places, signed one at
 * a time with the signature the driver adopted on screen 13 (D-AW15 — the server applies it; nothing is
 * typed here). Once filed: their signed copy.
 *
 * ⚠ The document is re-read after each place, by version in the address, so the driver sees their
 * signature land where they signed. Those reads ride the ceremony's per-link bucket.
 *
 * ── C0b's self-adoption is gone (C3s2a) ────────────────────────────────────────────────────────
 * A handbook used to adopt its own signature when the application had been filed before its packet was
 * signed on screen (A-1). Every link now adopts once, before the permissions, and P2 purged the one
 * invitation the workaround existed for.
 */
const props = defineProps<{ token: string; carrier: string; handbook: LinkHandbookStatus }>();

// A screen of its own while the places are being signed; before the office opens it and after, it is
// part of the filed page (`filed`, AW14).
useApplyScreen(() => (props.handbook.openedAt && !props.handbook.driverComplete ? "handbook" : null));

const qc = useQueryClient();
const places = HANDBOOK_PLACEMENTS.filter((p) => p.party === "driver");
const signed = computed(() => new Set<string>(props.handbook.driverSigned));
const busy = ref<HandbookPlacementId | null>(null);
const failed = ref(false);
const unreadable = ref(false);
const checking = ref(false);
const downloadFailed = ref(false);
/** The server's own sentence for a refusal the driver can act on, else the generic one. */
const failedMessage = ref<string | null>(null);

// The count of signed places is in the address, so the viewer's `:key` reloads after each one.
const src = computed(() => `/api/public/application/${props.token}/handbook.pdf?v=${props.handbook.driverSigned.length}`);

const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: ["apply", props.token] });

async function checkAgain(): Promise<void> {
  checking.value = true;
  try {
    await refresh();
  } finally {
    checking.value = false;
  }
}

async function sign(id: HandbookPlacementId): Promise<void> {
  busy.value = id;
  failed.value = false;
  failedMessage.value = null;
  try {
    await publicFetch(`/${props.token}/handbook/mark`, {
      method: "POST",
      // A-6: the text this page shows; the server refuses a place read under another one.
      body: JSON.stringify({ placement_id: id, esign_consent: true, handbook_version: props.handbook.version }),
    });
    await refresh();
  } catch (e) {
    failed.value = true;
    // The signature changed partway through the handbook (C3s2a): the server's own sentence says what to do.
    if ((e as { code?: string }).code === "adoption_changed_mid_document") failedMessage.value = (e as Error).message;
  } finally {
    busy.value = null;
  }
}

/** The signed copy, fetched at the press and opened — `ApplicationFiledCard`'s idiom. */
async function download(): Promise<void> {
  downloadFailed.value = false;
  try {
    const res = await fetch(`/api/public/application/${props.token}/handbook.pdf`);
    if (!res.ok) throw new Error("not ok");
    const url = URL.createObjectURL(await res.blob());
    if (!globalThis.open(url, "_blank", "noopener")) downloadFailed.value = true;
  } catch {
    downloadFailed.value = true;
  }
}
</script>

<template>
  <section class="mt-8 space-y-4 border-t border-edge pt-6">
    <h2 class="text-base font-semibold text-ink">{{ APPLY_COPY.handbook.heading }}</h2>

    <template v-if="handbook.filedAt">
      <p class="text-sm text-ink-muted">{{ APPLY_COPY.handbook.filed }}</p>
      <BaseButton variant="secondary" @click="download">{{ APPLY_COPY.handbook.download }}</BaseButton>
      <p v-if="downloadFailed" class="text-sm text-ink-secondary">{{ APPLY_COPY.handbook.downloadFailed }}</p>
    </template>

    <template v-else-if="!handbook.openedAt">
      <p class="text-sm text-ink-muted">{{ APPLY_COPY.handbook.waiting(carrier) }}</p>
      <BaseButton variant="secondary" :disabled="checking" @click="checkAgain">
        {{ checking ? APPLY_COPY.handbook.checking : APPLY_COPY.handbook.checkAgain }}
      </BaseButton>
    </template>

    <template v-else>
      <p class="text-sm text-ink-muted">{{ APPLY_COPY.handbook.intro }}</p>
      <PermissionDocumentView
        v-if="!unreadable"
        :key="src"
        :src="src"
        :label="APPLY_COPY.handbook.documentLabel"
        @failed="unreadable = true"
      />
      <p v-else class="text-sm text-ink-secondary">{{ APPLY_COPY.handbook.unavailable }}</p>

      <p class="text-sm font-medium text-ink">
        {{ APPLY_COPY.handbook.progress(handbook.driverSigned.length, places.length) }}
      </p>
      <ol class="divide-y divide-edge border-y border-edge">
        <li v-for="(place, i) in places" :key="place.id" class="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <p class="text-xs text-ink-muted">{{ APPLY_COPY.handbook.place(i + 1, places.length) }}</p>
            <p class="text-sm text-ink">{{ place.what }}</p>
          </div>
          <span v-if="signed.has(place.id)" class="text-sm text-ink-secondary">{{ APPLY_COPY.handbook.signed }}</span>
          <BaseButton v-else variant="primary" size="sm" :disabled="busy !== null" @click="sign(place.id)">
            {{ busy === place.id ? APPLY_COPY.handbook.signing : APPLY_COPY.handbook.sign }}
          </BaseButton>
        </li>
      </ol>
      <p v-if="failed" class="text-sm text-ink-secondary">{{ failedMessage ?? APPLY_COPY.handbook.signFailed }}</p>
      <p v-if="handbook.driverComplete" class="text-sm text-ink">{{ APPLY_COPY.handbook.allSigned(carrier) }}</p>
    </template>
  </section>
</template>
