<script setup lang="ts">
import { computed, ref } from "vue";
import { HANDBOOK_PLACEMENTS, formatDisplayDate, formatDisplayDateTime } from "@silvicom/shared";
import { AppButton as BaseButton, AppCombobox as ComboSelect, AppFormField as FormField } from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import SignatoryRegister from "@/features/recruitment/SignatoryRegister.vue";
import {
  useCountersignHandbook,
  useExtendHandbookLink,
  useHandbookStatus,
  useRepresentatives,
} from "@/features/recruitment/useHandbook";

/**
 * The driver handbook, worked from the step's drawer (HANDBOOK-SIGNING-PLAN.md HB4; D-HB1..D-HB5).
 *
 * ── THE MOVES, IN THE ORDER THE DATABASE HOLDS ────────────────────────────────────────────────
 * The envelope the office sent for signing opens the handbook too (D-AW16, C3s4b): the driver files the
 * application and goes straight on to the handbook's five places on the same link, with the signature
 * they adopted for the application; then the office COUNTERSIGNS for the carrier with a Representative,
 * which files the signed handbook. There is no separate opening press any more — "Open handbook signing"
 * was retired with C3s4b — so the panel shows where the driver is, keeps their link alive, and offers the
 * countersignature once they are done.
 *
 * ── THE REPRESENTATIVES (D-HB3) ───────────────────────────────────────────────────────────────
 * Added with their signature and removed, as the maintenance inspectors are. One who has countersigned
 * a handbook cannot be removed — the server says so, and that sentence is what the toast shows. The
 * list and its form are `SignatoryRegister`, the same one Settings → Recruiting shows (Q-AW42), so a
 * Representative can be added before any driver reaches this step and still be added here.
 */
const props = defineProps<{ driverId: string; done: boolean }>();

const toast = useToastStore();
const driverId = computed(() => props.driverId);
const statusQ = useHandbookStatus(driverId);
const repsQ = useRepresentatives();
const extend = useExtendHandbookLink(driverId);
const countersign = useCountersignHandbook(driverId);

const status = computed(() => statusQ.data.value ?? null);
const reps = computed(() => repsQ.data.value ?? []);
const repOptions = computed(() => reps.value.map((r) => ({ value: r.id, label: `${r.full_name} — ${r.title}` })));
const driverPlaces = HANDBOOK_PLACEMENTS.filter((p) => p.party === "driver");
const signedCount = computed(() => status.value?.driverSigned.length ?? 0);
const linkExpired = computed(() => Boolean(status.value && Date.parse(status.value.linkExpiresAt) <= Date.now()));

const representativeId = ref("");
function forgetRepresentative(id: string): void {
  if (representativeId.value === id) representativeId.value = "";
}

// ── the two acts ───────────────────────────────────────────────────────────────────────────────
/**
 * APPLICATION-FLOW-V2-PLAN.md A-2: every press keeps the driver's link alive for another of the
 * carrier's link lifetimes (Q-AW41) — the toast says the date the server set, never a number restated
 * here. Nothing else extends a filed invitation's link, and 0374 refuses every handbook mark on a lapsed
 * one — the countersignature included (`extendHandbookLink` has why it outlived the opening).
 */
async function extendLink(): Promise<void> {
  try {
    const { expiresAt } = await extend.mutateAsync(undefined);
    toast.success("Link extended", `The driver's link is open until ${formatDisplayDateTime(expiresAt)}.`);
  } catch (e) {
    toast.error("Could not extend the driver's link", e instanceof Error ? e.message : undefined);
  }
}

async function countersignAndFile(): Promise<void> {
  try {
    await countersign.mutateAsync({ representative_id: representativeId.value });
    toast.success("Handbook filed", "The signed handbook is in the driver's file.");
  } catch (e) {
    toast.error("Could not file the handbook", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-6">
    <p v-if="statusQ.isLoading.value" class="text-xs text-ink-muted">Loading…</p>

    <template v-else-if="status">
      <p v-if="status.filedAt" class="text-sm text-ink">
        Signed and filed on {{ formatDisplayDate(status.filedAt, "") }}. The signed handbook is in the driver's file.
      </p>

      <p v-else-if="!status.canOpen" class="text-sm text-ink-secondary">
        The handbook is signed after the application. It opens here once the application is signed and filed.
      </p>

      <div v-else class="space-y-3">
        <p class="text-sm font-medium text-ink">
          {{ status.driverComplete ? "The driver has signed every place" : `The driver has signed ${signedCount} of ${driverPlaces.length}` }}
        </p>
        <ul class="divide-y divide-edge border-y border-edge">
          <li v-for="place in driverPlaces" :key="place.id" class="flex items-start justify-between gap-3 py-2 text-xs">
            <span class="text-ink">{{ place.what }}</span>
            <span :class="status.driverSigned.includes(place.id) ? 'text-ink' : 'text-ink-muted'">
              {{ status.driverSigned.includes(place.id) ? "Signed" : "Not yet" }}
            </span>
          </li>
        </ul>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-xs" :class="linkExpired ? 'text-danger-700' : 'text-ink-secondary'">
            {{ linkExpired
              ? `The driver's link expired on ${formatDisplayDateTime(status.linkExpiresAt)}. Extend it before they sign or you countersign.`
              : `The driver's link is open until ${formatDisplayDateTime(status.linkExpiresAt)}.` }}
          </p>
          <BaseButton variant="secondary" size="sm" :disabled="extend.isPending.value" @click="extendLink">
            {{ extend.isPending.value ? "Extending…" : "Extend the driver's link" }}
          </BaseButton>
        </div>
      </div>
    </template>

    <!-- The countersignature: only once the driver is done, and never after filing. -->
    <div v-if="status?.driverComplete && !status.filedAt" class="space-y-4">
      <p class="text-sm font-medium text-ink">Countersign for the carrier</p>
      <FormField v-if="reps.length > 0" v-slot="{ id }" label="Representative" hint="Their signature prints on the Agreed line.">
        <ComboSelect :id="id" v-model="representativeId" :options="repOptions" />
      </FormField>
      <BaseButton
        v-if="reps.length > 0"
        variant="primary"
        size="sm"
        :disabled="!representativeId || countersign.isPending.value"
        @click="countersignAndFile"
      >
        {{ countersign.isPending.value ? "Filing…" : "Countersign and file" }}
      </BaseButton>
    </div>

    <!-- The Representatives, managed here like the maintenance inspectors (D-HB3). -->
    <div class="space-y-3">
      <p class="text-sm font-medium text-ink">Representatives</p>
      <SignatoryRegister
        kind="representative"
        @added="representativeId = $event.id"
        @removed="forgetRepresentative"
      />
    </div>
  </div>
</template>
