<script setup lang="ts">
import { computed, ref, toRef } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { encode, toSvgPath } from "@silvicom/qr";
import SmsOptInCard from "@/features/apply/SmsOptInCard.vue";
import { textMeTheLink, useSmsOptIn } from "@/features/apply/useSmsOptIn";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * The desktop handoff on a photo screen (§6.6.6, C3b2b2): the same link, to the phone.
 *
 * ── QR FIRST, TEXT ONLY ON CONSENT (the owner-accepted default) ───────────────────────────────
 * The QR code is always there and costs nothing. "Text me the link" appears only when a LIVE consent
 * exists for this applicant; otherwise the existing optional opt-in card sits beside the code, exactly
 * as it does on the waiting screens — never a step, never required (47 CFR §64.1200(f)(9)(i)(B)). The
 * server re-checks everything the button implies (consent, STOP, quiet hours) and says why when it held
 * the text, and every refusal ends at the QR code, which always works.
 *
 * ── THE LINK IS THIS PAGE'S OWN, AND NOTHING IS SENT FOR THE CODE ─────────────────────────────
 * The code is drawn here from the route's token (`@silvicom/qr`, the inventory labels' encoder); the
 * link is a bearer credential, so it is never handed to a QR service. The same token opens the same
 * intake on the phone. A text, when sent, is composed by the server from its own `:token`.
 */
const props = defineProps<{ token: string; carrier: string }>();
const copy = APPLY_COPY.partOne.photo.handoff;

const link = computed(() => `${window.location.origin}/apply/${encodeURIComponent(props.token)}`);
/** One path on a 100-unit square — `toSvgPath` for LabelSheetPreview's reason: one geometry, one fill. */
const qrPath = computed(() => toSvgPath(encode(link.value), { size: 100 }));

const { query } = useSmsOptIn(toRef(props, "token"));
const consent = computed(() => (query.data.value?.status?.offered ? query.data.value.status : null));
const agreed = computed(() => consent.value?.state === "agreed");

const texting = ref(false);
const said = ref<string | null>(null);
const saidIsProblem = ref(false);

async function textMe(): Promise<void> {
  texting.value = true;
  said.value = null;
  try {
    const answer = await textMeTheLink(props.token);
    saidIsProblem.value = answer.outcome !== "sent";
    said.value = answer.outcome === "sent" ? copy.sent(consent.value?.phoneLast4 ?? "") : copy.held[answer.held];
  } catch (e) {
    // The limiter's and the provider's refusals are written for the applicant; anything else is generic.
    const code = (e as { code?: string }).code;
    saidIsProblem.value = true;
    said.value = code === "too_many_requests" || code === "sms_failed" ? (e as Error).message : copy.failed;
  } finally {
    texting.value = false;
  }
}
</script>

<template>
  <section class="space-y-4 rounded-surface bg-surface-muted p-4" aria-labelledby="handoff-heading">
    <div class="space-y-1">
      <h2 id="handoff-heading" class="text-sm font-semibold text-ink">{{ copy.heading }}</h2>
      <p class="text-sm text-ink-muted">{{ copy.body }}</p>
    </div>
    <!-- Black on white whatever the theme: a QR symbol wants contrast, not brand colour (svg.ts), and
         some phone scanners cannot read an inverted one. `crispEdges` for LabelSheetPreview's reason:
         antialiased module edges read as grey to a camera pointed at a screen. -->
    <svg
      viewBox="0 0 100 100"
      shape-rendering="crispEdges"
      role="img"
      :aria-label="copy.qrLabel"
      class="mx-auto size-48 rounded-detail"
    >
      <rect width="100" height="100" fill="#ffffff" />
      <path :d="qrPath" fill="#000000" />
    </svg>
    <p class="text-center text-xs text-ink-tertiary" aria-live="polite">{{ copy.waiting }}</p>

    <div v-if="agreed" class="space-y-2">
      <BaseButton size="touch" block :disabled="texting" @click="textMe">
        {{ texting ? copy.texting : copy.textMe }}
      </BaseButton>
      <p
        v-if="said"
        :class="['text-sm', saidIsProblem ? 'text-danger-700' : 'text-ink-muted']"
        :role="saidIsProblem ? 'alert' : undefined"
      >
        {{ said }}
      </p>
    </div>
    <SmsOptInCard v-else :token="token" :carrier="carrier" />
  </section>
</template>
