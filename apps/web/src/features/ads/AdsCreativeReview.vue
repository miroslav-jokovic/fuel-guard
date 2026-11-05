<script setup lang="ts">
import { computed, ref } from "vue";
import type { AdsCreativeView } from "@silvicom/shared";
import { AppButton as BaseButton, AppFormField as FormField, AppInput as BaseInput } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { CREATIVE_STATE_LABEL, copyLines } from "./adsCampaignFlow";

/**
 * One ad on the review screen (E3; D-AD12: a person approves what they have seen): every format and language, its
 * copy, and why it stopped if it did. A rejection needs a reason, which the contract requires and keeps as the record.
 */
const props = defineProps<{ creative: AdsCreativeView; canDecide: boolean; busy: boolean }>();
const emit = defineEmits<{ approve: []; reject: [reason: string] }>();

const rejecting = ref(false);
const reason = ref("");
const languages = computed(() => [...new Set(props.creative.assets.map((a) => a.language))]);
const tone = computed(() => (props.creative.state === "check_failed" || props.creative.state === "rejected" ? "danger" : props.creative.state === "approved" ? "success" : "neutral"));
</script>

<template>
  <article class="space-y-3 rounded-detail p-3 ring-1 ring-edge" data-test="creative">
    <span :class="[BADGE_BASE, toneClass(tone)]">{{ CREATIVE_STATE_LABEL[creative.state] }}</span>
    <p v-if="creative.last_error" class="text-sm text-ink-muted" data-test="creative-error">{{ creative.last_error }}</p>
    <section v-for="l in languages" :key="l" class="space-y-2">
      <h3 class="text-sm font-semibold text-ink">{{ l.toUpperCase() }}</h3>
      <div class="grid grid-cols-3 gap-2">
        <figure v-for="a in creative.assets.filter((x) => x.language === l)" :key="a.sha256">
          <img v-if="a.url" :src="a.url" :alt="`Ad image, ${a.format}, ${l}`" class="w-full rounded-detail" data-test="ad-image" />
          <p v-else class="text-sm text-ink-muted" data-test="no-image">The image could not be loaded.</p>
          <figcaption class="text-xs text-ink-muted">{{ a.format }}</figcaption>
        </figure>
      </div>
      <dl class="space-y-1">
        <div v-for="c in copyLines(creative.copy, l)" :key="c.slot" class="text-sm">
          <dt class="inline text-ink-muted">{{ c.slot }}: </dt><dd class="inline text-ink">{{ c.text }}</dd>
        </div>
      </dl>
    </section>
    <div v-if="canDecide && creative.state === 'ready'" class="space-y-2">
      <FormField v-if="rejecting" v-slot="{ id }" label="Why is this ad rejected?" required>
        <BaseInput :id="id" v-model="reason" data-test="reject-reason" />
      </FormField>
      <div class="flex justify-end gap-2">
        <template v-if="rejecting">
          <BaseButton :disabled="busy" @click="rejecting = false">Cancel</BaseButton>
          <BaseButton variant="danger" :disabled="busy || reason.trim() === ''" data-test="confirm-reject" @click="emit('reject', reason.trim())">Reject this ad</BaseButton>
        </template>
        <template v-else>
          <BaseButton :disabled="busy" data-test="reject" @click="rejecting = true">Reject</BaseButton>
          <BaseButton variant="primary" :disabled="busy" data-test="approve" @click="emit('approve')">Approve</BaseButton>
        </template>
      </div>
    </div>
  </article>
</template>
