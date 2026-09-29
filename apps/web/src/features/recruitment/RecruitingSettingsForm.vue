<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import {
  INVITE_TTL_DAYS_MAX,
  REMINDER_AFTER_HOURS_MAX,
  REMINDER_AFTER_HOURS_MIN,
  formatDisplayDateTime,
  recruitingSettingsSchema,
  type RecruitingSettings,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppFormField as FormField, AppInput as BaseInput, AppSwitch } from "@silvicom/ui";
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
 */
const session = useSessionStore();
const toast = useToastStore();
const canManage = computed(() => session.can("recruitment"));
const settingsQ = useRecruitingSettings();
const save = useSaveRecruitingSettings();

// Strings, because a number input can hold "" while it is being typed in.
const form = reactive({ days: "", enabled: true, hours: "" });
const load = (s: RecruitingSettings): void => {
  Object.assign(form, { days: String(s.invite_ttl_days), enabled: s.reminders_enabled, hours: String(s.reminder_after_hours) });
};
watch(() => settingsQ.data.value?.settings, (s) => s && load(s), { immediate: true });

const candidate = computed(() => ({
  invite_ttl_days: Number(form.days),
  reminders_enabled: form.enabled,
  reminder_after_hours: Number(form.hours),
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
  return c.invite_ttl_days !== v.invite_ttl_days || c.reminders_enabled !== v.reminders_enabled || c.reminder_after_hours !== v.reminder_after_hours;
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
    <p v-if="settingsQ.isLoading.value" class="text-xs text-ink-muted">Loading…</p>
    <p v-else-if="settingsQ.isError.value" class="text-xs text-danger-700">
      {{ settingsQ.error.value?.message ?? "Could not load the recruiting settings." }}
    </p>

    <template v-else-if="settingsQ.data.value">
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
  </div>
</template>
