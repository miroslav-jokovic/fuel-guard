<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { HANDBOOK_PLACEMENTS, type HandbookPlacementId, type LinkHandbookStatus } from "@silvicom/shared";
import { AppButton as BaseButton } from "@silvicom/ui";
import PacketAdoption from "@/features/apply/signing/PacketAdoption.vue";
import PermissionDocumentView from "@/features/apply/signing/PermissionDocumentView.vue";
import { useHandbookAdoption } from "@/features/apply/signing/useHandbookAdoption";
import { publicFetch } from "./useApplication";
import { APPLY_COPY } from "./strings";

/**
 * The driver handbook, signed on the applicant's own link (HANDBOOK-SIGNING-PLAN.md HB4; D-HB1).
 *
 * ── WHAT IT SHOWS, AND WHEN ───────────────────────────────────────────────────────────────────
 * Nothing until the application is filed (the link's `handbook` is null). Then, until the office
 * opens it, where it happens and a button to look again — never a poll, because several drivers in
 * one office share one address and the intake's bucket is 20 a minute. Once open: the carrier's
 * handbook, every page, from the same viewer the permissions use, and its five places, signed one at
 * a time with the signature the driver adopted for the application (the server applies it; nothing is
 * typed here). Once filed: their signed copy.
 *
 * ⚠ The document is re-read after each place, by version in the address, so the driver sees their
 * signature land where they signed. Those reads ride the ceremony's per-link bucket.
 *
 * ── ⚠ WORKAROUND: A HANDBOOK THAT ADOPTS ITS OWN SIGNATURE (A-1, C0b; removed by C3s) ─────────────
 * When the server says `adoption.required` — the application was filed before its packet was signed
 * on screen, so there is no adopted signature to borrow — the places wait behind the packet's own
 * adoption screens, and the first place carries the typed name. See `useHandbookAdoption.ts`.
 */
const props = defineProps<{ token: string; carrier: string; handbook: LinkHandbookStatus }>();

const qc = useQueryClient();
const places = HANDBOOK_PLACEMENTS.filter((p) => p.party === "driver");
const signed = computed(() => new Set<string>(props.handbook.driverSigned));
const busy = ref<HandbookPlacementId | null>(null);
const failed = ref(false);
const unreadable = ref(false);
const checking = ref(false);
const downloadFailed = ref(false);
/** The server's own sentence for a refusal the driver can act on (adopt first), else the generic one. */
const failedMessage = ref<string | null>(null);

const selfAdopting = computed(() => props.handbook.adoption?.required === true);
const adoption = useHandbookAdoption(computed(() => props.token), computed(() => props.handbook));
const adopting = computed(() => selfAdopting.value && (adoption.state.value === "adopting" || adoption.state.value === "confirming"));

/** The signature picture's object URL, for the confirm screen — `SigningCeremony.vue`'s idiom. */
const drawnUrl = ref<string | null>(null);
watch(
  () => adoption.markBlob.value,
  (blob) => {
    if (drawnUrl.value) URL.revokeObjectURL(drawnUrl.value);
    drawnUrl.value = blob ? URL.createObjectURL(blob) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (drawnUrl.value) URL.revokeObjectURL(drawnUrl.value);
});

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
    // The typed name rides every place while self-adopting; the server reads it on the first only.
    const signedName = selfAdopting.value ? { signed_name: adoption.adoptedName.value.trim() } : {};
    await publicFetch(`/${props.token}/handbook/mark`, {
      method: "POST",
      body: JSON.stringify({ placement_id: id, esign_consent: true, ...signedName }),
    });
    await refresh();
  } catch (e) {
    failed.value = true;
    if ((e as { code?: string }).code === "handbook_adopt_signature_first") failedMessage.value = (e as Error).message;
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

    <PacketAdoption
      v-else-if="adopting"
      :ceremony="adoption"
      :carrier="carrier"
      :stops="[]"
      :copy="APPLY_COPY.handbook.adoption"
      :drawn-url="drawnUrl"
      :initials-url="null"
    />

    <template v-else>
      <p class="text-sm text-ink-muted">{{ selfAdopting ? APPLY_COPY.handbook.introOwnSignature : APPLY_COPY.handbook.intro }}</p>
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
