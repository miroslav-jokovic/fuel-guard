<script setup lang="ts">
import { computed, ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { HANDBOOK_PLACEMENTS, type LinkHandbookStatus } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import PermissionDocumentView from "@/features/apply/signing/PermissionDocumentView.vue";
import { envelopePlaces, handbookPlaceNumber } from "@/features/apply/signing/envelope";
import { publicFetch } from "./useApplication";
import { useApplyScreen } from "./useScreenEvents";
import { APPLY_COPY } from "./strings";

/**
 * The driver handbook, signed on the applicant's own link (HANDBOOK-SIGNING-PLAN.md HB4; D-HB1) — the
 * last places of the envelope's walk (D-AW16, C3s4b).
 *
 * ── ONE PLACE AT A TIME, CONTINUING THE PACKET'S COUNT (C3s4b) ────────────────────────────────
 * Until C3s4b this was a flat list of five buttons in any order, reached after the office pressed
 * "Open handbook signing" at the desk. The envelope the office sent opens it now, so the driver who
 * files the application goes straight on to it, and it is walked as the packet is: one place, the
 * sentence agreed to there, one button — and "Place 15 of 19", the packet's places counted first
 * (`envelope.ts`), so the number the driver has been watching carries on rather than starting again.
 * The carrier's handbook is shown whole above the place, from the viewer the permissions use: it is
 * flowed text with no fixed page per place, so there is no page to jump to.
 *
 * ⚠ **The current place is derived, never a cursor** — the first driver place neither the server nor
 * this tab has signed, the packet walk's rule and for its reason: the bundle is refetched on focus, and
 * a stored index would step over a place the moment the list it points into changed
 * ([[a-cursor-into-a-refetched-list-strands-the-walk]]).
 *
 * ⚠ The document is re-read after each place, by count in the address, so the driver sees their
 * signature land where they signed. Five reads ride the ceremony's per-link bucket.
 *
 * Each place is signed with the signature the driver adopted on screen 13 (D-AW15) — the server applies
 * it; nothing is typed here. Once every place is signed the office countersigns, and once it is filed
 * this is their signed copy.
 */
const props = defineProps<{
  token: string;
  carrier: string;
  handbook: LinkHandbookStatus;
  /** This applicant's packet places, all signed by now — the first part of the envelope's count. */
  packetPlaces: number;
}>();

const copy = APPLY_COPY.handbook;
const qc = useQueryClient();
const places = HANDBOOK_PLACEMENTS.filter((p) => p.party === "driver");
/** Places this tab signed that the served status may not carry yet. */
const signedHere = ref<Set<string>>(new Set());
const signed = computed(() => new Set<string>([...props.handbook.driverSigned, ...signedHere.value]));
const current = computed(() => places.find((p) => !signed.value.has(p.id)) ?? null);

// A screen of its own while places are left; after that it is part of the filed page (`filed`, AW14).
useApplyScreen(() => (current.value && !props.handbook.filedAt ? "handbook" : null));

const working = ref(false);
const failed = ref(false);
const unreadable = ref(false);
const downloadFailed = ref(false);
/** The server's own sentence for a refusal the driver can act on, else the generic one. */
const failedMessage = ref<string | null>(null);

// The count of signed places is in the address, so the viewer's `:key` reloads after each one.
const src = computed(() => `/api/public/application/${props.token}/handbook.pdf?v=${signed.value.size}`);

async function sign(): Promise<void> {
  const place = current.value;
  if (!place || working.value) return;
  working.value = true;
  failed.value = false;
  failedMessage.value = null;
  try {
    await publicFetch(`/${props.token}/handbook/mark`, {
      method: "POST",
      // A-6: the text this page shows; the server refuses a place read under another one.
      body: JSON.stringify({ placement_id: place.id, esign_consent: true, handbook_version: props.handbook.version }),
    });
    signedHere.value = new Set(signedHere.value).add(place.id);
    await qc.invalidateQueries({ queryKey: ["apply", props.token] });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "handbook_place_already_signed") {
      // A double tap, or the link open twice: the place is signed, so move on (the packet walk's rule).
      signedHere.value = new Set(signedHere.value).add(place.id);
    } else {
      failed.value = true;
      // The signature changed partway through the handbook (C3s2a): the server's own sentence says what to do.
      if (code === "adoption_changed_mid_document") failedMessage.value = (e as Error).message;
    }
  } finally {
    working.value = false;
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
  <section class="space-y-4">
    <template v-if="handbook.filedAt">
      <h2 class="text-base font-semibold text-ink">{{ copy.heading }}</h2>
      <p class="text-sm text-ink-muted">{{ copy.filed }}</p>
      <BaseButton variant="secondary" @click="download">{{ copy.download }}</BaseButton>
      <p v-if="downloadFailed" class="text-sm text-ink-secondary">{{ copy.downloadFailed }}</p>
    </template>

    <template v-else-if="current">
      <div class="flex items-baseline justify-between gap-4">
        <h2 class="text-base font-semibold text-ink">{{ copy.heading }}</h2>
        <span class="text-xs text-ink-muted">
          {{ copy.place(handbookPlaceNumber(packetPlaces, signed.size), envelopePlaces(packetPlaces)) }}
        </span>
      </div>
      <p class="text-sm text-ink-muted">{{ copy.intro }}</p>
      <PermissionDocumentView
        v-if="!unreadable"
        :key="src"
        :src="src"
        :label="copy.documentLabel"
        @failed="unreadable = true"
      />
      <p v-else class="text-sm text-ink-secondary">{{ copy.unavailable }}</p>

      <!-- The carrier's own sentence for this place, and the only thing being agreed to here. -->
      <p class="rounded-surface bg-surface-muted p-4 text-base text-ink">{{ current.what }}</p>

      <p v-if="failed" class="text-sm text-ink-secondary">{{ failedMessage ?? copy.signFailed }}</p>
      <div class="flex justify-end">
        <BaseButton variant="primary" :disabled="working" @click="sign">
          {{ working ? copy.signing : copy.sign }}
        </BaseButton>
      </div>
    </template>

    <template v-else>
      <h2 class="text-base font-semibold text-ink">{{ copy.heading }}</h2>
      <p class="text-sm text-ink">{{ copy.allSigned(carrier) }}</p>
    </template>
  </section>
</template>
