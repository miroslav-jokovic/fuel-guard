<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import {
  APPLICATION_CAPTURE_MARK_SLOT,
  type ApplicationCaptureView,
  type AuthorizationPurpose,
  type SignatureAdoptionsView,
} from "@silvicom/shared";
import type { ApplyRelease } from "@/features/apply/useApplication";
import { usePermissionCeremony } from "@/features/apply/signing/usePermissionCeremony";
import PacketAdoption from "@/features/apply/signing/PacketAdoption.vue";
import PermissionDocumentView from "@/features/apply/signing/PermissionDocumentView.vue";
import { APPLY_COPY } from "@/features/apply/strings";
import { useApplyScreen } from "@/features/apply/useScreenEvents";

/**
 * The permissions, one document at a time, each signed where it says (A5, AF6, D-AF2).
 *
 * ── WHAT THE APPLICANT SEES ───────────────────────────────────────────────────────────────────
 * Their signature and initials, made once in the packet's own adoption screens and confirmed — screen
 * 13, the link's adoption (D-AW15, C3s1). Then each permission
 * as the PDF it is, whole, with a **Sign here** tag on the box the document marks. Pressing it signs
 * that document and nothing else, and the next one opens.
 *
 * ⚠ **FCRA §604(b)(2)'s "solely" still governs the screen.** One document is on it at a time, and
 * nothing else: no application fields, no other permission, no summary of the six. The tag signs the
 * document it sits on.
 *
 * ⚠ **The words are never more than a tap away, and are the whole screen when the PDF will not load.**
 * On a 390px phone a Letter page is small, and a canvas is an image to a screen reader. So the served
 * text (the same words the PDF carries, from the same wording) sits under the document in a
 * disclosure, and replaces it with a plain Sign button when the document cannot be shown. A picture
 * that will not load must not stand between an applicant and six signatures.
 */
const props = defineProps<{
  token: string;
  releases: ApplyRelease[];
  alreadySigned: AuthorizationPurpose[];
  carrier: string;
  /** Which capture slots this link holds, to know whether a signature picture is already saved (C2). */
  captures?: ApplicationCaptureView[];
  /** What the link has adopted on screen 13 (D-AW15), as typed text. */
  adoptions?: SignatureAdoptionsView;
}>();
const emit = defineEmits<{ done: [] }>();

const copy = APPLY_COPY.permissions;
const ceremony = usePermissionCeremony(
  computed(() => props.token),
  computed(() => props.releases),
  computed(() => props.alreadySigned),
  {
    markStaged: computed(() =>
      (props.captures ?? []).some((c) => c.slot === APPLICATION_CAPTURE_MARK_SLOT.signature),
    ),
    adoptions: computed(() => props.adoptions),
  },
);

/**
 * The two pictures' object URLs, for the confirm screen. One blob, one URL, one revoke — each. The
 * initials have one since C3s1, when this screen started adopting them (D-AW15).
 */
const drawnUrl = ref<string | null>(null);
const initialsUrl = ref<string | null>(null);
function followBlob(blob: () => Blob | null, url: typeof drawnUrl): void {
  watch(
    blob,
    (next) => {
      if (url.value) URL.revokeObjectURL(url.value);
      url.value = next ? URL.createObjectURL(next) : null;
    },
    { immediate: true },
  );
}
followBlob(() => ceremony.markBlob.value, drawnUrl);
followBlob(() => ceremony.initialsBlob.value, initialsUrl);
onBeforeUnmount(() => {
  for (const url of [drawnUrl, initialsUrl]) if (url.value) URL.revokeObjectURL(url.value);
});

watch(() => ceremony.complete.value, (done) => done && emit("done"), { immediate: true });

const current = computed(() => ceremony.current.value);
const adopting = computed(() => ceremony.state.value === "adopting" || ceremony.state.value === "confirming");
// One screen per permission (AW14). Adopting the signature is `ceremony` (the branch's own name), and
// ⚠ it has to be said: `current` already points at the first permission while the adoption is showing.
useApplyScreen(() => (current.value && !adopting.value ? `ceremony.${current.value.purpose}` : null));
const src = computed(() =>
  current.value
    ? `/api/public/application/${encodeURIComponent(props.token)}/permission/${current.value.purpose}.pdf`
    : "",
);

/** Whether the document is on screen with its box found. Otherwise the words and a plain button. */
const view = ref<"loading" | "tagged" | "words">("loading");
watch(src, () => (view.value = "loading"));

async function sign(): Promise<void> {
  await ceremony.signCurrent();
  if (!ceremony.complete.value) window.scrollTo?.({ top: 0 });
}
</script>

<template>
  <PacketAdoption
    v-if="adopting"
    :ceremony="ceremony"
    :carrier="carrier"
    :stops="[]"
    :copy="copy.adoption"
    :drawn-url="drawnUrl"
    :initials-url="initialsUrl"
  />

  <!-- One document. Nothing else on the screen. -->
  <section v-else-if="current" class="space-y-4">
    <div class="flex items-baseline justify-between gap-4">
      <h1 class="text-lg font-semibold text-ink">{{ current.release.title }}</h1>
      <span class="shrink-0 text-xs text-ink-muted">
        {{ copy.counter(ceremony.position.value, ceremony.total.value) }}
      </span>
    </div>

    <PermissionDocumentView
      v-if="view !== 'words'"
      :key="src"
      :src="src"
      :label="current.release.title"
      @loaded="(hasBox) => (view = hasBox ? 'tagged' : 'words')"
      @failed="view = 'words'"
    >
      <template #loading>{{ copy.loading }}</template>
      <template #box>
        <BaseButton
          variant="primary"
          size="sm"
          class="sign-here-tag"
          :disabled="ceremony.working.value"
          @click="sign"
        >
          {{ ceremony.working.value ? copy.working : copy.signHere }}
        </BaseButton>
      </template>
    </PermissionDocumentView>

    <!-- The document could not be shown, or names no box: its words, and a plain button. -->
    <template v-if="view === 'words'">
      <p class="text-sm text-ink-secondary">{{ copy.unavailable }}</p>
      <p class="whitespace-pre-line rounded-surface bg-surface-muted p-4 text-sm text-ink-secondary">
        {{ current.release.body }}
      </p>
      <p class="text-sm text-ink">{{ current.release.intent }}</p>
    </template>
    <details v-else class="text-sm text-ink-secondary">
      <!-- py-3 around the 20 px line makes the 44 px target (§6.8, C3d3b2); padding, not flex, which
           would drop the disclosure triangle. -->
      <summary class="cursor-pointer py-3 text-ink">{{ copy.readAsText }}</summary>
      <p class="mt-2 whitespace-pre-line">{{ current.release.body }}</p>
      <p class="mt-2 text-ink">{{ current.release.intent }}</p>
    </details>

    <!-- The carrier's problem, said as the carrier's. The applicant can do nothing about it. -->
    <p v-if="ceremony.carrierProblem.value" class="text-sm text-ink-secondary">{{ copy.notFinal }}</p>
    <p v-else-if="ceremony.error.value" class="text-sm text-ink-secondary">{{ copy.failed }}</p>

    <div v-if="view === 'words'" class="flex justify-end">
      <BaseButton variant="primary" :disabled="ceremony.working.value" @click="sign">
        {{ ceremony.working.value ? copy.working : copy.signAction }}
      </BaseButton>
    </div>
  </section>
</template>

<style scoped>
/* The tag sits on the box, like DocuSign's: its top-left at the box's, never over the text above it
   (the slot hangs it from the box's top — see `PermissionDocumentView`). */
.sign-here-tag {
  margin-top: 0.15rem;
}
</style>
