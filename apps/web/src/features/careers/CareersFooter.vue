<script setup lang="ts">
import { computed } from "vue";
import type { ApplyAccommodation } from "@silvicom/shared";
import { formatPhone } from "@/lib/format";
import { CAREERS_PRIVACY_PATH, SMS_TERMS_PATH } from "@/lib/legalPaths";
import { CAREERS_COPY, EEOC_KNOW_YOUR_RIGHTS_URL } from "./careersCopy";

/**
 * The careers pages' notices (APPLY-PAGE-PLAN D-AP7), on the list and on every job:
 *   · the EEO statement and the EEOC's "Know Your Rights" poster. The EEOC encourages employers to post it on their
 *     websites (eeoc.gov/poster, read 2026-11-22);
 *   · who to ask for an accommodation, from the careers page row (0641 requires one before the page can be on);
 *   · what the form keeps, with the Privacy Policy and SMS Terms.
 *
 * ⚠ Every link here is a plain `<a>` with an absolute address, never a `RouterLink`. On `careers.silvicominc.com`
 * the SPA is the office's own bundle, and Caddy serves only `/careers` under that name (D-AP9). The legal pages live
 * on the office host (`legalOrigin`), so a client-side route to `/privacy` would draw the office's page under the
 * careers name, and a reload of it would be a 404. `CareersListPage.test.ts` checks every footer address.
 */
const props = defineProps<{ carrier: string; accommodation: ApplyAccommodation; legalOrigin: string }>();
const copy = CAREERS_COPY.footer;
const links = computed(() => ({
  privacy: `${props.legalOrigin}${CAREERS_PRIVACY_PATH}`,
  smsTerms: `${props.legalOrigin}${SMS_TERMS_PATH}`,
}));
const phone = computed(() => (props.accommodation.phone ? formatPhone(props.accommodation.phone) : null));
</script>

<template>
  <section class="mt-12 space-y-6 border-t border-edge pt-8 text-sm text-ink-secondary" aria-label="Notices" data-careers-footer>
    <div>
      <h2 class="text-lg font-semibold text-ink">{{ copy.accommodationHeading }}</h2>
      <p class="mt-1">{{ copy.accommodation }}</p>
      <ul class="mt-2 space-y-1" data-accommodation>
        <li v-if="accommodation.email">
          <a class="inline-flex min-h-11 items-center font-medium text-link underline hover:text-link-hover" :href="`mailto:${accommodation.email}`">{{ accommodation.email }}</a>
        </li>
        <li v-if="accommodation.phone">
          <a class="inline-flex min-h-11 items-center font-medium text-link underline hover:text-link-hover" :href="`tel:${accommodation.phone}`">{{ phone }}</a>
        </li>
      </ul>
    </div>
    <div>
      <h2 class="text-lg font-semibold text-ink">{{ copy.privacyHeading }}</h2>
      <p class="mt-1">{{ copy.privacy(carrier) }}</p>
      <p class="mt-2">
        <a class="inline-flex min-h-11 items-center text-link underline hover:text-link-hover" :href="links.privacy" target="_blank" rel="noopener">{{ CAREERS_COPY.form.privacy }}</a>
        ·
        <a class="inline-flex min-h-11 items-center text-link underline hover:text-link-hover" :href="links.smsTerms" target="_blank" rel="noopener">{{ CAREERS_COPY.form.smsTerms }}</a>
        <span class="sr-only"> {{ CAREERS_COPY.form.opensNewTab }}</span>
      </p>
    </div>
    <div>
      <p data-eeo>{{ copy.eeo(carrier) }}</p>
      <p class="mt-2">
        <a class="inline-flex min-h-11 items-center text-link underline hover:text-link-hover" :href="EEOC_KNOW_YOUR_RIGHTS_URL" target="_blank" rel="noopener">{{ copy.kyr }}</a>
      </p>
    </div>
  </section>
</template>
