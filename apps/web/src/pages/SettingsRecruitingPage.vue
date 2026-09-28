<script setup lang="ts">
import PageHeader from "@/components/ui/PageHeader.vue";
import SettingsSection from "@/components/ui/SettingsSection.vue";
import SignatoryRegister from "@/features/recruitment/SignatoryRegister.vue";

/**
 * Settings → Recruiting (APPLICATION-FLOW-V2-PLAN.md R1, Q-AW42 ruled (a) by the owner 2026-09-28).
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────────────────────────────
 * A carrier Representative (who countersigns the driver handbook, D-HB3) and a road-test examiner (who
 * signs the §391.31 form and certificate, Q-RT2) could each be added only inside ONE driver's hiring
 * drawer, and only once that driver had reached the step. Production held no Representative on
 * 2026-09-28, so the first handbook would have waited at its countersignature for somebody to be
 * added mid-hire. This is the place to add them ahead of time. The panels keep their inline add; both
 * show the same form (`SignatoryAddForm`), so there is one set of rules for a complete entry.
 *
 * ── WHO REACHES IT ────────────────────────────────────────────────────────────────────────────
 * The catalogue's `admin.recruiting` entry, `section("recruitment")`: anybody who can view recruiting
 * sees the lists, and `SignatoryRegister` offers the writes on `manage` — both from the section matrix,
 * both what the api asks. It is NOT under `admin.settings`' own gate: a recruiter holds
 * `settings: none` and `recruitment: manage`, and is the person this page is for.
 *
 * ── ROOM FOR THE NEXT SECTION ─────────────────────────────────────────────────────────────────
 * Q-AW41's invitation settings (the link's lifetime and the reminder, S1/S2) land on this page as a
 * third `SettingsSection`; each section is self-contained so adding one moves nothing here.
 */
</script>

<template>
  <div class="space-y-8">
    <PageHeader description="The people who sign hiring paperwork for the carrier." />

    <SettingsSection
      title="Representatives"
      description="Countersign the driver handbook for the carrier. Their signature prints on the Agreed line."
    >
      <div class="rounded-surface bg-surface p-4 ring-1 ring-edge">
        <SignatoryRegister kind="representative" />
      </div>
    </SettingsSection>

    <SettingsSection
      title="Road-test examiners"
      description="Give the road test. Their signature prints on the road-test form and on the certificate."
    >
      <div class="rounded-surface bg-surface p-4 ring-1 ring-edge">
        <SignatoryRegister kind="examiner" />
      </div>
    </SettingsSection>
  </div>
</template>
