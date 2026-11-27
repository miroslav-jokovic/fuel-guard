<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  BROKER_MAIL_ANSWER_MAX,
  BROKER_MAIL_ANSWER_MIN,
  BROKER_MAIL_BACKUP_MAX,
  BROKER_MAIL_BACKUP_MIN,
  BROKER_MAIL_REASON_LABELS,
  brokerMailSettingsSchema,
  formatDisplayDateTime,
  type BrokerMailMailbox,
} from "@silvicom/shared";
import { AppBadge, AppButton, AppCallout, AppCard, AppFormField, AppInput, AppSwitch, DataTable, FactList, QueryState, type DataTableColumn, type Fact } from "@silvicom/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import type { BadgeTone } from "@/lib/badges";
import { useToastStore } from "@/stores/toast";
import { useBrokerMailAdminQuery, useSaveBrokerMailSettings, useSetLeftOut } from "@/features/brokerMail/useBrokerMail";
import BrokerMailBackupsDrawer from "@/features/brokerMail/BrokerMailBackupsDrawer.vue";
import BrokerMailWeekReport from "@/features/brokerMail/BrokerMailWeekReport.vue";

/**
 * Settings › Broker mail (BROKER-MAIL-READER-PLAN P2; Q-BM9: the admin's alone).
 *
 *  · Mail reading — the gateway's state, SHOWN and not switched: turning it on is an act on Microsoft's
 *    side as well as ours, so it stays the owner's script (`infra/mail-gateway/db-login.sh`).
 *  · Answer within — when an unanswered broker email turns red on the Broker mail page.
 *  · Mailboxes (D-BMR14) — every McLeod dispatcher, whether their Outlook is read, and if not why, in the
 *    database's own words (`mailgw_mailbox_roster`, 0649: the same rule the gateway reads by, so this
 *    list cannot disagree with it). "Leave out" is Q-BMR11's choice, audited.
 *  · Measure week (§8) — the report the go / change / stop ruling is made on, once the reader runs.
 */
const { data, isLoading, isError, error, isFetching, refetch } = useBrokerMailAdminQuery();
const save = useSaveBrokerMailSettings();
const leftOut = useSetLeftOut();
const toast = useToastStore();

const minutes = ref("");
const backupMinutes = ref("");
const textsOn = ref(false);
watch(data, (d) => {
  if (!d) return;
  minutes.value = String(d.settings.answerWithinMinutes);
  backupMinutes.value = String(d.settings.backupAfterMinutes);
  textsOn.value = d.settings.textsOn;
}, { immediate: true });
const minutesErr = ref<string | undefined>();
const backupErr = ref<string | undefined>();

async function onSave() {
  const parsed = brokerMailSettingsSchema.safeParse({ answerWithinMinutes: Number(minutes.value), backupAfterMinutes: Number(backupMinutes.value), textsOn: textsOn.value });
  minutesErr.value = undefined;
  backupErr.value = undefined;
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      if (i.path[0] === "answerWithinMinutes") minutesErr.value = `A whole number of minutes from ${BROKER_MAIL_ANSWER_MIN} to ${BROKER_MAIL_ANSWER_MAX}.`;
      if (i.path[0] === "backupAfterMinutes") backupErr.value = `A whole number of minutes from ${BROKER_MAIL_BACKUP_MIN} to ${BROKER_MAIL_BACKUP_MAX}.`;
    }
    return;
  }
  try {
    await save.mutateAsync(parsed.data);
    toast.success("Broker mail settings saved");
  } catch (e) {
    toast.error("Could not save", e instanceof Error ? e.message : undefined);
  }
}

async function toggle(m: BrokerMailMailbox) {
  if (!m.userId) return;
  const out = m.reason !== "left_out";
  try {
    await leftOut.mutateAsync({ userId: m.userId, leftOut: out });
    toast.success(out ? `${m.name ?? m.email} is left out of mail reading` : `${m.name ?? m.email}'s Outlook is read again`);
  } catch (e) {
    toast.error("Could not change it", e instanceof Error ? e.message : undefined);
  }
}

const GATEWAY_WORDS: Record<string, { tone: BadgeTone; text: string }> = {
  ok: { tone: "success", text: "Reading" },
  off: { tone: "neutral", text: "Switched off" },
  stale: { tone: "danger", text: "Stopped reading" },
  stopped: { tone: "danger", text: "Shut itself off" },
  unknown: { tone: "warning", text: "Could not check" },
};
const gateway = computed(() => data.value?.gateway ?? null);
const editing = ref<BrokerMailMailbox | null>(null);

