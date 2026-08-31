<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import type { Driver } from "@silvicom/shared";
import { supabase } from "@/lib/supabase";
import PageHeader from "@/components/ui/PageHeader.vue";
import ApplicationInviteCard from "@/features/recruitment/ApplicationInviteCard.vue";
import DispositionSection from "@/features/recruitment/DispositionSection.vue";
import EmploymentHistorySection from "@/features/recruitment/EmploymentHistorySection.vue";
import EmployerInquirySection from "@/features/recruitment/EmployerInquirySection.vue";
import PspRecordsSection from "@/features/recruitment/PspRecordsSection.vue";

/**
 * One applicant's hiring paperwork — the recruiting surface's own record page (R7, D-ROS6).
 *
 * ── WHY THIS PAGE HAD TO EXIST BEFORE RECRUITING COULD LEAVE ────────────────────────────────────
 * The five sections below are all PER-DRIVER, and the recruitment surface was three lists. "Move
 * recruiting off the driver page" had no destination until this page did — which is why R7 creates
 * one rather than scattering the sections into pages that answer a different question.
 *
 * ── AND WHY THEY BELONG TOGETHER HERE, HAVING BEEN SPLIT THERE ──────────────────────────────────
 * U6 split these across three tabs on the DRIVER page, and was right to: the cut was by who does the
 * work, and on a page a dispatcher, a safety manager and a recruiter all open, four regulations
 * under one noun is four things the reader has to tell apart. Here there is only one reader and one
 * job — the recruiter, hiring this person — so the sum is the point rather than the problem. The
 * order is the order the work happens in: ask, record what they said, investigate it, file what the
 * investigation bought, decide.
 *
 * `?section=application|employment|screening` on `/drivers/:id` redirects here and keeps resolving
 * (`relocatedSectionPath`). Those values are in bookmarks and binder references, so they are still
 * part of the vocabulary — only their destination moved.
 */
const route = useRoute();
const id = computed(() => String(route.params.id ?? ""));

const { data: driver } = useQuery({
  queryKey: ["driver-detail", id],
  enabled: computed(() => Boolean(id.value)),
  queryFn: async (): Promise<Driver | null> => {
    const { data, error } = await supabase.from("drivers").select("*").eq("id", id.value).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Driver | null) ?? null;
  },
});
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      :title="driver?.full_name ?? 'Applicant'"
      description="The application, the employment history it declares, the §391.23 investigation of that history, and the decision."
    />

    <!-- The recruiter's act of asking, and the act that ends it (0238). An applicant who is hired
         stops being one; a disposition is how that is recorded rather than left implied. -->
    <ApplicationInviteCard :driver-id="id" :driver-status="driver?.status ?? ''" />
    <DispositionSection :driver-id="id" :driver-status="driver?.status ?? ''" />

    <!-- §391.21(b)(10)'s record and §391.23's investigation OF that record. One job, and the only
         pair U6 said was always meant to be adjacent. -->
    <EmploymentHistorySection :driver-id="id" />
    <EmployerInquirySection :driver-id="id" />

    <!-- The vendor ledger the investigation buys from. It sat on the driver page because the
         qualification section's write affordances gated on a permission a recruiter does not hold —
         a layout decision made by a permission bug. R0 removed the bug; R7 removes the layout. -->
    <PspRecordsSection :driver-id="id" />
  </div>
</template>
