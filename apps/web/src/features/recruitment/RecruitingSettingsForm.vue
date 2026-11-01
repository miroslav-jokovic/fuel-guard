<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import {
  HIRE_POLICY_SWITCHES,
  HIRE_REFUSES_WITHOUT,
  INVITE_TTL_DAYS_MAX,
  REMINDER_AFTER_HOURS_MAX,
  REMINDER_AFTER_HOURS_MIN,
  formatDisplayDateTime,
  hiringStep,
  recruitingSettingsSchema,
  type RecruitingSettings,
} from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSwitch,
  QueryState,
} from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { useRecruitingSettings, useSaveRecruitingSettings } from "@/features/recruitment/useRecruitingSettings";

/**
 * The link's lifetime and the reminder (APPLICATION-FLOW-V2-PLAN.md S2, Q-AW41 ruled (a) 2026-09-28).
 *
 * ── ONE CONTRACT, ON BOTH SIDES ───────────────────────────────────────────────────────────────
 * The form parses with `recruitingSettingsSchema`, the one the api validates the PUT with, so a delay
 * that would come after the link dies is refused here in the same sentence the server would use — and
 * 0379's CHECK refuses it a third time. The bounds printed in the hints are the contract's constants.
 *
 * ── THE DELAY IS SHOWN IN BOTH STATES (C-AL1, Q-AW50 ruled 2026-09-29) ─────────────────────────
 * The hours are when the sweep counts a driver as stopped — the driver's reminder AND the office's alert,
 * which fires with reminders off too. It was hidden while the switch was off, so the office was alerted
 * at a delay it could neither see nor change. The switch is about the DRIVER; the office's alerts follow
 * the carrier's notification switch (`organizations.notifications_enabled`, Settings → Notifications),
 * and the copy says so rather than let one switch answer two questions.
 *
 * Writes on `session.can("recruitment")`, what the api's PUT asks — the Representatives' rule on the same
 * page. What it changes: every link sent, re-sent or extended from now on, and the reminder sweep's next
 * run. A link already in a driver's inbox keeps the expiry it was given.
 *
 * ── BEFORE WE HIRE (§9 P12, 0536) ─────────────────────────────────────────────────────────────
 * The six federal checks are listed and locked — law, not a setting (`HIRE_REFUSES_WITHOUT`). Below
 * them, one switch per `HIRE_POLICY_SWITCHES` entry: the handbook only, because the orientation steps
 * have no record yet and a switch on them would refuse every hire (0536's header). Saved with the rest
 * of this form, so the PUT always carries every answer.
 */
const session = useSessionStore();
const toast = useToastStore();
const canManage = computed(() => session.can("recruitment"));
const settingsQ = useRecruitingSettings();
const save = useSaveRecruitingSettings();

// Strings, because a number input can hold "" while it is being typed in.
const form = reactive({ days: "", enabled: true, hours: "", handbook: false });
const load = (s: RecruitingSettings): void => {
  Object.assign(form, {
    days: String(s.invite_ttl_days),
    enabled: s.reminders_enabled,
    hours: String(s.reminder_after_hours),
    handbook: s.handbook_blocks_hire,
  });
};

const FEDERAL_CHECKS = HIRE_REFUSES_WITHOUT.map((key) => hiringStep(key).label);
/** The switch's words, from the step it adds — never a second name for the same step. */
const HANDBOOK_LABEL = hiringStep(HIRE_POLICY_SWITCHES.find((s) => s.setting === "handbook_blocks_hire")!.step).label;
watch(() => settingsQ.data.value?.settings, (s) => s && load(s), { immediate: true });

const candidate = computed(() => ({
  invite_ttl_days: Number(form.days),
  reminders_enabled: form.enabled,
  reminder_after_hours: Number(form.hours),
  handbook_blocks_hire: form.handbook,
}));
const parsed = computed(() => recruitingSettingsSchema.safeParse(candidate.value));
/** The contract's first complaint, keyed by the field it is about. */
const issue = computed(() => {
  if (parsed.value.success) return null;
  const first = parsed.value.error.issues[0]!;
  return { field: String(first.path[0] ?? ""), message: first.message };
});
const daysError = computed(() =>
  issue.value?.field === "invite_ttl_days" ? `Between 1 and ${INVITE_TTL_DAYS_MAX} days.` : undefined,
);
const hoursError = computed(() => {
  if (issue.value?.field !== "reminder_after_hours") return undefined;
  // The refine's sentence is written for a person; the bounds' messages are zod's, so say the range.
  return issue.value.message.startsWith("A driver must count as stopped")
    ? issue.value.message
    : `Between ${REMINDER_AFTER_HOURS_MIN} and ${REMINDER_AFTER_HOURS_MAX} hours.`;
});

