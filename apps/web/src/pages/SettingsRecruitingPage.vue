<script setup lang="ts">
import PageHeader from "@/components/ui/PageHeader.vue";
import SettingsSection from "@/components/ui/SettingsSection.vue";
import SignatoryRegister from "@/features/recruitment/SignatoryRegister.vue";
import RecruitingSettingsForm from "@/features/recruitment/RecruitingSettingsForm.vue";

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
 * sees the lists, and `SignatoryRegister` offers the writes to each register's keeper — `recruitment`
 * manage for Representatives, `ROAD_TEST_EXAMINER_SECTION` (the admin, 2026-09-29) for examiners —
 * both from the section matrix, both what the api asks. It is reached from a card on the Settings page and has no sidebar entry
 * (owner's ruling 2026-09-28). Its gate is still not `settings`', so a recruiter who holds
 * `settings: none` can use it by URL, though they have no link to it: the owner ruled the admin keeps
 * this register. A recruiter can still add a Representative inline from the handbook panel when a hire
 * needs one; an examiner only the admin adds, anywhere.
 *
 * ── APPLICATION LINKS (S2, Q-AW41) ────────────────────────────────────────────────────────────
 * The link's lifetime and the reminder, first on the page because it shapes every invitation, where the
 * two registers above are consulted once per hire. `RecruitingSettingsForm` holds its own reads and
 * gate, as each register does, so the sections stay independent.
 */
</script>

<template>
  <div class="space-y-8">
    <PageHeader description="How application links behave, and the people who sign hiring paperwork for the carrier." />

    <SettingsSection
      title="Application links"
      description="How long a driver's link stays open, and whether a driver who stops is reminded."
    >
      <div class="rounded-surface bg-surface p-4 ring-1 ring-edge">
        <RecruitingSettingsForm />
      </div>
    </SettingsSection>

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
