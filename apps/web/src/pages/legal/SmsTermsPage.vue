<script setup lang="ts">
import { computed } from "vue";
import { SMS_STOP_KEYWORDS, smsHelpReply } from "@silvicom/shared";
import LegalDocument from "@/features/legal/LegalDocument.vue";
import LegalSection from "@/features/legal/LegalSection.vue";
import { COMPANY_ADDRESS, COMPANY_NAME, PRODUCT_NAME, supportEmail } from "@/features/legal/legalMeta";
import { SMS_PRIVACY_PATH } from "@/lib/legalPaths";

/**
 * The text-message programme's terms (SMS-OPT-IN-PLAN SMS3, D-SMS4). Public, unauthenticated,
 * indexable — the "Terms" URL a toll-free verification names and the opt-in card links to.
 *
 * ── WHAT A REVIEWER LOOKS FOR, IN THE ORDER THEY LOOK ─────────────────────────────────────────
 * Built from the carrier checklist as it stood on 2026-09-25 (toll-free verification made Terms and
 * Privacy URLs required fields on 2026-09-15): the programme name, what the messages are, how
 * somebody opts in, that it is optional, the frequency, "message and data rates may apply", STOP,
 * HELP with a real support contact, that carriers are not liable, and a link to the privacy policy.
 * Each has its own heading, so a reviewer and an applicant both find theirs without reading the rest.
 *
 * ── THE KEYWORDS AND THE HELP ANSWER ARE READ, NOT RETYPED ─────────────────────────────────────
 * `SMS_STOP_KEYWORDS` is the list the inbound webhook honours and `smsHelpReply` is the function it
 * answers with. Printing them from the shared contract means this page cannot promise a word the
 * webhook ignores or misquote the reply a person will actually receive.
 *
 * ⚠ It does NOT promise a confirmation text after STOP. `handleInboundSms` sends none, and whether
 * the toll-free network sends its own is unmeasured (SMS-OPT-IN-PLAN §7, 2026-09-25).
 */
const email = computed(() => supportEmail());
const stopWords = SMS_STOP_KEYWORDS.map((k) => k.toUpperCase());
// The host this page is served from is the host the webhook's reply names — `WEB_APP_URL` there.
const helpReply = computed(() => smsHelpReply(typeof window === "undefined" ? "" : window.location.host));
</script>

<template>
  <LegalDocument
    title="Text message terms"
    summary="The Silvicom 360 driver application text messages: what they are, how often they come, what they cost, and how to stop them."
  >
    <LegalSection id="programme" title="The programme">
      <p>
        <span class="text-ink">Silvicom 360 driver application texts</span> are sent by
        {{ COMPANY_NAME }} for the trucking company you applied to, which is named at the start of every
        message. They are transactional messages about your own driver application only: a link to fill
        in your application, a reminder if you have not finished a step, and updates on its status, such
        as its approval. We do not send marketing or promotional messages in this programme, and no
        third-party content.
      </p>
    </LegalSection>

    <LegalSection id="opt-in" title="How you sign up, and that it is optional">
      <p>
        You receive these texts only if you enter your mobile number and tick the text-message box on
        your application page. The box is never ticked for you.
      </p>
      <p>
        Agreeing is optional. It is not a condition of applying or of being considered for a job, and
        saying no changes nothing about your application: every message is also sent by email, and your
        application page always shows where things stand.
      </p>
    </LegalSection>

    <LegalSection id="frequency" title="How often">
      <p>
        Message frequency varies. You receive a text only when something about your application changes
        or needs you, which for most applicants is a few messages in total. We do not text at night: a
        message due outside daytime hours in any US time zone is held until the next day.
      </p>
    </LegalSection>

    <LegalSection id="cost" title="Cost">
      <p>
        Message and data rates may apply, according to your mobile plan. {{ COMPANY_NAME }} does not
        charge for these texts.
      </p>
    </LegalSection>

    <LegalSection id="stop" title="How to stop">
      <p>
        Reply <span class="font-semibold text-ink">STOP</span> to any message at any time. These words
        also work: {{ stopWords.join(", ") }}. So does a plain request such as "please stop texting me".
        You can also turn texts off on your application page, or ask the office of the trucking company
        you applied to.
      </p>
      <p>
        Stopping takes effect straight away, for every application on that number. To start again, turn
        texts back on from your application page.
      </p>
    </LegalSection>

    <LegalSection id="help" title="How to get help">
      <p>Reply <span class="font-semibold text-ink">HELP</span> to any message. The answer is:</p>
      <p class="rounded-surface bg-surface-muted p-3">{{ helpReply }}</p>
      <p v-if="email">
        You can also email
        <a :href="`mailto:${email}`" class="text-link hover:text-link-hover">{{ email }}</a>, or contact
        the office of the trucking company you applied to.
      </p>
      <p v-else>You can also contact the office of the trucking company you applied to.</p>
    </LegalSection>

    <LegalSection id="delivery" title="Delivery">
      <p>
        Mobile carriers are not liable for delayed or undelivered messages. If a text does not arrive,
        your email and your application page carry the same information.
      </p>
    </LegalSection>

    <LegalSection id="privacy" title="Your mobile number">
      <p>
        We do not sell your mobile number or share it with third parties or affiliates for their
        marketing or promotional purposes. Your text-message opt-in and consent are not shared with any
        third party. What we keep, and why, is in the
        <RouterLink :to="SMS_PRIVACY_PATH" class="text-link hover:text-link-hover">privacy policy</RouterLink>.
      </p>
    </LegalSection>

    <LegalSection id="who-we-are" title="Who we are">
      <p>
        {{ COMPANY_NAME }}, {{ COMPANY_ADDRESS }}. {{ PRODUCT_NAME }} is our driver
        compliance software, and these terms cover its driver application text messages only.
      </p>
    </LegalSection>
  </LegalDocument>
</template>
