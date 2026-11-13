<script setup lang="ts">
import { QueryState } from "@silvicom/ui";
import SettingsSection from "@/components/ui/SettingsSection.vue";
import AlertRoutesEditor from "./AlertRoutesEditor.vue";
import AlertTextHoursForm from "./AlertTextHoursForm.vue";
import HomeTimeThresholdsForm from "./HomeTimeThresholdsForm.vue";
import { useAlertRouting } from "./useAlertRouting";

/**
 * Settings › Notifications: the alerts the carrier routes itself (HOME-TIME-PLAN HT5, D-HT14) — today
 * home time's three, the first alerts sent through the routing catalogue. The list is the catalogue's,
 * as the API returns it, so an alert added there appears here without a change to this file.
 *
 * Text is a column, and the quiet hours a form, only where the server can send a text
 * (`texts.available`); each person confirms their own number under My alerts in the account menu.
 */
const routing = useAlertRouting();
</script>

<template>
  <SettingsSection
    title="Home time alerts"
    :description="`When each alert is sent, and who is told on the dashboard, by email${routing.data.value?.texts.available ? ' and by text' : ''}. Each person can still mute an alert for themselves from the bell.`"
  >
    <HomeTimeThresholdsForm />
    <QueryState
      :loading="routing.isLoading.value"
      :error="routing.isError.value ? routing.error.value : null"
      :retrying="routing.isFetching.value"
      loading-text="Loading who is told…"
      error-text="Could not load who is told."
      @retry="routing.refetch()"
    >
      <div v-if="routing.data.value" class="space-y-4">
        <AlertTextHoursForm v-if="routing.data.value.texts.available" :quiet="routing.data.value.texts.quiet" />
        <AlertRoutesEditor v-for="alert in routing.data.value.alerts" :key="alert.key" :alert="alert" :members="routing.data.value.members" :texts-available="routing.data.value.texts.available" />
      </div>
    </QueryState>
  </SettingsSection>
</template>
