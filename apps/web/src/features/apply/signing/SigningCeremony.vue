<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton, AppInput as BaseInput, AppFormField as FormField } from "@fuelguard/ui";
import type { AuthorizationPurpose } from "@fuelguard/shared";
import type { ApplyRelease } from "@/features/apply/useApplication";
import { useSigningCeremony } from "@/features/apply/signing/useSigningCeremony";
import SignaturePad from "@/features/apply/signing/SignaturePad.vue";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * One instrument, one screen, one control (A5, D-APP7).
 *
 * FCRA §604(b)(2) requires the disclosure to be "in a document that consists solely of the
 * disclosure", and courts read `solely` literally — so there is deliberately nothing else on this
 * screen while an instrument is showing: no application fields, no other instrument, no summary of
 * the four. The driver adopts a signature once, and then each document is one tap.
 *
 * The text is the SERVER's, rendered as served. Nothing here paraphrases an instrument, and there is
 * no control that could sign more than one.
 */
const props = defineProps<{
  token: string;
  releases: ApplyRelease[];
  alreadySigned: AuthorizationPurpose[];
  carrier: string;
}>();
const emit = defineEmits<{ done: [] }>();

const copy = APPLY_COPY.signing;
const ceremony = useSigningCeremony(
  computed(() => props.token),
  computed(() => props.releases),
  computed(() => props.alreadySigned),
);

async function signCurrent(): Promise<void> {
  await ceremony.sign();
  if (ceremony.complete.value) emit("done");
}

async function adoptAndStart(): Promise<void> {
  if ((await ceremony.adopt()) && ceremony.complete.value) emit("done");
}
</script>

<template>
  <!-- Adoption: once, before any instrument is shown. -->
  <section v-if="!ceremony.adopted.value" class="space-y-4">
    <div>
      <h1 class="text-lg font-semibold text-ink">{{ copy.adoptHeading }}</h1>
      <p class="mt-2 text-sm text-ink-muted">{{ copy.adoptIntro(carrier, ceremony.total.value) }}</p>
    </div>
    <FormField v-slot="{ id }" :label="copy.adoptLabel" :hint="copy.adoptHint">
      <BaseInput :id="id" v-model="ceremony.adoptedName.value" autocomplete="name" />
    </FormField>
    <!-- Rendered in a script face so it reads as a signature. It is a rendering of the typed name and
         nothing more: the legally load-bearing artifact is the tuple the server stores (D-APP8). -->
    <p v-if="ceremony.adoptedName.value.trim()" class="signature-preview text-2xl text-ink">
      {{ ceremony.adoptedName.value }}
    </p>

    <!-- A8b/D-APP8: never required, and it says so. The typed name above is what the file records. -->
    <SignaturePad @change="ceremony.markBlob.value = $event" />

    <div class="flex justify-end">
      <BaseButton
        variant="primary"
        :disabled="ceremony.working.value || ceremony.adoptedName.value.trim().length < 2"
        @click="adoptAndStart"
      >
        {{ ceremony.working.value ? copy.signing : copy.adoptAction }}
      </BaseButton>
    </div>
  </section>

  <!-- One instrument. Nothing else on the screen. -->
  <section v-else-if="ceremony.current.value" class="space-y-4">
    <div class="flex items-baseline justify-between gap-4">
      <h1 class="text-lg font-semibold text-ink">{{ ceremony.current.value.title }}</h1>
      <span class="text-xs text-ink-muted">
        {{ copy.counter(ceremony.position.value, ceremony.total.value) }}
      </span>
    </div>
    <p class="whitespace-pre-line rounded-surface bg-surface-muted p-4 text-sm text-ink-secondary">
      {{ ceremony.current.value.body }}
    </p>

    <p class="text-sm text-ink">{{ ceremony.current.value.intent }}</p>
    <p class="signature-preview text-2xl text-ink">{{ ceremony.adoptedName.value }}</p>

    <!-- The carrier's problem, said as the carrier's problem. A driver who cannot sign because
         nobody published the wording has done nothing wrong and can do nothing about it. -->
    <p v-if="ceremony.carrierProblem.value" class="text-sm text-ink-secondary">{{ copy.notFinal }}</p>
    <p v-else-if="ceremony.error.value" class="text-sm text-ink-secondary">{{ ceremony.error.value }}</p>

    <div class="flex justify-end">
      <BaseButton variant="primary" :disabled="ceremony.working.value" @click="signCurrent">
        {{ ceremony.working.value ? copy.signing : copy.sign }}
      </BaseButton>
    </div>
  </section>
</template>

<style scoped>
/* A script face for the adopted name. Cursive is a system-stack keyword, so this needs no webfont
   and cannot fail to load on a truck-stop connection. */
.signature-preview {
  font-family: ui-rounded, "Segoe Script", "Brush Script MT", cursive;
}
</style>
