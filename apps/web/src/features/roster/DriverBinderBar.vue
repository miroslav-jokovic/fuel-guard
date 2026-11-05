<script setup lang="ts">
import { ref } from "vue";
import { AppIcon, AppButton as BaseButton, AppCheckbox as BaseCheckbox, BulkActionBar } from "@silvicom/ui";
import { ArrowDownTrayIcon } from "@silvicom/ui/icons";
import { useRequestBinder } from "@/composables/useDqExports";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import { selectionFull } from "./binderSelection";

/**
 * The audit binder for the drivers ticked on the roster (DQ-INTO-DRIVERS-PLAN DD2, D-DQ19). It came
 * from the Driver Qualification list, which DD4 retires; what a binder contains is unchanged
 * (DQ-BINDER-PLAN).
 *
 * The page shows this bar only to a reader with `roster: manage`, which is exactly what
 * `POST /api/compliance/exports/binder` asks (`canManage = requireSection("roster")`), so nobody is
 * offered a button the API refuses. Restricted pages (§382.401 drug and alcohol, §391.53 PSP) stay out
 * unless a role that reads them all opts in, D-DQ15; the API checks the opt-in again and records it.
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
    <BaseCheckbox v-if="session.restrictedAccess" v-model="includeRestricted">
      Include restricted records
    </BaseCheckbox>
    <BaseButton variant="primary" size="sm" :disabled="requestBinder.isPending.value" @click="build">
      <AppIcon :icon="ArrowDownTrayIcon" class="size-4" aria-hidden="true" />
      {{ requestBinder.isPending.value ? "Building…" : "Build audit binder" }}
    </BaseButton>
  </BulkActionBar>
</template>
