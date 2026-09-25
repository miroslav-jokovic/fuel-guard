<script setup lang="ts">
import { computed } from "vue";
import { hiringStep, type HiringChecklist, type HiringStep, type HiringStepKey } from "@silvicom/shared";
import { AppButton as BaseButton, AppCard as BaseCard, AppIcon } from "@silvicom/ui";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { hiringStepStateBadge } from "@/lib/badges.recruiting";
import { hiringArtifactLink } from "@/features/recruitment/hiringArtifacts";

/**
 * Where one applicant has got to, a row at a time (B5, `HIRING-UI-PLAN.md` §5, mockup screen 2).
 *
 * ── WHAT A ROW IS ALLOWED TO SAY (D-HUI3) ─────────────────────────────────────────────────────
 * Three questions and nothing else: **what it is** in plain words, **who it is waiting on**, and
 * **the artifact that proves it**. Not a description, not a regulation, not a history — those go in
 * the drawer B6 builds. That discipline is what keeps a fourteen-row list readable, and it is the
 * one `ApplyProgress`'s rows already follow on the applicant's side.
 *
 * ── AND WHAT IT REFUSES TO SAY ────────────────────────────────────────────────────────────────
 * ⚠ Nothing here decides anything. State, blocker, artifact, the next action and both readiness
 * answers arrive folded from `hiringChecklist.ts` in `packages/shared` (D-HM1/D-HM2), so the
 * office's screen and the applicant's own screen cannot tell two stories about one person — the
 * defect `HIRING-MODULE-PLAN.md` §1 records shipping twice. The only things this file owns are the
 * dressing (`badges.recruiting.ts`) and the addresses (`hiringArtifacts.ts`).
 *
 * ── NOT A SHARED PRIMITIVE, ON PURPOSE (D-HUI2 / D-DS18) ──────────────────────────────────────
 * It lives in `features/recruitment/` and moves to `@/components/ui/` when a second surface needs
 * it — the named candidate is the DQF page, which is the same shape for a hired driver (Q-HUI3,
 * ruled: promotion waits until this one has shipped and been used). Building it shared on day one
 * means designing its API by guessing.
 *
 * ── THE PAGE IT SITS ON TODAY ─────────────────────────────────────────────────────────────────
 * `ApplicantRecordPage.vue`, above the five sections. ⚠ **B6 rebuilds that page around this
 * component** — checklist plus `SlideOver`, the five sections becoming drawer bodies — so the rows
 * deliberately do not invent navigation of their own beyond the artifact link.
 */
const props = defineProps<{
  driverId: string;
  checklist: HiringChecklist | null;
  loading?: boolean;
  error?: string | null;
}>();

/**
 * The row is where the work starts (B6).
 *
 * ⚠ The card does not own the drawer, and that is the boundary that keeps this reusable: it says
 * WHICH step the reader chose and nothing about what happens next. Q-HUI3 already names the DQF
 * page as the second consumer that promotes this component out of `features/`, and a drawer wired
 * in here would be a recruitment-shaped assumption baked into it before that move.
 */
const emit = defineEmits<{ open: [step: HiringStep] }>();

/**
 * Progress is a percentage of STEPS, not of screens.
 *
 * ⚠ The applicant's wizard counts screens and this counts steps; mixing them produces a number that
 * moves for the wrong reason. And completed steps stay counted rather than being filtered out —
 * `usePacketCeremony` learned that one the hard way: *"the count a driver is watching must not move
 * while they are watching it."*
 */
const percent = computed(() => {
  const c = props.checklist;
  if (!c || c.total === 0) return 0;
  return Math.round((c.done / c.total) * 100);
});

/**
 * The one action to lead with, as the STEP rather than as a string.
 *
 * ⚠ `action` and not `label` — an instruction, never a completed fact (B4's defect, one field over).
 * B6 needs the step itself as well as its words, because the lead action is now a button that opens
 * the same drawer the row opens: two affordances, one destination, so a recruiter who reads *"Next:
 * verify the medical certificate"* and presses it lands exactly where the row would have taken them.
 */
