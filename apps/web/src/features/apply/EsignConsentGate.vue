<script setup lang="ts">
import { AppButton as BaseButton } from "@silvicom/ui";
import type { ApplyEsignConsent } from "@/features/apply/useApplication";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The first screen of the link (A4, D-APP5).
 *
 * 49 CFR §390.32(d) makes an electronic §391.21 application conditional on including proof of consent
 * per 15 U.S.C. 7001(c), and 7001(c) is not a checkbox — it enumerates six things the driver must be
 * told BEFORE they agree. So the whole text is on screen, in the statute's order, and the affirmative
 * control is underneath it rather than beside a summary.
 *
 * 7001(c)(1)(C)(ii) asks that the consent be given "in a manner that reasonably demonstrates that the
 * consumer can access information" — which is what a button under the text they just scrolled through,
 * in the browser they will use for the rest of the application, actually is.
 */
defineProps<{ consent: ApplyEsignConsent; carrier: string; working: boolean; failed: boolean }>();
const emit = defineEmits<{ agree: [] }>();
const copy = APPLY_COPY.consent;
</script>

<template>
  <section class="space-y-4">
    <div>
      <h1 class="text-lg font-semibold text-ink">{{ copy.heading }}</h1>
      <p class="mt-2 text-sm text-ink-muted">{{ copy.intro(carrier) }}</p>
    </div>

    <div class="space-y-1">
      <h2 class="text-sm font-semibold text-ink">{{ consent.title }}</h2>
    </div>

    <!-- Served text, never shipped in the bundle: what somebody agreed to is a fact the server can
         prove. `whitespace-pre-line` because the clauses are composed with their own line breaks. -->
    <p class="whitespace-pre-line rounded-surface bg-surface-muted p-4 text-sm text-ink-secondary">
      {{ consent.body }}
    </p>

    <p class="text-sm text-ink">{{ consent.intent }}</p>
    <p v-if="failed" class="text-sm text-ink-secondary">{{ copy.failed }}</p>

    <div class="flex justify-end">
      <BaseButton variant="primary" :disabled="working" @click="emit('agree')">
        {{ working ? copy.working : copy.action }}
      </BaseButton>
    </div>
  </section>
</template>
