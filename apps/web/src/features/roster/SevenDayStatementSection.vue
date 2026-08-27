<script setup lang="ts">
import { computed, ref } from "vue";
import {
  AppButton as BaseButton,
  AppCard as BaseCard,
  AppInput as BaseInput,
  AppDateField,
  AppFormField as FormField,
} from "@silvicom/ui";
import { sevenDayTotal, sevenDayWindow, type SevenDayEntry } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import {
  useRecordSevenDayStatement,
  useSevenDayStatementsQuery,
} from "@/features/roster/useSevenDayStatements";

/**
 * The §395.8(j)(2) seven-day work statement, on the driver's page (P7, D-PKT7).
 *
 * ── WHY IT IS HERE AND NOT IN THE APPLICATION ─────────────────────────────────────────────────
 * Because its answer expires. The regulation counts the seven days preceding the day the driver
 * BEGINS work, so a statement collected during an application is about the wrong week by the time
 * anybody is hired. It sits under Employment — the tab that holds what the carrier did when it took
 * this person on — rather than becoming a seventh tab on a page U6 already worried was one too many.
 *
 * ── WHY THE FORM ASKS FOR THE DRIVER'S NAME RATHER THAN THE RECORDER'S ────────────────────────
 * The driver signs this. What the office does is TRANSCRIBE a signed paper, so `signed_name` is the
 * driver's own name as they wrote it and `recorded_by` — stamped server-side — is whoever typed it
 * in. A form that let an office user sign on a driver's behalf would be manufacturing the evidence.
 *
 * ⚠ **No edit affordance, and that is not an omission.** 0236 refuses UPDATE of the content for
 * everybody (SD010). A correction is a new statement, and the newest is shown first.
 */
const props = defineProps<{ driverId: string }>();

const session = useSessionStore();
const toast = useToastStore();
const statementsQ = useSevenDayStatementsQuery(computed(() => props.driverId));
const record = useRecordSevenDayStatement();

/** Recording one is a fleet lifecycle act — the same gate 0213 puts on a status change. */
const canRecord = computed(() => session.canManage);

const open = ref(false);
const statementDate = ref("");
const lastRelieved = ref("");
const signedName = ref("");
const hours = ref<string[]>(Array.from({ length: 7 }, () => ""));

/**
 * The seven dates the form is asking about, derived from the statement date.
 *
 * ⚠ Derived rather than typed. The window is the regulation's — the seven days BEFORE the statement —
 * and a form that let somebody enter eight dates by hand is a form that produces a lawful-looking
 * total measured over the wrong week, which is the one failure of this record nobody would notice.
 */
const windowDates = computed(() => (statementDate.value ? sevenDayWindow(statementDate.value) : []));
const days = computed((): SevenDayEntry[] =>
  windowDates.value.map((date, i) => ({ date, hours: Number(hours.value[i] ?? 0) })),
);
const total = computed(() => (windowDates.value.length === 7 ? sevenDayTotal(days.value) : 0));

function reset(): void {
  statementDate.value = "";
  lastRelieved.value = "";
  signedName.value = "";
  hours.value = Array.from({ length: 7 }, () => "");
}

const ready = computed(
  () => windowDates.value.length === 7 && Boolean(lastRelieved.value) && signedName.value.trim().length > 0,
);

async function submit(): Promise<void> {
  try {
    await record.mutateAsync({
      driver_id: props.driverId,
      statement_date: statementDate.value,
      days: days.value,
      last_relieved_at: new Date(lastRelieved.value).toISOString(),
      signed_name: signedName.value.trim(),
      // The paper is signed on the day it is made; a separate field would invite a guess.
      signed_on: statementDate.value,
    });
    toast.success("Statement recorded", `${total.value} hours over the seven days before ${statementDate.value}.`);
    open.value = false;
    reset();
  } catch (e) {
    toast.error("Could not record the statement", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <BaseCard>
    <div class="flex items-start justify-between gap-4">
      <div>
        <h3 class="text-sm font-semibold text-ink">Seven-day work statement</h3>
        <p class="mt-1 max-w-2xl text-sm text-ink-muted">
          Before a driver works for the first time, the carrier has to hold a signed account of the
          hours they worked in the seven days before they start, and when they were last off duty.
          Their available hours are worked out from it.
        </p>
      </div>
      <BaseButton v-if="canRecord" class="shrink-0" @click="open = true">Record one</BaseButton>
    </div>

    <p v-if="statementsQ.isLoading.value" class="mt-4 text-sm text-ink-muted">Loading…</p>
    <p v-else-if="(statementsQ.data.value ?? []).length === 0" class="mt-4 text-sm text-ink-muted">
      No statement on file. Record one from the paper the driver signed.
    </p>
    <ul v-else class="mt-4 space-y-2">
      <li
        v-for="(s, i) in statementsQ.data.value"
        :key="s.id"
        class="rounded-surface bg-surface-muted p-3"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <p class="text-sm font-medium text-ink">
            {{ sevenDayTotal(s.days) }} hours in the seven days before {{ s.statement_date }}
          </p>
          <!-- Newest first, so the first row is the one in force. A correction is a new statement. -->
          <span v-if="i === 0" class="text-xs text-ink-muted">Current</span>
        </div>
        <p class="mt-1 text-xs text-ink-muted">
          Signed by {{ s.signed_name }} on {{ s.signed_on }} · last relieved
          {{ s.last_relieved_at.slice(0, 16).replace("T", " ") }}
        </p>
      </li>
    </ul>

    <SlideOver :open="open" title="Record a seven-day statement" @close="open = false">
      <div class="space-y-5">
        <p class="text-sm text-ink-muted">
          Enter what the driver signed. Their name goes in as they wrote it — this records their
          statement, it does not make one for them.
        </p>

        <FormField v-slot="{ id }" label="Date of the statement" hint="The day the driver signed it.">
          <AppDateField :id="id" v-model="statementDate" />
        </FormField>

        <div v-if="windowDates.length === 7" class="space-y-2">
          <p class="text-xs font-medium text-ink-secondary">Hours worked on each of the seven days</p>
          <div v-for="(d, i) in windowDates" :key="d" class="flex items-center gap-3">
            <span class="w-28 shrink-0 text-xs text-ink-muted">{{ d }}</span>
            <BaseInput v-model="hours[i]" inputmode="decimal" placeholder="0" />
          </div>
          <p class="text-xs text-ink-muted">Total: {{ total }} hours</p>
        </div>

        <FormField v-slot="{ id }" label="Last relieved from duty" hint="Date and time.">
          <BaseInput :id="id" v-model="lastRelieved" type="datetime-local" />
        </FormField>

        <FormField v-slot="{ id }" label="Signed by" hint="The driver's name, as they signed it.">
          <BaseInput :id="id" v-model="signedName" />
        </FormField>
      </div>

      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton variant="secondary" @click="open = false">Cancel</BaseButton>
          <BaseButton
            variant="primary"
            :disabled="!ready || record.isPending.value"
            @click="submit"
          >
            {{ record.isPending.value ? "Recording…" : "Record" }}
          </BaseButton>
        </div>
      </template>
    </SlideOver>
  </BaseCard>
</template>
