<script setup lang="ts">
import { computed } from "vue";
import LegalDocument from "@/features/legal/LegalDocument.vue";
import LegalSection from "@/features/legal/LegalSection.vue";
import { COMPANY_NAME, PRODUCT_NAME, supportEmail } from "@/features/legal/legalMeta";

/**
 * The support page (P3.2). This is the URL both store listings point at as "Support", so it is read
 * by three people: a driver whose app is misbehaving, a fleet manager whose driver cannot sign in,
 * and a store reviewer checking the link resolves to something real.
 *
 * ── WHY IT ANSWERS QUESTIONS RATHER THAN JUST PUBLISHING AN ADDRESS ────────────────────────────
 * The plan's line for this page was one sentence: dispatcher first, then the support address. That
 * is the right ROUTING and a poor page — the three problems below are the ones the app's own design
 * makes likely (an offline queue that has to drain, a login only a fleet manager can reset, and
 * notifications that need a fleet-level feature switched on), and each has an answer the driver can
 * act on without waiting for anybody. Sending someone to email support for a question the page could
 * have answered is how a support address becomes a queue nobody can clear.
 *
 * `supportEmail()` returning null is a supported state, not a broken one — see `legalMeta.ts`.
 */
const email = computed(() => supportEmail());
</script>

<template>
  <LegalDocument
    title="Support"
    summary="Help with the Silvicom 360 driver app — what to try first, and who to ask."
    :review-notice="false"
  >
    <LegalSection id="who-to-ask" title="Who to ask">
      <p>
        <span class="text-ink">Start with your dispatcher or fleet manager.</span> They issue your
        login, assign your loads, and decide which parts of the app you see. Almost everything a
        driver needs — a password reset, a missing load, a feature that is not showing — is theirs to
        fix, and they can fix it immediately.
      </p>
      <p v-if="email">
        <span class="text-ink">If the app itself is broken</span> — it crashes, will not open, or a
        screen is stuck — email
        <a :href="`mailto:${email}`" class="text-link hover:text-link-hover">{{ email }}</a>. Tell us
        what phone you have and what you were doing; the Build panel under Settings has the version
        number we need.
      </p>
      <p v-else>
        <span class="text-ink">If the app itself is broken</span> — it crashes, will not open, or a
        screen is stuck — tell your fleet manager, who can reach {{ COMPANY_NAME }} on your behalf.
        The Build panel under Settings has the version number they will be asked for.
      </p>
    </LegalSection>

    <LegalSection id="cannot-sign-in" title="You cannot sign in">
      <p>
        Your login is a Driver ID and a password, both issued by your carrier. There is no way to sign
        up, and no self-service password reset — this is deliberate, because your account is your
        employer's record of you.
      </p>
      <p>
        Ask your fleet manager to reset it. They can do that in seconds, and the new password is shown
        to them once, so they will read it to you directly.
      </p>
    </LegalSection>

    <LegalSection id="work-not-arriving" title="Your work has not reached the office">
      <p>
        The app is built to keep working in a dock with no bars. Everything you do offline — a check
        in, a completed stop, a photograph, a message — is saved on the phone and sent when you get a
        signal.
      </p>
      <p>
        Open <span class="text-ink">More → System settings</span> and look at Sync. If it shows items
        pending, they have not been sent yet: get a signal and they will go on their own. If it shows
        a problem, tap Try again. Do not delete the app while anything is pending — that is the one
        thing that loses the work.
      </p>
    </LegalSection>

    <LegalSection id="no-notifications" title="You are not getting notifications">
      <p>Three things have to be true, and the first two are yours to check:</p>
      <ul class="list-disc space-y-1.5 pl-5">
        <li>Notifications are allowed for {{ PRODUCT_NAME }} in your phone's own settings.</li>
        <li>The category is not muted in the app, under Notifications.</li>
        <li>
          Your carrier has notifications switched on for its drivers. If the first two look right, this
          is the one to ask your fleet manager about.
        </li>
      </ul>
      <p>
        Safety-critical alerts — a cancelled load, a system message — cannot be muted, by design.
      </p>
    </LegalSection>

    <LegalSection id="camera" title="A photograph will not go through">
      <p>
        The app checks each shot before it accepts it and will tell you plainly what is wrong — too
        blurred, too much glare, or the document is cut off. Rest the phone on something solid, get
        the whole page in the frame, and move so the light is not bouncing straight back at you.
      </p>
      <p>
        If the camera does not open at all, check that {{ PRODUCT_NAME }} has camera permission in
        your phone's settings. The app asks for the camera and nothing else — not your photo library,
        not your microphone.
      </p>
    </LegalSection>

    <LegalSection id="account" title="Your account and your data">
      <p>
        What the app collects and who can see it is in the
        <RouterLink to="/privacy" class="text-link hover:text-link-hover">privacy policy</RouterLink>;
        the rules for using it are in the
        <RouterLink to="/terms" class="text-link hover:text-link-hover">terms of use</RouterLink>.
      </p>
      <p>
        To close your login, ask your fleet manager. It stops working straight away. Some records —
        your driver qualification file above all — are kept for three years by federal rule, and
        closing the login does not remove them.
      </p>
    </LegalSection>
  </LegalDocument>
</template>
