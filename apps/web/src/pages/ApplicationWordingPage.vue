<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  AppButton as BaseButton,
  AppCallout,
  AppCard as BaseCard,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppTextarea,
} from "@silvicom/ui";
import {
  ESIGN_CONSENT_CLAUSES,
  ESIGN_CONSENT_CLAUSE_LABELS,
  PUBLISHABLE_INSTRUMENT_LABELS,
  type EsignConsentClause,
  type PublishableInstrument,
} from "@silvicom/shared";
import PageHeader from "@/components/ui/PageHeader.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import { useToastStore } from "@/stores/toast";
import {
  useApplicationWordingQuery,
  usePublishWording,
  type WordingInstrumentView,
} from "@/features/settings/useApplicationWording";

/**
 * Publishing the wording an applicant signs (0338).
 *
 * ── WHY THIS SCREEN EXISTS AT ALL ─────────────────────────────────────────────────────────────
 * Every instrument ships as `v0-draft` placeholder text that we wrote, and `isDraftDisclosure()`
 * reads that version string: behind it refuse every submission, every signature, the 15 U.S.C.
 * 7001(c) consent, every PSP order, every §40.25 letter and every Clearinghouse query. A driver who
 * fills in nine screens meets a disabled button reading "Not ready to send yet".
 *
 * ⚠ The wording is not ours to write, and until this screen existed publishing it took an engineer
 * and a deploy. That is the missing capability the whole table was built for — the carrier has
 * drafted text, counsel has to rule on it, and neither of them can reach a TypeScript constant.
 *
 * ── WHAT THE PAGE LEADS WITH ──────────────────────────────────────────────────────────────────
 * The count of what is still unpublished, because it is the only number on the screen anybody can
 * act on: until it is zero, nothing an applicant does works. Every other thing here is detail.
 *
 * ── AND WHY THE CONSENT LOOKS DIFFERENT ───────────────────────────────────────────────────────
 * It is six statutory disclosures — 7001(c)(1)(B)(i)(I) through (c)(1)(C)(i) — not one block of
 * text, so it is published as six fields. A consent missing one of them is not a consent, and the
 * applicant's screen renders whatever it is given; the API refuses a gap and names which clause.
 */
const wording = useApplicationWordingQuery();
const publish = usePublishWording();
const toast = useToastStore();

/** Which instrument's editor is open. One at a time — publishing is not a thing to do in a hurry. */
const editing = ref<PublishableInstrument | null>(null);

/** The working copy, per instrument, so opening an editor and closing it changes nothing. */
const draft = reactive<Record<string, { title: string; intent: string; body: string; clauses: Record<string, string> }>>({});

const instruments = computed(() => wording.data.value?.instruments ?? []);
const outstanding = computed(() => wording.data.value?.outstandingCount ?? 0);

const labelFor = (i: PublishableInstrument): string => PUBLISHABLE_INSTRUMENT_LABELS[i];
const isConsent = (i: PublishableInstrument): boolean => i === "esign_consent";

function open(row: WordingInstrumentView): void {
  draft[row.instrument] = {
    title: row.title,
    intent: row.intent,
    body: row.body ?? "",
    // Pre-filled with whatever is live — which for an unpublished instrument is our placeholder, and
    // that is the point: the office edits a starting draft rather than facing six empty boxes.
    clauses: Object.fromEntries(ESIGN_CONSENT_CLAUSES.map((c) => [c, row.clauses?.[c] ?? ""])),
  };
  editing.value = row.instrument;
}