/** Q-BM11's limit that cannot be ruled away: a STOP is honoured, so the admin must see who stopped. */
const stopped = computed(() => (data.value?.mailboxes ?? []).filter((m) => m.reason === null && m.textState === "stopped"));
const TEXT_WORDS: Record<string, { tone: BadgeTone; text: string }> = {
  ready: { tone: "success", text: "Ready" },
  stopped: { tone: "danger", text: "Stopped (STOP)" },
  unconfirmed: { tone: "warning", text: "Number not confirmed" },
  none: { tone: "neutral", text: "No number" },
};
const readingFacts = computed<Fact[]>(() => {
  const g = gateway.value;
  if (!g) return [];
  return [
    { label: "Company addresses", value: g.mailDomains.length ? g.mailDomains.join(", ") : "None set — no Outlook is read" },
    { label: "Email bodies", value: g.bodyReading ? "Read for a load number, never kept" : "Not opened" },
    { label: "Last read", value: formatDisplayDateTime(g.lastCycleAt) },
  ];
});
const gatewayWord = computed(() => GATEWAY_WORDS[gateway.value?.state ?? "unknown"] ?? GATEWAY_WORDS.unknown!);

/** One mailbox's status, in the words an admin acts on. */
function status(m: BrokerMailMailbox): { tone: BadgeTone; text: string; hint: string | null } {
  if (m.reason === "left_out") return { tone: "neutral", text: BROKER_MAIL_REASON_LABELS.left_out, hint: null };
  if (m.reason === "not_linked") return { tone: "caution", text: "Not linked", hint: "Link this McLeod login to a person on Settings › McLeod fleets." };
  if (m.reason) return { tone: "caution", text: BROKER_MAIL_REASON_LABELS[m.reason], hint: null };
  if (m.state === "connected") return { tone: "success", text: "Read", hint: m.lastReadAt ? `last read ${formatDisplayDateTime(m.lastReadAt)}` : null };
  if (m.state === "not_connected") return { tone: "caution", text: "Not connected", hint: "Microsoft refused this mailbox: ask IT to add it to the broker mail group." };
  if (m.state === "over_quota") return { tone: "warning", text: "Mailbox full", hint: "Outlook refuses new reads until the mailbox has room." };
  return { tone: "neutral", text: "Not read yet", hint: "Read on the first run after mail reading is switched on." };
}

const columns: DataTableColumn[] = [
  { key: "name", label: "Dispatcher", card: "title" },
  { key: "email", label: "Sign-in email", card: "meta" },
  { key: "mcleodLogins", label: "McLeod login", card: "meta" },
  { key: "status", label: "Outlook", card: "status" },
  { key: "texts", label: "Texts", card: "meta" },
  { key: "backups", label: "Backups", card: "meta" },
  { key: "act", label: "", align: "right" },
];
const rowOf = (r: unknown) => r as BrokerMailMailbox;
</script>

