<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { BROKER_MAIL_MAX_BACKUPS, type BrokerMailMailbox } from "@silvicom/shared";
import { AppButton, AppCheckbox } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { useSaveBackups } from "./useBrokerMail";

/**
 * One dispatcher's backups (BROKER-MAIL-READER-PLAN P3; Q-BM10: only an admin chooses them). The people a
 * short text goes to when that dispatcher's broker email is still unanswered a few minutes after their
 * own text. The dispatcher sees the list read-only on the Broker mail page. Every save is audited.
 */
const props = defineProps<{ mailbox: BrokerMailMailbox | null; members: readonly { userId: string; name: string }[] }>();
const emit = defineEmits<{ close: [] }>();
const save = useSaveBackups();
const toast = useToastStore();

const chosen = ref<Set<string>>(new Set());
watch(() => props.mailbox, (m) => (chosen.value = new Set((m?.backups ?? []).map((b) => b.userId))), { immediate: true });

const options = computed(() => props.members.filter((p) => p.userId !== props.mailbox?.userId));
const full = computed(() => chosen.value.size >= BROKER_MAIL_MAX_BACKUPS);

function toggle(userId: string, on: boolean) {
  const next = new Set(chosen.value);
  if (on) next.add(userId);
  else next.delete(userId);
  chosen.value = next;
}

async function onSave() {
  if (!props.mailbox?.userId) return;
  try {
    await save.mutateAsync({ userId: props.mailbox.userId, backupUserIds: [...chosen.value] });
    toast.success("Backups saved");
    emit("close");
  } catch (e) {
    toast.error("Could not save the backups", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver
    :open="mailbox !== null"
    :title="`Backups for ${mailbox?.name ?? mailbox?.email ?? 'this dispatcher'}`"
    description="Who gets a short text when this dispatcher's broker email is still unanswered a few minutes after their own text. At night it waits for working hours."
    @close="emit('close')"
  >
    <section aria-labelledby="bm-backups-heading">
      <h3 id="bm-backups-heading" class="text-sm font-semibold text-ink">Backups</h3>
      <p class="mt-1 text-sm text-ink-muted">Up to {{ BROKER_MAIL_MAX_BACKUPS }} people. Only people who can open Broker mail are texted.</p>
      <div class="mt-4 space-y-3">
        <AppCheckbox
          v-for="p in options"
          :key="p.userId"
          :model-value="chosen.has(p.userId)"
          :disabled="full && !chosen.has(p.userId)"
          @update:model-value="(v: boolean) => toggle(p.userId, v)"
        >
          {{ p.name }}
        </AppCheckbox>
      </div>
    </section>
    <template #footer>
      <div class="flex justify-end gap-3">
        <AppButton variant="secondary" @click="emit('close')">Cancel</AppButton>
        <AppButton variant="primary" :disabled="save.isPending.value" @click="onSave">{{ save.isPending.value ? "Saving…" : "Save backups" }}</AppButton>
      </div>
    </template>
  </SlideOver>
</template>
