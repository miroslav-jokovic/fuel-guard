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
 * ── WHY THERE IS A SECOND BUTTON, AND WHY IT IS NOT THE DEFAULT ───────────────────────────────
 * Four of these instruments have a better source than our placeholder, and they are better in two
 * different ways. Three were written by the carrier's own lawyers, on pages 14, 19 and 21 of their
 * packet (`docs/plans/recruitment/APPLICATION.xlsx`) — publishing ours beside that packet would give
 * one driver's file two texts for one instrument, with nothing afterwards able to say which they
 * read. The fourth, PSP, is the regulator's: FMCSA publishes the disclosure and requires it in
 * whole, exactly as provided, so it is not the carrier's to word at all and the API refuses
 * anything else.
 *
 * ⚠ Both still fill the editor and stop. Nothing publishes without somebody reading it and pressing
 * Publish, because adopting a legal instrument is the carrier's act and not a button's — and for
 * PSP, reading it is the point, since the office is agreeing to show a driver four hundred words
 * they had no hand in. The two instruments with no source show no button, which is the honest
 * rendering of the fact rather than a gap to be papered over.
 *
 * ── WHY THE PREVIEW COLLAPSES ─────────────────────────────────────────────────────────────────
 * Measured 2026-09-13, once the real instruments replaced the placeholders: FMCSA's PSP disclosure
 * is **6,018 characters** where our placeholder was 409, and the carrier's past-employment release
 * is 3,085. Six cards rendering every body in full is roughly eleven thousand characters of dense
 * legal text with the Publish buttons scattered somewhere inside it — a page whose one job is to
 * show a count somebody can act on, buried under fifteen screens of scrolling.
 *
 * So a long body is clamped with a control to open it. ⚠ The clamp is on the PREVIEW only and never
 * on the editor: an office about to publish a legal instrument must be able to read the whole of it,
 * and a textarea that hides two thirds of what is being published would be the worse defect by far.
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

/** Which long previews the office has opened. Collapsed again whenever the page reloads. */
const expanded = ref<Set<string>>(new Set());
/** Past this, a body is a wall rather than a paragraph. The FCRA page is 498 characters; PSP is 6,018. */
const PREVIEW_LIMIT = 700;
const isLong = (row: WordingInstrumentView): boolean => (row.body?.length ?? 0) > PREVIEW_LIMIT;
function toggle(instrument: string): void {
  const next = new Set(expanded.value);
  if (!next.delete(instrument)) next.add(instrument);
  expanded.value = next;
}

/** The working copy, per instrument, so opening an editor and closing it changes nothing. */
const draft = reactive<Record<string, { title: string; intent: string; body: string; clauses: Record<string, string> }>>({});

const instruments = computed(() => wording.data.value?.instruments ?? []);
const outstanding = computed(() => wording.data.value?.outstandingCount ?? 0);

const labelFor = (i: PublishableInstrument): string => PUBLISHABLE_INSTRUMENT_LABELS[i];
const isConsent = (i: PublishableInstrument): boolean => i === "esign_consent";

/** Load the instrument's proper source into the open editor, replacing whatever is in it. */
function useSource(row: WordingInstrumentView): void {
  const d = draft[row.instrument];
  if (!d || !row.source) return;
  d.title = row.source.title;
  d.body = row.source.body;
  d.intent = row.source.intent;
}

const sourceAction = (row: WordingInstrumentView): string =>
  row.source?.kind === "fmcsa" ? "Use the FMCSA wording" : "Use our packet's wording";

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
        <!-- ⚠ Clamped, not truncated: the full text is in the DOM and one control away, because
             "read this before you publish it" is the whole instruction on this page. -->
        <div v-else>
          <p
            class="text-sm whitespace-pre-line text-ink-muted"
            :class="{ 'line-clamp-6': isLong(row) && !expanded.has(row.instrument) }"
          >{{ row.body }}</p>
          <!-- `variant="link"` and not a raw <button>: the primitive already has the inline
               action this needs, and re-styling one is what `lint:ui-adoption` exists to catch. -->
          <BaseButton v-if="isLong(row)" variant="link" class="mt-2 text-sm" @click="toggle(row.instrument)">
            {{ expanded.has(row.instrument)
              ? "Show less"
              : `Show all ${row.body?.length.toLocaleString()} characters` }}
          </BaseButton>
        </div>
        <p class="text-sm text-ink-secondary">{{ row.intent }}</p>
        <div class="flex flex-wrap items-center gap-3">
          <BaseButton variant="secondary" @click="open(row)">
            {{ row.published ? "Publish a correction" : "Review and publish" }}
          </BaseButton>
          <p v-if="row.source" class="text-sm text-ink-muted">{{ row.source.provenance }}</p>
        </div>
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
        <!-- ⚠ Never clamped, and scaled to what is in it. FMCSA's PSP disclosure is 6,018
             characters; proof-reading that through a ten-row window is how a missing paragraph
             gets published. -->
        <FormField v-else v-slot="{ id }" label="The wording" hint="Exactly as the applicant will read it.">
          <AppTextarea
            :id="id"
            v-model="draft[row.instrument]!.body"
            :rows="draft[row.instrument]!.body.length > PREVIEW_LIMIT ? 28 : 10"
          />
        </FormField>

        <!-- The proper source, one press away. Only where one exists: two of the six have neither
             a page in the carrier's packet nor a form from the regulator. -->
        <div v-if="row.source" class="flex flex-wrap items-center gap-3">
          <BaseButton variant="secondary" @click="useSource(row)">{{ sourceAction(row) }}</BaseButton>
          <p class="text-sm text-ink-muted">{{ row.source.provenance }}</p>
        </div>

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
