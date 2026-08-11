<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import {
  ChevronRightIcon,
  ClipboardDocumentCheckIcon,
  LoadsIcon,
  ShieldExclamationIcon,
  TrailerIcon,
  type Icon,
} from "@fuelguard/ui/icons";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { AppButton as BaseButton } from "@fuelguard/ui";

const tools: Array<{ name: string; description: string; action: string; to: string; icon: Icon }> = [
  {
    name: "Placard Calculator",
    description: "Check placards, identification-number displays, segregation, and load eligibility with exact 49 CFR citations.",
    action: "Open calculator",
    to: "/hazmat/calculator",
    icon: ClipboardDocumentCheckIcon,
  },
  {
    name: "Hazmat Loads",
    description: "Create and track declared hazmat loads from initial entry through analysis and clearance.",
    action: "View loads",
    to: "/hazmat/loads",
    icon: LoadsIcon,
  },
  {
    name: "Hazmat Review",
    description: "Work flagged loads oldest-first, inspect the evidence, and record the required review decision.",
    action: "Open review queue",
    to: "/hazmat/review",
    icon: ShieldExclamationIcon,
  },
  {
    // H-C2: tank data lives on the trailer now — this routes to the fleet surface, not a hazmat page.
    name: "Tank Equipment",
    description: "Tank capacity and compartments live on each trailer. Mark a trailer as a tanker and enter its tank there.",
    action: "Open Trailers",
    to: "/trailers",
    icon: TrailerIcon,
  },
];
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Pre-check shipping papers, determine placarding and eligibility, and review flagged hazmat loads." />

    <section class="space-y-3">
      <div>
        <h2 class="text-xs font-semibold uppercase tracking-wider text-ink-muted">Hazmat workflows</h2>
        <p class="mt-1 text-sm text-ink-muted">Choose the workspace that matches the task you need to complete.</p>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BaseCard v-for="tool in tools" :key="tool.to" as="article">
          <div class="flex h-full flex-col">
            <div class="flex items-start gap-4">
              <span class="flex size-10 shrink-0 items-center justify-center rounded-surface bg-brand-50 text-brand-700">
                <AppIcon :icon="tool.icon" class="size-5" aria-hidden="true" />
              </span>
              <div>
                <h3 class="text-sm font-semibold text-ink">{{ tool.name }}</h3>
                <p class="mt-1 text-sm text-ink-muted">{{ tool.description }}</p>
              </div>
            </div>
            <div class="mt-auto pt-5">
              <BaseButton variant="secondary" size="sm" :to="tool.to">
                {{ tool.action }}
                <AppIcon :icon="ChevronRightIcon" class="size-4" aria-hidden="true" />
              </BaseButton>
            </div>
          </div>
        </BaseCard>
      </div>
    </section>
  </div>
</template>