const nextStep = computed<HiringStep | null>(
  () => props.checklist?.steps.find((s) => s.key === props.checklist?.next) ?? null,
);
const nextAction = computed(() => (nextStep.value ? hiringStep(nextStep.value.key).action : null));

const stepLabel = (key: HiringStepKey): string => hiringStep(key).label;

/**
 * The travel answer, in the only form it may honestly take (D-HM9, and B1's own header).
 *
 * ⚠ `readyToTravel` is NOT a boolean and rendering it as a green tick would be reporting a gate
 * nobody has checked. Step 9 — the orientation videos — is inside its range and has no evidence
 * table in this schema, so `ok` is false for everybody until D4 ships, and it says so by name. This
 * is the medical-certificate lesson one level up: *capture* was read as *verification* for weeks,
 * and a summary that treats "we have no way to check" as "checked" is that mistake with a wider
 * blast radius. Q-HM5 makes travel a hard gate on the invitation to come in, so it is not cosmetic.
 */
const travel = computed(() => {
  const r = props.checklist?.readyToTravel;
  if (!r) return null;
  if (r.ok) return { ready: true, sentence: "Everything before the office day is done." };
  const parts: string[] = [];
  if (r.outstanding.length > 0) {
    parts.push(`${r.outstanding.length} step${r.outstanding.length === 1 ? "" : "s"} outstanding`);
  }
  if (r.unmeasured.length > 0) {
    parts.push(`${r.unmeasured.map(stepLabel).join(", ").toLowerCase()} cannot be checked yet`);
  }
  return { ready: false, sentence: `Not ready to travel — ${parts.join(", and ")}.` };
});

/** The row's artifact, once there is one: its words, and somewhere to go if there is anywhere. */
const artifactOf = (key: HiringStepKey) => {
  const step = props.checklist?.steps.find((s) => s.key === key);
  if (!step?.artifact) return null;
  return { ...step.artifact, ...hiringArtifactLink(step.artifact.table, props.driverId) };
};
</script>

