<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { APPLICATION_CAPTURE_MARK_SLOT, type ApplicationCaptureView, type AuthorizationPurpose } from "@silvicom/shared";
import type { ApplyRelease } from "@/features/apply/useApplication";
import { usePermissionCeremony } from "@/features/apply/signing/usePermissionCeremony";
import PacketAdoption from "@/features/apply/signing/PacketAdoption.vue";
import PermissionDocumentView from "@/features/apply/signing/PermissionDocumentView.vue";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The permissions, one document at a time, each signed where it says (A5, AF6, D-AF2).
 *
 * ── WHAT THE APPLICANT SEES ───────────────────────────────────────────────────────────────────
 * Their signature, made once in the packet's own adoption screens and confirmed. Then each permission
 * as the PDF it is, whole, with a **Sign here** tag on the box the document marks. Pressing it signs
 * that document and nothing else, and the next one opens.
 *
 * ⚠ **FCRA §604(b)(2)'s "solely" still governs the screen.** One document is on it at a time, and
 * nothing else: no application fields, no other permission, no summary of the five. The tag signs the
 * document it sits on.
 *
 * ⚠ **The words are never more than a tap away, and are the whole screen when the PDF will not load.**
 * On a 390px phone a Letter page is small, and a canvas is an image to a screen reader. So the served
 * text (the same words the PDF carries, from the same wording) sits under the document in a
 * disclosure, and replaces it with a plain Sign button when the document cannot be shown. A picture
 * that will not load must not stand between an applicant and five federally-required signatures.
 */
const props = defineProps<{
  token: string;
  releases: ApplyRelease[];
  alreadySigned: AuthorizationPurpose[];
  carrier: string;
  /** Which capture slots this link holds, to know whether a signature picture is already saved (C2). */
  captures?: ApplicationCaptureView[];
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
  },
);

/** The signature picture's object URL, for the confirm screen. One blob, one URL, one revoke. */
const drawnUrl = ref<string | null>(null);
watch(
  () => ceremony.markBlob.value,
  (blob) => {
    if (drawnUrl.value) URL.revokeObjectURL(drawnUrl.value);
    drawnUrl.value = blob ? URL.createObjectURL(blob) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (drawnUrl.value) URL.revokeObjectURL(drawnUrl.value);
});

watch(() => ceremony.complete.value, (done) => done && emit("done"), { immediate: true });

const current = computed(() => ceremony.current.value);
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
    v-if="ceremony.state.value === 'adopting' || ceremony.state.value === 'confirming'"
    :ceremony="ceremony"
    :carrier="carrier"
    :stops="[]"
    :copy="copy.adoption"
    :drawn-url="drawnUrl"
    :initials-url="null"
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
      <summary class="cursor-pointer text-ink">{{ copy.readAsText }}</summary>
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
/* The tag sits over the box's ruled line, like DocuSign's: bottom-left of the box, never over the
   text above it. */
.sign-here-tag {
  margin-bottom: 0.15rem;
}
</style>
