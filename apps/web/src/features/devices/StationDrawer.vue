<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AppButton as BaseButton, AppFormField as FormField, AppInput as BaseInput } from "@silvicom/ui";
import type { PairingCodeDto } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import { useToastStore } from "@/stores/toast";
import { useCreateStation } from "@/composables/usePrinting";
import { formatDateTime } from "@/lib/format";

/**
 * Add a print station, or show a fresh pairing code for one (PRINTERS-AND-SCANNERS-PLAN.md PS4).
 *
 * The code is shown ONCE — the API keeps only its hash — so the drawer stays on it until closed, with
 * the exact command to type on the PC beside it. Closing is the only way to lose it, and asking for a
 * new one is one click on the station's row.
 */

const props = defineProps<{ open: boolean; issued: PairingCodeDto | null }>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const create = useCreateStation();
const name = ref("Office PC");
const code = ref<PairingCodeDto | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = "Office PC";
    code.value = props.issued;
  },
);

const apiOrigin = computed(() => {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  return configured ? new URL(configured, window.location.href).origin : window.location.origin;
});
const command = computed(() =>
  code.value
    ? `powershell -ExecutionPolicy Bypass -File .\\install-windows.ps1 -Code ${code.value.pairingCode} -Api ${apiOrigin.value}`
    : "",
);

async function save() {
  if (!name.value.trim() || create.isPending.value) return;
  try {
    code.value = await create.mutateAsync(name.value.trim());
  } catch (e) {
    toast.error("Could not add the print station", e instanceof Error ? e.message : undefined);
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  } catch {
    toast.error("Could not copy", "Select the text and copy it by hand.");
  }
}
</script>

<template>
  <SlideOver :open="open" size="lg" :title="code ? `Pair ${code.station.name}` : 'Add print station'" @close="emit('close')">
    <form v-if="!code" id="station-form" class="space-y-4" @submit.prevent="save">
      <p class="text-sm text-ink-muted">
        A print station is the always-on computer the label printer is plugged into. Every phone, tablet and
        computer prints through it, without a print dialog.
      </p>
      <FormField v-slot="{ id }" label="Name" hint="What the office calls the computer.">
        <BaseInput :id="id" v-model="name" maxlength="80" />
      </FormField>
    </form>

    <div v-else class="space-y-5">
      <div>
        <p class="text-sm text-ink-muted">Pairing code — valid until {{ formatDateTime(code.expiresAt) }}, used once:</p>
        <p class="mt-2 font-mono text-3xl font-bold tracking-widest text-ink" data-testid="pairing-code">{{ code.pairingCode }}</p>
      </div>
      <ol class="list-decimal space-y-2 pl-5 text-sm text-ink">
        <li>On that computer, plug the label printer in by USB and install its driver.</li>
        <li>Copy the <span class="font-mono">tools/print-station</span> folder to it.</li>
        <li>Open PowerShell <span class="font-semibold">as administrator</span> in that folder and run:</li>
      </ol>
      <div class="rounded-control bg-surface-subtle p-3">
        <p class="break-all font-mono text-xs text-ink">{{ command }}</p>
      </div>
      <BaseButton variant="secondary" @click="copy(command)">Copy command</BaseButton>
      <p class="text-sm text-ink-muted">
        This page shows the station online within a minute of the command finishing. On a Mac or Linux machine, use
        <span class="font-mono">node station.mjs pair {{ code.pairingCode }} --api {{ apiOrigin }}</span> instead.
      </p>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" @click="emit('close')">{{ code ? "Done" : "Cancel" }}</BaseButton>
        <BaseButton
          v-if="!code"
          form="station-form"
          type="submit"
          variant="primary"
          :disabled="create.isPending.value || !name.trim()"
        >
          {{ create.isPending.value ? "Adding…" : "Add and show code" }}
        </BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
