<script setup lang="ts">
import { AppButton as BaseButton } from "@fuelguard/ui";
import { useToastStore } from "@/stores/toast";

/**
 * The one moment an application token exists outside the applicant's inbox (H5b, U1).
 *
 * The server stores a SHA-256 and nothing else, so there is no re-read and no resend that recovers
 * this string. Extracted from `ApplicationInviteCard` when U1 gave the invitation a second birthplace
 * on the applicant board: two copies of a "we cannot show you this again" promise is exactly the
 * wording that drifts, and a recruiter who reads the softer of the two loses a link believing it can
 * be fetched back.
 */
defineProps<{ link: string }>();

const toast = useToastStore();

async function copyLink(link: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(link);
    toast.success("Link copied");
  } catch {
    // Clipboard access is refused in some browsers and contexts; the link is on screen either way.
    toast.error("Could not copy", "Select the link and copy it manually.");
  }
}
</script>

<template>
  <div class="rounded-surface bg-surface-muted p-3">
    <p class="text-xs font-medium text-ink-secondary">Send this link to the applicant</p>
    <p class="mt-1 break-all font-mono text-xs text-ink">{{ link }}</p>
    <div class="mt-3 flex items-center gap-3">
      <BaseButton size="sm" @click="copyLink(link)">Copy the link</BaseButton>
      <p class="text-xs text-ink-muted">
        It is shown once. We keep only a fingerprint of it, so it cannot be shown again — create a
        new invitation if it is lost.
      </p>
    </div>
  </div>
</template>
