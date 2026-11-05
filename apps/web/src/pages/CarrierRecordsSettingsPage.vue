<script setup lang="ts">
import { computed, ref } from "vue";
import { AppCallout } from "@silvicom/ui";
import { DQ_KIND_LABELS, FLEET_WIDE_UNIT_KINDS, fileSectionFor } from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import CertManager from "@/features/hazmat/CertManager.vue";
import { useCertificationsQuery } from "@/composables/useCompliance";
import { useSessionStore } from "@/stores/session";

/**
 * Settings › Carrier records (DQ-INTO-DRIVERS-PLAN DD3, D-DQ20): the certifications the carrier itself
 * holds. The body is `CertManager` on the organization, which the Driver Qualification list opened in a
 * slide-over until DD4 retires that page.
 *
 * ── ITS SURFACE, `safety.carrier-records` (D-DQ20) ──────────────────────────────────────────────
 * A card in Settings rather than a section of Organization: `admin.settings.org` is one screen with
 * one gate (`settings: manage`), a safety manager holds `settings: none`, and a section cannot carry
 * a different permission from its page. Gated on `roster`, because most of these are the qualification
 * side's records; `CertManager` then offers each kind only to whoever manages its section
 * (`fileSectionFor`), so the fleet's insurance and IFTA stay the equipment section's to file.
 *
 * ⚠ `startsOnFor` NAMES fleet_manager and safety_manager, against Q-SET2 ("every Settings screen starts
 * admin-only", 2026-09-30). The owner's ruling of 2026-11-05 (Q-DD1 (a), carrier records stay with the
 * safety manager) is the later and narrower one, and those are the two roles holding `roster: manage`
 * that filed these on the old page. It also means the Settings entry reappears in their sidebar, with
 * this one card behind it. An admin can switch it off per role or per person.
 *
 * ── WHY THE CALLOUT ─────────────────────────────────────────────────────────────────────────────────
 * Insurance and IFTA are filed ONCE, here, for the whole fleet (UNIT-FILES-PLAN D-UF6), and every
 * tractor's file counts them. Measured on production 2026-11-05: the carrier had filed neither (no
 * organization record of any kind), so every truck's File filter read "missing" on both — and IFTA could
 * not have been filed anywhere, because the contract refused it on the organization until this step.
 * The callout names what is missing and what that does to the trucks; it goes as soon as both are on file.
 */
const session = useSessionStore();
const orgId = computed(() => session.orgId ?? null);
const certs = useCertificationsQuery(ref("organization"), orgId);

const missingFleetPapers = computed(() => {
  if (!certs.data.value) return [];
  const filed = new Set(certs.data.value.map((c) => c.kind));
  return FLEET_WIDE_UNIT_KINDS.filter((k) => !filed.has(k));
});
const missingLabel = computed(() => missingFleetPapers.value.map((k) => DQ_KIND_LABELS[k] ?? k).join(" and "));
/** Whether this reader can file them: they are the equipment section's (`fileSectionFor`, D-UF5). */
const canFileFleetPapers = computed(() =>
  missingFleetPapers.value.every((k) => session.can(fileSectionFor("organization", k))),
);
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      description="The carrier's own records: PHMSA registration, operating authority, security plan, financial responsibility, and the fleet's insurance and IFTA."
    />

    <AppCallout v-if="missingFleetPapers.length" tone="caution" data-testid="fleet-papers-missing">
      {{ missingLabel }} {{ missingFleetPapers.length === 1 ? "is" : "are" }} not on file. Every truck's
      file counts {{ missingFleetPapers.length === 1 ? "it" : "them" }} as missing until the company's
      {{ missingFleetPapers.length === 1 ? "is" : "are" }} filed here.
      <template v-if="!canFileFleetPapers">Filing {{ missingFleetPapers.length === 1 ? "it" : "them" }} needs permission to manage vehicles.</template>
    </AppCallout>

    <!-- A form written for a slide-over: held to a readable width on a full page. -->
    <div class="max-w-3xl">
      <CertManager v-if="orgId" subject-type="organization" :subject-id="orgId" />
    </div>
  </div>
</template>
