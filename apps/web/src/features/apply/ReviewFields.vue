<script setup lang="ts">
import { computed } from "vue";
import { AppButton as BaseButton } from "@fuelguard/ui";
import {
  APPLICATION_SECTION_LABELS,
  type ApplicationSection,
} from "@fuelguard/shared";
import type { ApplicationDraft } from "@/features/apply/draft";
import { APPLY_COPY } from "@/features/apply/strings";

/**
 * What the driver is about to certify (A3).
 *
 * §391.21(b)(12) makes them sign that "all entries on it and information in it are true and
 * complete", and a wizard hides most of the document behind screens they have already left. So the
 * step before the signature puts it all back on one page — not as a pretty summary but as the
 * answers themselves, each with a way back to the screen that owns it.
 *
 * The Social Security number is deliberately NOT shown: it is optional, it is not part of the
 * certified payload, and reprinting nine digits on a summary screen on a phone in a truck stop is
 * the opposite of what D-HIRE6 spends its effort on.
 */
const props = defineProps<{ draft: ApplicationDraft }>();
const emit = defineEmits<{ goTo: [ApplicationSection] }>();

const copy = APPLY_COPY.review;
const value = (v: string): string => (v.trim() === "" ? copy.empty : v);

const rows = computed<Array<{ section: ApplicationSection; items: Array<[string, string]> }>>(() => [
  {
    section: "identity",
    items: [
      ["Name", value([props.draft.first_name, props.draft.middle_name, props.draft.last_name].filter(Boolean).join(" "))],
      ["Date of birth", value(props.draft.date_of_birth)],
      ["Email", value(props.draft.email)],
      ["Phone", value(props.draft.phone)],
    ],
  },
  {
    section: "addresses",
    items: props.draft.addresses.map((a, i) => [
      `Address ${i + 1}`,
      value([a.line1, a.city, a.state, a.postal_code].filter(Boolean).join(", ")),
    ]),
  },
  {
    section: "licence",
    items: [
      ["Licence", value(`${props.draft.cdl_number} ${props.draft.cdl_state}`.trim())],
      ["Expires", value(props.draft.cdl_expires_at)],
      [
        "Other licences and permits",
        props.draft.additional_licences.length === 0
          ? copy.none
          : copy.count(props.draft.additional_licences.length, "licence"),
      ],
    ],
  },
  {
    section: "employment",
    items: [
      [
        "Employers",
        props.draft.declares_no_employment
          ? copy.none
          : copy.count(props.draft.employers.filter((e) => e.employer_name.trim()).length, "employer"),
      ],
      ["Experience", value(props.draft.experience)],
    ],
  },
  {
    section: "safety",
    items: [
      [
        "Accidents",
        props.draft.declares_no_accidents ? copy.none : copy.count(props.draft.accidents.length, "accident"),
      ],
      [
        "Traffic convictions",
        props.draft.declares_no_violations ? copy.none : copy.count(props.draft.violations.length, "conviction"),
      ],
      [
        "Licence denied, revoked or suspended",
        props.draft.licence_ever_denied ? value(props.draft.licence_denial_detail) : copy.none,
      ],
    ],
  },
]);
</script>

<template>
  <section class="space-y-6">
    <p class="text-sm text-ink-muted">{{ copy.intro }}</p>

    <div v-for="group in rows" :key="group.section" class="space-y-2 rounded-surface bg-surface-muted p-4">
      <div class="flex items-center justify-between gap-4">
        <h3 class="text-sm font-semibold text-ink">{{ APPLICATION_SECTION_LABELS[group.section] }}</h3>
        <BaseButton variant="ghost" size="sm" @click="emit('goTo', group.section)">
          {{ APPLY_COPY.nav.fix }}
        </BaseButton>
      </div>
      <dl class="space-y-1">
        <div v-for="[label, text] in group.items" :key="label" class="flex justify-between gap-4 text-sm">
          <dt class="text-ink-muted">{{ label }}</dt>
          <dd class="text-right text-ink">{{ text }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>
