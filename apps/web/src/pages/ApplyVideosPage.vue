<!-- ui-adoption: not-a-record — the token is a public link, not a record id, as on ApplyPage: every dead
     link answers identically by design, and the applicant has no list to go back to. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { formatDisplayDateTime, orientationVideoAttestSchema, type ApplicantVideoPage } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCallout,
  AppCard as BaseCard,
  AppCheckbox,
  AppFormField as FormField,
  AppInput as BaseInput,
} from "@silvicom/ui";
import { publicFetch } from "@/features/apply/useApplication";
import { APPLY_COPY } from "@/features/apply/strings";
import { applyLanguage } from "@/features/apply/language";

/**
 * The applicant's orientation videos (HW8a, 0539; HIRING-WORKFLOW-AUDIT-2026-10-31 §4.8, §8.2) — what the
 * office's "Send the videos" opens, on the application link's own token (`/apply/<token>/videos`).
 *
 * ── A LINK LIST AND ONE TICK ──────────────────────────────────────────────────────────────────
 * Each video is a link to wherever the carrier keeps it; pressing it is recorded as OPENED (and nothing
 * more — this page cannot see a video play). At the bottom, one tick, "I watched these videos", and the
 * driver's name: their word, which the checklist reads as the step done once every required video is in
 * it. The tick names every video on the page — the list they were shown — and the server checks it
 * against the carrier's live list (0539's trigger), so a list changed meanwhile is a reload, not a lie.
 *
 * A dead link is the surface's one neutral sentence, as on the application page.
 */
const route = useRoute();
const token = computed(() => String(route.params.token ?? ""));
const copy = computed(() => APPLY_COPY.videos);

const pageQ = useQuery({
  queryKey: computed(() => ["apply-videos", token.value] as const),
  enabled: computed(() => Boolean(token.value)),
  retry: false,
  queryFn: () => publicFetch<ApplicantVideoPage>(`/${token.value}/videos`),
});
const page = computed(() => pageQ.data.value ?? null);
const allTicked = computed(() => Boolean(page.value && page.value.videos.length > 0 && page.value.videos.every((v) => v.attested)));

/** Fire and forget: the link opens in its own tab whatever this answers. */
function opened(videoId: string): void {
  void publicFetch(`/${token.value}/videos/${videoId}/opened`, { method: "POST" }).catch(() => undefined);
}

const watched = ref(false);
const name = ref("");
const sending = ref(false);
const failure = ref<string | null>(null);
const candidate = computed(() => ({ name: name.value, videoIds: (page.value?.videos ?? []).map((v) => v.id) }));
const ready = computed(() => watched.value && orientationVideoAttestSchema.safeParse(candidate.value).success);

async function attest(): Promise<void> {
  if (!ready.value) return;
  sending.value = true;
  failure.value = null;
  try {
    await publicFetch(`/${token.value}/videos/attest`, { method: "POST", body: JSON.stringify(candidate.value) });
    watched.value = false;
  } catch (e) {
    failure.value = (e as { code?: string }).code === "list_changed" ? copy.value.changed : copy.value.failed;
  } finally {
    sending.value = false;
    await pageQ.refetch();
  }
}
</script>

<template>
  <div :key="applyLanguage" class="space-y-4">
    <div v-if="pageQ.isPending.value" class="text-sm text-ink-muted">{{ APPLY_COPY.page.opening }}</div>

    <BaseCard v-else-if="pageQ.isError.value || !page">
      <h1 class="text-lg font-semibold text-ink">{{ copy.heading }}</h1>
      <p class="mt-2 text-sm text-ink-muted" data-testid="dead-link">{{ pageQ.error.value?.message }}</p>
    </BaseCard>

    <BaseCard v-else>
      <h1 class="text-lg font-semibold text-ink">{{ copy.heading }}</h1>
      <p v-if="page.videos.length === 0" class="mt-2 text-sm text-ink-secondary" data-testid="no-videos">{{ copy.none(page.carrier) }}</p>
      <template v-else>
        <p class="mt-2 text-sm text-ink-secondary">{{ copy.intro(page.carrier) }}</p>
        <ul class="mt-4 divide-y divide-edge">
          <li v-for="v in page.videos" :key="v.id" class="flex items-center justify-between gap-4 py-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-ink">{{ v.title }}</p>
              <p class="text-xs text-ink-muted">
                {{ v.required ? copy.required : copy.optional }}{{ v.minutes ? ` · ${copy.minutes(v.minutes)}` : "" }}
                <span v-if="v.attested"> · {{ copy.ticked }}</span>
              </p>
            </div>
            <a
              :href="v.url"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-link hover:text-link-hover"
              :data-testid="`open-${v.id}`"
              @click="opened(v.id)"
            >{{ copy.open }}</a>
          </li>
        </ul>

        <p v-if="page.lastAttestation" class="mt-4 text-sm text-ink-secondary" data-testid="attested">
          {{ allTicked ? copy.allDone : copy.done(formatDisplayDateTime(page.lastAttestation.attestedAt)) }}
        </p>

        <div v-if="!allTicked" class="mt-4 space-y-3 border-t border-edge pt-4" data-testid="attest">
          <h2 class="text-sm font-semibold text-ink">{{ copy.attestHeading }}</h2>
          <AppCheckbox v-model="watched" :label="copy.attestLabel" />
          <FormField v-slot="{ id }" :label="copy.nameLabel">
            <BaseInput :id="id" v-model="name" autocomplete="name" />
          </FormField>
          <AppCallout v-if="failure" tone="caution">{{ failure }}</AppCallout>
          <BaseButton variant="primary" :disabled="!ready || sending" data-testid="attest-send" @click="attest">
            {{ sending ? copy.submitting : copy.submit }}
          </BaseButton>
        </div>
      </template>
      <BaseButton variant="link" size="sm" class="mt-4" :to="`/apply/${token}`">{{ copy.backToApplication }}</BaseButton>
    </BaseCard>
  </div>
</template>