async function save(instrument: PublishableInstrument): Promise<void> {
  const d = draft[instrument];
  if (!d) return;
  try {
    const result = await publish.mutateAsync({
      instrument,
      title: d.title,
      intent: d.intent,
      ...(isConsent(instrument) ? { clauses: d.clauses } : { body: d.body }),
    });
    editing.value = null;
    toast.push("success", `${labelFor(instrument)} published as ${result.version}`);
  } catch (e) {
    toast.push("error", e instanceof Error ? e.message : "That could not be published.");
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader />

    <!-- The one number anybody can act on. Until it is zero, nothing an applicant does works. -->
    <AppCallout v-if="outstanding > 0" tone="caution">
      {{ outstanding }} of {{ instruments.length }} documents still use our placeholder wording. Until
      every one is published, applicants cannot send their application or sign anything, and no
      background check can be ordered.
    </AppCallout>
    <AppCallout v-else-if="instruments.length" tone="success">
      All {{ instruments.length }} documents are published. Applicants can sign and send.
    </AppCallout>

    <p v-if="wording.isLoading.value" class="text-sm text-ink-muted">Loading…</p>

    <BaseCard v-for="row in instruments" :key="row.instrument">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-ink">{{ labelFor(row.instrument) }}</h2>
          <p class="mt-1 text-sm text-ink-muted">{{ row.title }}</p>
        </div>
        <span :class="[BADGE_BASE, toneClass(row.published ? 'success' : 'warning')]">
          {{ row.published ? `Live · ${row.version}` : "Our placeholder" }}
        </span>
      </div>

      <!-- What is live today, read-only. An office publishing a correction needs to see what it is
           correcting, and for an unpublished instrument this is the text a driver would meet. -->
      <div v-if="editing !== row.instrument" class="mt-4 space-y-3">
        <div v-if="row.clauses" class="space-y-2">
          <div v-for="clause in ESIGN_CONSENT_CLAUSES" :key="clause">
            <p class="text-xs font-medium text-ink-secondary">{{ ESIGN_CONSENT_CLAUSE_LABELS[clause] }}</p>
            <p class="text-sm whitespace-pre-line text-ink-muted">{{ row.clauses[clause] }}</p>
          </div>
        </div>
        <p v-else class="text-sm whitespace-pre-line text-ink-muted">{{ row.body }}</p>
        <p class="text-sm text-ink-secondary">{{ row.intent }}</p>
        <BaseButton variant="secondary" @click="open(row)">
          {{ row.published ? "Publish a correction" : "Publish our wording" }}
        </BaseButton>
      </div>

      <div v-else class="mt-4 space-y-4">
        <FormField v-slot="{ id }" label="Heading" hint="What the applicant sees above the text.">
          <BaseInput :id="id" v-model="draft[row.instrument]!.title" />
        </FormField>

        <div v-if="isConsent(row.instrument)" class="space-y-4">
          <!-- ⚠ Six fields, not one box. Each is a separate statutory disclosure and the law requires
               all of them; publishing refuses a gap and names which one is empty. -->
          <FormField
            v-for="clause in ESIGN_CONSENT_CLAUSES"
            v-slot="{ id }"
            :key="clause"
            :label="ESIGN_CONSENT_CLAUSE_LABELS[clause]"
          >
            <AppTextarea :id="id" v-model="draft[row.instrument]!.clauses[clause as EsignConsentClause]" :rows="3" />
          </FormField>
        </div>
        <FormField v-else v-slot="{ id }" label="The wording" hint="Exactly as the applicant will read it.">
          <AppTextarea :id="id" v-model="draft[row.instrument]!.body" :rows="10" />
        </FormField>

        <FormField
          v-slot="{ id }"
          label="What they are agreeing to"
          hint="One sentence, shown beside their signature. This is what evidences their intent to sign."
        >
          <AppTextarea :id="id" v-model="draft[row.instrument]!.intent" :rows="2" />
        </FormField>

        <AppCallout tone="caution">
          Publishing makes this the text every applicant signs from now on. It is kept for ever and
          numbered — anything already signed keeps the version it was signed under.
        </AppCallout>

        <div class="flex flex-wrap items-center justify-end gap-3">
          <BaseButton variant="secondary" @click="editing = null">Cancel</BaseButton>
          <BaseButton variant="primary" :disabled="publish.isPending.value" @click="save(row.instrument)">
            {{ publish.isPending.value ? "Publishing…" : "Publish" }}
          </BaseButton>
        </div>
      </div>
    </BaseCard>

    <BaseCard v-if="wording.data.value?.history.length">
      <h2 class="text-base font-semibold text-ink">Everything ever published</h2>
      <p class="mt-1 text-sm text-ink-muted">
        Kept for ever, because a signature points at the version it was signed under.
      </p>
      <ul class="mt-3 space-y-2">
        <li
          v-for="row in wording.data.value.history"
          :key="`${row.instrument}-${row.version}`"
          class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"
        >
          <span class="text-ink">{{ labelFor(row.instrument) }} · {{ row.version }}</span>
          <span class="text-xs text-ink-muted">{{ formatDateTime(row.publishedAt) }}</span>
        </li>
      </ul>
    </BaseCard>
  </div>
</template>