const current = computed(() => settingsQ.data.value?.settings ?? null);
const changed = computed(() => {
  const c = current.value;
  if (!c) return false;
  const v = candidate.value;
  return c.invite_ttl_days !== v.invite_ttl_days || c.reminders_enabled !== v.reminders_enabled
    || c.reminder_after_hours !== v.reminder_after_hours || c.handbook_blocks_hire !== v.handbook_blocks_hire;
});

async function submit(): Promise<void> {
  if (!parsed.value.success) return;
  try {
    await save.mutateAsync(parsed.value.data);
    toast.success("Recruiting settings saved", "Links sent from now on use them.");
  } catch (e) {
    toast.error("Could not save the recruiting settings", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-5">
    <QueryState
      :loading="settingsQ.isLoading.value"
      :error="settingsQ.isError.value ? settingsQ.error.value : null"
      :error-text="'Could not load the recruiting settings.'"
      :retrying="settingsQ.isFetching.value"
      loading-text="Loading the recruiting settings…"
      compact
      @retry="settingsQ.refetch()"
    >
      <template v-if="settingsQ.data.value">
        <p class="text-xs text-ink-muted">
          {{ settingsQ.data.value.isDefault
            ? "These are the product's defaults. Nobody has changed them for this carrier."
            : `Last changed ${formatDisplayDateTime(settingsQ.data.value.updatedAt)}.` }}
        </p>

        <FormField
          v-slot="{ id }"
          label="How long an application link stays open"
          :hint="`In days, 1 to ${INVITE_TTL_DAYS_MAX}. Every send, reminder and signing step opens it for this long again.`"
          :error="daysError"
        >
          <BaseInput :id="id" v-model="form.days" type="number" min="1" :max="INVITE_TTL_DAYS_MAX" inputmode="numeric" :disabled="!canManage" class="max-w-32" />
        </FormField>

        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-sm font-medium text-ink">Remind a driver who stops</p>
            <p class="mt-1 text-xs text-ink-secondary">
              One email, and a text if they agreed to texts, once per part of the application. Off, the office is
              still told that they stopped. The office's alerts are stopped only by turning off the carrier's
              notifications in Settings → Notifications, which stops its other alerts too.
            </p>
          </div>
          <AppSwitch v-model="form.enabled" :disabled="!canManage" label="Remind a driver who stops" />
        </div>

        <FormField
          v-slot="{ id }"
          label="Count a driver as stopped after"
          :hint="`In hours without progress, ${REMINDER_AFTER_HOURS_MIN} to ${REMINDER_AFTER_HOURS_MAX}. The office is alerted then${form.enabled ? ', and the driver is reminded' : ''}; it can be up to six hours later than this.`"
          :error="hoursError"
        >
          <BaseInput :id="id" v-model="form.hours" type="number" :min="REMINDER_AFTER_HOURS_MIN" :max="REMINDER_AFTER_HOURS_MAX" inputmode="numeric" :disabled="!canManage" class="max-w-32" />
        </FormField>

        <div class="space-y-3 border-t border-edge pt-5" data-testid="before-we-hire">
          <h3 class="text-sm font-semibold text-ink">Before we hire</h3>
          <p class="text-xs text-ink-secondary">
            Hire stays locked until these are done. Federal rules require the first six, so they can't be turned off.
          </p>
          <ul class="space-y-1 text-sm">
            <li v-for="label in FEDERAL_CHECKS" :key="label" class="flex items-center justify-between gap-3">
              <span class="text-ink">{{ label }}</span>
              <span class="text-xs text-ink-muted">Federal requirement</span>
            </li>
          </ul>
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm font-medium text-ink">{{ HANDBOOK_LABEL }}</p>
              <p class="mt-1 text-xs text-ink-secondary">
                On, hire also waits for the driver handbook to be signed. Off, it can be signed after the hire.
              </p>
            </div>
            <AppSwitch v-model="form.handbook" :disabled="!canManage" :label="`Hiring waits for: ${HANDBOOK_LABEL}`" />
          </div>
        </div>

        <BaseButton
          v-if="canManage"
          variant="primary"
          size="sm"
          :disabled="!changed || !parsed.success || save.isPending.value"
          @click="submit"
        >
          {{ save.isPending.value ? "Saving…" : "Save" }}
        </BaseButton>
      </template>
    </QueryState>
  </div>
</template>