<template>
  <div class="space-y-6">
    <PageHeader description="Whose Outlook the broker mail reader reads, why a dispatcher's is not, and when an unanswered broker email turns red." />

    <QueryState
      :loading="isLoading"
      :error="isError ? error : null"
      :retrying="isFetching"
      loading-text="Loading the broker mail settings…"
      error-text="Could not load the broker mail settings."
      @retry="refetch()"
    >
      <template v-if="data && gateway">
        <AppCard as="section" aria-labelledby="bm-reading">
          <div class="flex items-center justify-between gap-3">
            <h3 id="bm-reading" class="text-sm font-semibold text-ink">Mail reading</h3>
            <AppBadge :tone="gatewayWord.tone" data-test="gateway-state">{{ gatewayWord.text }}</AppBadge>
          </div>
          <p class="mt-1 text-sm text-ink-muted">
            Only the envelope of each email is kept: sender, time, subject, and whether it was answered. Switching reading on or off is done with IT, not here.
          </p>
          <FactList class="mt-4" :facts="readingFacts" :columns="3" />
          <AppCallout v-if="gateway.state === 'stopped'" tone="danger" class="mt-4" data-test="canary">
            Mail reading shut itself off: a mailbox it must never open could be opened, so Microsoft's limits are wrong. Ask IT to check the broker mail group before it is switched on again.
          </AppCallout>
          <AppCallout v-else-if="!gateway.configured" tone="info" class="mt-4">Mail reading is not set up for this company yet.</AppCallout>
        </AppCard>

        <AppCard as="section" aria-labelledby="bm-answer">
          <h3 id="bm-answer" class="text-sm font-semibold text-ink">Texts</h3>
          <p class="mt-1 text-sm text-ink-muted">
            A broker email unanswered this long turns red on the Broker mail page and, with texts on, texts the dispatcher whose Outlook it is — day and
            night. Their backups get a short text a few minutes later if it is still unanswered; at night that waits for working hours.
          </p>
          <form class="mt-4 space-y-4" @submit.prevent="onSave">
            <AppSwitch v-model="textsOn" label="Send broker mail texts" data-test="texts-on" />
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AppFormField v-slot="{ id }" label="Text the dispatcher after (minutes)" :error="minutesErr">
                <AppInput :id="id" v-model="minutes" inputmode="numeric" class="w-28" :invalid="Boolean(minutesErr)" />
              </AppFormField>
              <AppFormField v-slot="{ id }" label="Then the backups, minutes later" :error="backupErr">
                <AppInput :id="id" v-model="backupMinutes" inputmode="numeric" class="w-28" :invalid="Boolean(backupErr)" />
              </AppFormField>
            </div>
            <p class="text-xs text-ink-tertiary">
              Switching texts on never texts about emails that were already waiting. Only people who can open Broker mail are texted, so turn the page on
              for the dispatcher role on Settings › Permissions first.
            </p>
            <AppButton variant="primary" type="submit" :disabled="save.isPending.value">{{ save.isPending.value ? "Saving…" : "Save" }}</AppButton>
          </form>
          <AppCallout v-if="stopped.length" tone="danger" class="mt-4" data-test="stopped">
            {{ stopped.map((m) => m.name ?? m.email).join(", ") }} replied STOP, so {{ stopped.length === 1 ? "gets" : "get" }} no broker mail texts — not even at night.
            Texts start again only when {{ stopped.length === 1 ? "that person confirms their number" : "each confirms their number" }} again in My alerts.
          </AppCallout>
        </AppCard>

        <section aria-labelledby="bm-mailboxes" class="space-y-3">
          <div>
            <h2 id="bm-mailboxes" class="text-lg font-semibold text-ink">Mailboxes</h2>
            <p class="text-sm text-ink-muted">Every McLeod dispatcher. An Outlook is read when its McLeod login is linked to a member whose sign-in email is a company address.</p>
          </div>
          <AppCallout v-if="data.stillConnected.length" tone="caution" data-test="still-connected">
            No longer read, but IT's broker mail group still includes {{ data.stillConnected.map((s) => s.mailbox).join(", ") }}. Ask IT to remove {{ data.stillConnected.length === 1 ? "it" : "them" }}.
          </AppCallout>
          <!-- ui-adoption: unpaged — one row per McLeod dispatcher, 23 in production on 2026-11-24. -->
          <DataTable :columns="columns" :rows="data.mailboxes" :row-key="(r) => rowOf(r).userId ?? `login:${rowOf(r).mcleodLogins[0]}`" empty-text="No McLeod dispatcher is known yet.">
            <template #cell-name="{ row }">
              <span class="font-medium text-ink">{{ rowOf(row).name ?? "—" }}</span>
            </template>
            <template #cell-email="{ value }"><span class="text-ink-secondary">{{ value ?? "—" }}</span></template>
            <template #cell-mcleodLogins="{ value }"><span class="font-mono text-xs text-ink-secondary">{{ (value as string[]).join(", ") }}</span></template>
            <template #cell-status="{ row }">
              <AppBadge :tone="status(rowOf(row)).tone">{{ status(rowOf(row)).text }}</AppBadge>
              <span v-if="status(rowOf(row)).hint" class="block text-xs text-ink-tertiary">{{ status(rowOf(row)).hint }}</span>
            </template>
            <template #cell-texts="{ row }">
              <AppBadge v-if="rowOf(row).textState" :tone="TEXT_WORDS[rowOf(row).textState!]!.tone">{{ TEXT_WORDS[rowOf(row).textState!]!.text }}</AppBadge>
            </template>
            <template #cell-backups="{ row }">
              <span v-if="rowOf(row).backups.length" class="text-ink-secondary">{{ rowOf(row).backups.map((b) => b.name).join(", ") }}</span>
              <AppButton v-if="rowOf(row).userId && rowOf(row).reason === null" variant="link" class="block" @click="editing = rowOf(row)">
                {{ rowOf(row).backups.length ? "Change" : "Choose backups" }}
              </AppButton>
            </template>
            <template #cell-act="{ row }">
              <AppButton
                v-if="rowOf(row).userId && (rowOf(row).reason === null || rowOf(row).reason === 'left_out')"
                size="sm"
                variant="secondary"
                :disabled="!gateway.configured || leftOut.isPending.value"
                @click="toggle(rowOf(row))"
              >
                {{ rowOf(row).reason === "left_out" ? "Read again" : "Leave out" }}
              </AppButton>
              <AppButton v-else-if="rowOf(row).reason === 'not_linked'" variant="link" to="/settings/mcleod-fleets">Link</AppButton>
            </template>
          </DataTable>
        </section>

        <BrokerMailWeekReport v-if="gateway.configured" />
      </template>
    </QueryState>
    <BrokerMailBackupsDrawer :mailbox="editing" :members="data?.members ?? []" @close="editing = null" />
  </div>
</template>