<template>
  <BaseCard>
    <div class="space-y-4">
      <!-- ⚠ The heading carries the count IN WORDS and the bar is `aria-hidden`; `ApplyProgress`
           ruled that and nothing here changes it. The live region announces the whole sentence
           atomically rather than one region per badge — twelve chattering rows is not a reading. -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="text-sm font-semibold text-ink">
            Hiring
            <span v-if="checklist" class="font-normal text-ink-secondary">
              · {{ checklist.done }} of {{ checklist.total }} done
            </span>
          </h2>
          <!-- ⚠ The lead action is a BUTTON, not a sentence. Before B6 the card said what to do
               next and left the reader to find where — which is the gap between a checklist and a
               board, and the reason §4.2's done-when is about doing the thing rather than seeing
               it. `variant="link"` because it reads as part of the sentence it is in; the variant
               exists for exactly this and its own header says why. -->
          <p v-if="nextAction && nextStep" class="mt-1 text-xs text-ink-secondary">
            Next:
            <BaseButton variant="link" class="font-medium text-brand-700" @click="emit('open', nextStep)">
              {{ nextAction }}
            </BaseButton>
          </p>
          <p v-else-if="checklist" class="mt-1 text-xs text-ink-secondary">Nothing left to do.</p>
        </div>
        <div v-if="checklist" class="flex shrink-0 items-center gap-2" aria-hidden="true">
          <span class="text-xs tabular-nums text-ink-secondary">{{ percent }}%</span>
          <span class="h-1.5 w-24 overflow-hidden rounded-detail bg-surface-subtle">
            <span class="block h-full rounded-detail bg-brand-500" :style="{ width: `${percent}%` }" />
          </span>
        </div>
      </div>
      <p v-if="checklist" class="sr-only" role="status" aria-atomic="true">
        {{ checklist.done }} of {{ checklist.total }} hiring steps done.
      </p>

      <p v-if="travel" class="text-xs" :class="travel.ready ? 'text-ink-secondary' : 'text-ink'">
        {{ travel.sentence }}
      </p>

      <p v-if="loading" class="text-xs text-ink-muted">Loading the checklist…</p>
      <p v-else-if="error" class="text-xs text-danger-700">{{ error }}</p>

      <ul v-else-if="checklist" class="divide-y divide-edge border-t border-edge">
        <li
          v-for="step in checklist.steps"
          :key="step.key"
          class="grid gap-x-4 gap-y-1 py-1 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center"
        >
          <!-- ⚠ `BaseButton size="row"`, never a raw `<button>`: `lint:ui-adoption` fails on ANY
               raw button in a page or a feature, and the `row` size exists for this exact shape —
               `h-auto w-full`, left-aligned, normal weight, wrapping. Its own header records that
               it was added because two call sites were faking it with six `!important`s.

               ⚠ And the artifact stays OUTSIDE the button rather than inside it. It is a link, and
               a link nested in a button is invalid markup and an unreachable target for a keyboard
               — two destinations in one row have to be two siblings. -->
          <BaseButton size="row" variant="ghost" class="rounded-detail" @click="emit('open', step)">
            <span class="grid w-full grid-cols-[minmax(0,1fr)_9rem] items-center gap-x-4">
              <span class="text-xs font-medium text-ink">{{ step.label }}</span>

              <!-- D-HUI4: icon AND word, never a coloured dot. The four states are not ordered on a
                   good/bad axis, so only the one that means YOU is toned at all. -->
              <span
                :class="[BADGE_BASE, toneClass(hiringStepStateBadge(step.state).tone), 'justify-self-start']"
              >
                <AppIcon :icon="hiringStepStateBadge(step.state).icon" class="size-3.5" aria-hidden="true" />
                {{ hiringStepStateBadge(step.state).label }}
              </span>
            </span>
          </BaseButton>

          <!-- D-HUI3's third column, load-bearing: the artifact when there is one, the blocker in
               WORDS when the row is blocked, and an em dash when there is honestly nothing to say.
               ⚠ A blocked row never renders as a grey with no explanation — that is the difference
               between a checklist and a wall. -->
          <span class="px-3 text-2xs sm:px-0 sm:justify-self-end sm:text-right">
            <template v-if="artifactOf(step.key)">
              <router-link
                v-if="artifactOf(step.key)!.to"
                :to="artifactOf(step.key)!.to!"
                class="text-brand-700 underline underline-offset-2"
              >
                {{ artifactOf(step.key)!.label }} ↗
              </router-link>
              <!-- ⚠ Words with no link rather than a link to somewhere nearby. `hiringArtifacts.ts`
                   names the four artifacts that have no address yet and why; three of them are on
                   this page and the fourth is the open Q-HUI6. -->
              <span v-else class="text-ink-secondary">{{ artifactOf(step.key)!.label }}</span>
            </template>
            <!-- ⚠ `Needs: <Label>` and not `needs <label>`, which is what shipped for an hour and
                 was found by looking at the page at 1440 on 2026-09-18. The step labels are not one
                 grammatical form — "Permissions signed" is a past-tense fact, "Driving record" is a
                 noun, "Office approved it" is a clause with its own object — so no preposition
                 composes with all twelve. *"needs office approved it"* is what that produced. The
                 colon makes it a label and a value, which reads correctly whatever the value is. -->
            <span v-else-if="step.blockedBy" class="text-ink-muted">
              Needs: {{ stepLabel(step.blockedBy) }}
            </span>
            <!-- AF7, §391.23(a)(1): the licensing states with no MVR on file yet, as the applicant
                 wrote them, so the row says which record to pull rather than only that one is owed. -->
            <span v-else-if="step.outstandingJurisdictions.length" class="text-ink-muted">
              Still needed from: {{ step.outstandingJurisdictions.join(", ") }}
            </span>
            <span v-else class="text-ink-muted">—</span>
          </span>
        </li>
      </ul>
    </div>
  </BaseCard>
</template>
