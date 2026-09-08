<script setup lang="ts">
import { computed } from "vue";
import LegalDocument from "@/features/legal/LegalDocument.vue";
import LegalSection from "@/features/legal/LegalSection.vue";
import { COMPANY_NAME, PRODUCT_NAME, supportEmail } from "@/features/legal/legalMeta";

/**
 * Terms of use for the driver app (P3.2, D-PR9).
 *
 * ── THE ONE THING THAT MAKES THESE UNUSUAL ─────────────────────────────────────────────────────
 * The reader did not sign up and cannot leave. Their employer issued the login, their employer
 * decides what the app does, and the driver's real agreement is their employment. Terms written as
 * though the reader chose this service would be false, so these say plainly who agreed to what and
 * confine themselves to the two things the driver genuinely controls: how they use the app, and what
 * they may not rely on it for.
 *
 * ⚠ The governing-law section names no state. The plan (§6.2 P3) carried `[STATE]` as a placeholder;
 * a live page with a bracket in it is worse than one that states the truth, which is that the
 * governing law is whatever the carrier's own agreement with {@link COMPANY_NAME} says. Counsel
 * confirms or replaces that in the Q-PR3 revision.
 */
const email = computed(() => supportEmail());
</script>

<template>
  <LegalDocument
    title="Terms of use"
    summary="The rules for using the Silvicom 360 driver app. Short, because your employer holds the real agreement."
  >
    <LegalSection id="your-account" title="Your account belongs to your employer">
      <p>
        The trucking company you drive for holds a contract with {{ COMPANY_NAME }} and issues your
        login from it. That company can change what the app shows you, suspend your access, or close
        your login — for example when you stop driving for them. {{ PRODUCT_NAME }} is provided to you
        through your employer, and these terms do not create a separate service contract between you
        and us.
      </p>
      <p>
        Your login is yours alone. Do not share it or let anyone else record work under your name. If
        you think somebody else has your password, tell your fleet manager immediately.
      </p>
    </LegalSection>

    <LegalSection id="acceptable-use" title="Using the app properly">
      <p>When you use the app you agree to:</p>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>
          Never operate it while driving. Pull over and stop before you check in, photograph a stop,
          or read a message.
        </li>
        <li>
          Record work honestly — arrivals, completed stops, odometer readings and photographs are
          compliance records, and a false entry can put your licence and your carrier's authority at
          risk.
        </li>
        <li>Photograph only what the task asks for: documents, seals, trailers and damage.</li>
        <li>
          Keep messages to work. Harassment, threats and abuse are reportable, and a received message
          can be reported from the app by pressing and holding it.
        </li>
        <li>
          Leave the software alone — no attempt to break into other carriers' or drivers' data, no
          reverse engineering, no automated scraping.
        </li>
      </ul>
      <p>
        We may suspend access that threatens the safety or integrity of the service, and we will tell
        your carrier when we do.
      </p>
    </LegalSection>

    <LegalSection id="not-a-substitute" title="What the app is not">
      <p>
        The app helps you do your job. It does not replace your judgement, your training, or the law.
        In particular:
      </p>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>
          <span class="text-ink">Maps and route information are for orientation only.</span> They are
          not truck-safe routing. They do not know your height, weight, axle configuration or the
          restrictions on a road, and you must not rely on them to choose a route.
        </li>
        <li>
          <span class="text-ink">Compliance checks are an aid, not a clearance.</span> A hazmat or
          document check tells you what our rules engine found in what it could read. The driver and
          the carrier remain responsible for compliance under the applicable federal rules, including
          49 CFR §177.817.
        </li>
        <li>
          <span class="text-ink">The app is not an hours-of-service logging device</span> and is not a
          substitute for your ELD.
        </li>
        <li>
          <span class="text-ink">It needs a signal eventually.</span> Work you record offline is held
          on the phone and sent when you reconnect. Keep the app installed and signed in until the
          pending count in Settings reaches zero.
        </li>
      </ul>
    </LegalSection>

    <LegalSection id="availability" title="Availability and changes">
      <p>
        We aim to keep the service running but cannot promise it will be uninterrupted or error-free.
        We may change, add or remove features, and your carrier may turn individual features on or off
        for its drivers at any time.
      </p>
      <p>
        The app is provided as it is, without warranties of any kind to you as a driver. Any service
        commitments {{ COMPANY_NAME }} has made are in its contract with your carrier, and that
        contract — not this page — governs them.
      </p>
    </LegalSection>

    <LegalSection id="liability" title="Liability">
      <p>
        To the fullest extent the law allows, {{ COMPANY_NAME }} is not liable to you for indirect or
        consequential loss arising from your use of the app. Nothing here limits liability that cannot
        be limited by law, and nothing here affects your rights against your employer.
      </p>
    </LegalSection>

    <LegalSection id="governing-law" title="Governing law">
      <p>
        These terms are governed by the law named in the agreement between your carrier and
        {{ COMPANY_NAME }}, and disputes are resolved in the courts that agreement names.
      </p>
    </LegalSection>

    <LegalSection id="privacy" title="Privacy">
      <p>
        What the app collects and who can see it is set out in the
        <RouterLink to="/privacy" class="text-link hover:text-link-hover">privacy policy</RouterLink>,
        which forms part of these terms.
      </p>
    </LegalSection>

    <LegalSection id="contact" title="Questions">
      <p v-if="email">
        Ask your fleet manager first — they can change most things about your account. For problems
        with the app itself, email
        <a :href="`mailto:${email}`" class="text-link hover:text-link-hover">{{ email }}</a>.
      </p>
      <p v-else>
        Ask your fleet manager. They can change most things about your account and can reach
        {{ COMPANY_NAME }} on your behalf.
      </p>
    </LegalSection>
  </LegalDocument>
</template>
