<script setup lang="ts">
import { computed } from "vue";
import { QueryState } from "@silvicom/ui";
import SettingsSection from "@/components/ui/SettingsSection.vue";
import AlertRoutesEditor from "./AlertRoutesEditor.vue";
import AlertTextHoursForm from "./AlertTextHoursForm.vue";
import HomeTimeThresholdsForm from "./HomeTimeThresholdsForm.vue";
import LumperReminderSwitch from "./LumperReminderSwitch.vue";
import { useAlertRouting } from "./useAlertRouting";

/**
 * Settings › Notifications: the alerts the carrier routes itself (HOME-TIME-PLAN HT5, D-HT14) — home
 * time's three, and since LRC4 the lumper fee reminders (LUMPER-REVISED-RC-PLAN D-LRC7). The list is the
 * catalogue's, as the API returns it, so an alert added there appears here without a change to this file;
 * it is drawn under its feature's heading by its key's prefix, and anything else under "Other alerts".
 *
 * Text is a column, and the quiet hours a form, only where the server can send a text
 * (`texts.available`); each person confirms their own number under My alerts in the account menu. The
 * quiet hours hold every alert text, so they are their own section rather than inside one feature's.
 */
const routing = useAlertRouting();
const alerts = computed(() => routing.data.value?.alerts ?? []);
const homeTime = computed(() => alerts.value.filter((a) => a.key.startsWith("home_time_")));
const lumper = computed(() => alerts.value.filter((a) => a.key.startsWith("lumper_")));
const other = computed(() => alerts.value.filter((a) => !a.key.startsWith("home_time_") && !a.key.startsWith("lumper_")));
/** Each alert's editor is offered only the people who can receive THAT alert (`memberIds`). */
const membersFor = (alert: { memberIds: string[] }) => (routing.data.value?.members ?? []).filter((m) => alert.memberIds.includes(m.userId));
const channels = computed(() => `on the dashboard, by email${routing.data.value?.texts.available ? " and by text" : ""}`);
</script>

<template>
  <QueryState
    :loading="routing.isLoading.value"
    :error="routing.isError.value ? routing.error.value : null"
    :retrying="routing.isFetching.value"
    loading-text="Loading who is told…"
    error-text="Could not load who is told."
    @retry="routing.refetch()"
  >
    <div v-if="routing.data.value" class="space-y-8">
      <SettingsSection v-if="routing.data.value.texts.available" title="Alert texts" description="The hours an alert text waits for. It is sent when the window ends.">
        <AlertTextHoursForm :quiet="routing.data.value.texts.quiet" />
      </SettingsSection>
      <SettingsSection title="Home time alerts" :description="`When each alert is sent, and who is told ${channels}. Each person can still mute an alert for themselves from the bell.`">
        <HomeTimeThresholdsForm />
        <div class="space-y-4">
          <AlertRoutesEditor v-for="alert in homeTime" :key="alert.key" :alert="alert" :members="membersFor(alert)" :texts-available="routing.data.value.texts.available" />
        </div>
      </SettingsSection>
      <SettingsSection v-if="lumper.length" title="Lumper fee reminders" :description="`Loads where we paid a lumper and the revised rate confirmation is missing or the lumper was not billed in full, and who is told ${channels}.`">
        <LumperReminderSwitch />
        <div class="space-y-4">
          <AlertRoutesEditor v-for="alert in lumper" :key="alert.key" :alert="alert" :members="membersFor(alert)" :texts-available="routing.data.value.texts.available" />
        </div>
      </SettingsSection>
      <SettingsSection v-if="other.length" title="Other alerts" :description="`Who is told ${channels}.`">
        <div class="space-y-4">
          <AlertRoutesEditor v-for="alert in other" :key="alert.key" :alert="alert" :members="membersFor(alert)" :texts-available="routing.data.value.texts.available" />
        </div>
      </SettingsSection>
    </div>
  </QueryState>
</template>
