<script setup lang="ts">
import { ref } from "vue";
import { AppIcon, AppButton as BaseButton, AppCheckbox as BaseCheckbox, BulkActionBar } from "@silvicom/ui";
import { ArrowDownTrayIcon, PrinterIcon } from "@silvicom/ui/icons";
import { useRequestBinder } from "@/composables/useDqExports";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { selectionFull } from "./binderSelection";
import { useCoverSheets } from "./coverSheets";

/**
 * The audit binder for the drivers ticked on the roster (DQ-INTO-DRIVERS-PLAN DD2, D-DQ19). It came
 * from the Driver Qualification list, which DD4 retires; what a binder contains is unchanged
 * (DQ-BINDER-PLAN).
 *
 * The page shows this bar only to a reader with `roster: manage`, which is exactly what
 * `POST /api/compliance/exports/binder` asks (`canManage = requireSection("roster")`), so nobody is
 * offered a button the API refuses. Restricted pages (§382.401 drug and alcohol, §391.53 PSP) stay out
 * unless a role that reads them all opts in, D-DQ15; the API checks the opt-in again and records it.
 *
 * "Print scan cover sheets" (DRIVER-PAPER-INTAKE-PLAN PI1) sits on the same bar for the same reader:
 * `POST /api/compliance/cover-sheets` asks `roster: manage` too, and a sheet is how the office starts
 * scanning the same drivers' paper folders. Same selection, same cap.
 */
const props = defineProps<{ selected: Set<string> }>();
const emit = defineEmits<{
  clear: [];
  /** The job is queued: the page opens its Audit binders panel where the reader may see it. */
  built: [];
}>();

const session = useSessionStore();
const toast = useToastStore();
const requestBinder = useRequestBinder();
const includeRestricted = ref(false);
const coverSheets = useCoverSheets();

async function printCoverSheets(): Promise<void> {
  const driverIds = [...props.selected];
  if (driverIds.length === 0) return;
  try {
    await coverSheets.print(driverIds);
    toast.success(
      "Cover sheets ready",
      `Print ${driverIds.length === 1 ? "it" : `all ${driverIds.length}`} and put each one on top of that driver's folder before scanning.`,
    );
  } catch (e) {
    toast.error("Could not make the cover sheets", e instanceof Error ? e.message : undefined);
  }
}

async function build(): Promise<void> {
  const driverIds = [...props.selected];
  if (driverIds.length === 0) return;
  try {
    await requestBinder.mutateAsync({
      driverIds,
      asAt: null,
      includeRestricted: session.restrictedAccess && includeRestricted.value,
    });
    // A job, so say what happens next and roughly when, not "Done". Where to find it depends on
    // whether this reader may see the ledger (`safety: view`), which a roster manager usually can.
    const files = `${driverIds.length} qualification ${driverIds.length === 1 ? "file" : "files"}.`;
    toast.success(
      "Building the binder",
      session.canView("safety")
        ? `${files} It appears under Audit binders in a minute or two.`
        : `${files} It is ready in a minute or two.`,
    );
    includeRestricted.value = false;
    emit("clear");
    emit("built");
  } catch (e) {
    toast.error("Could not start the binder", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <BulkActionBar :count="props.selected.size" @clear="emit('clear')">
    <template v-if="selectionFull(props.selected)" #note>
      That is the most drivers one binder holds. Send the rest as a second binder.
    </template>
    <!-- First, and apart from the binder's controls: the restricted opt-in beside the binder is the
         binder's alone, and a sheet carries no record at all. -->
    <BaseButton variant="secondary" size="sm" :disabled="coverSheets.printing.value" @click="printCoverSheets">
      <AppIcon :icon="PrinterIcon" class="size-4" aria-hidden="true" />
      {{ coverSheets.printing.value ? "Preparing…" : "Print scan cover sheets" }}
    </BaseButton>
    <BaseCheckbox v-if="session.restrictedAccess" v-model="includeRestricted">
      Include restricted records
    </BaseCheckbox>
    <BaseButton variant="primary" size="sm" :disabled="requestBinder.isPending.value" @click="build">
      <AppIcon :icon="ArrowDownTrayIcon" class="size-4" aria-hidden="true" />
      {{ requestBinder.isPending.value ? "Building…" : "Build audit binder" }}
    </BaseButton>
  </BulkActionBar>
</template>
