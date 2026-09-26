<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { HANDBOOK_PLACEMENTS, INVITE_TTL_DAYS_DEFAULT, formatDisplayDate, formatDisplayDateTime } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCombobox as ComboSelect,
  AppFormField as FormField,
  AppInput as BaseInput,
} from "@silvicom/ui";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useToastStore } from "@/stores/toast";
import { pngDataUrl } from "@/features/recruitment/useRoadTest";
import {
  useAddRepresentative,
  useCountersignHandbook,
  useDeleteRepresentative,
  useHandbookStatus,
  useOpenHandbook,
  useRepresentatives,
} from "@/features/recruitment/useHandbook";

/**
 * The driver handbook, worked from the step's drawer (HANDBOOK-SIGNING-PLAN.md HB4; D-HB1..D-HB5).
 *
 * ── THE THREE MOVES, IN THE ORDER THE DATABASE HOLDS ──────────────────────────────────────────
 * After the application is filed, the office OPENS handbook signing with the driver at the desk; the
 * driver signs its five places on their own link, with the signature they adopted for the application;
 * then the office COUNTERSIGNS for the carrier with a Representative, which files the signed handbook.
 * The panel shows the one move that is next, and why the others are not yet.
 *
 * ── THE REPRESENTATIVES (D-HB3) ───────────────────────────────────────────────────────────────
 * Added with their signature and removed, as the maintenance inspectors are. One who has countersigned
 * a handbook cannot be removed — the server says so, and that sentence is what the toast shows.
 */
const props = defineProps<{ driverId: string; done: boolean }>();

const toast = useToastStore();
const driverId = computed(() => props.driverId);
const statusQ = useHandbookStatus(driverId);
const repsQ = useRepresentatives();
const addRep = useAddRepresentative();
const deleteRep = useDeleteRepresentative();
const open = useOpenHandbook(driverId);
const countersign = useCountersignHandbook(driverId);

const status = computed(() => statusQ.data.value ?? null);
const reps = computed(() => repsQ.data.value ?? []);
const repOptions = computed(() => reps.value.map((r) => ({ value: r.id, label: `${r.full_name} — ${r.title}` })));
const driverPlaces = HANDBOOK_PLACEMENTS.filter((p) => p.party === "driver");
const signedCount = computed(() => status.value?.driverSigned.length ?? 0);
const linkExpired = computed(() => Boolean(status.value && Date.parse(status.value.linkExpiresAt) <= Date.now()));

const representativeId = ref("");

// ── adding a Representative ────────────────────────────────────────────────────────────────────
const repForm = reactive({ fullName: "", title: "" });
const signature = ref<File | null>(null);
const addingRep = ref(false);
const canAddRep = computed(
  () => repForm.fullName.trim().length >= 2 && repForm.title.trim().length >= 2 && Boolean(signature.value),
);

async function saveRep(): Promise<void> {
  if (!signature.value) return;
  try {
    const created = await addRep.mutateAsync({
      full_name: repForm.fullName.trim(),
      title: repForm.title.trim(),
      signature_png: await pngDataUrl(signature.value),
    });
    toast.success("Representative added", `${created.full_name} can now sign handbooks for the carrier.`);
    representativeId.value = created.id;
    Object.assign(repForm, { fullName: "", title: "" });
    signature.value = null;
    addingRep.value = false;
  } catch (e) {
    toast.error("Could not add the representative", e instanceof Error ? e.message : undefined);
  }
}

async function removeRep(id: string, name: string): Promise<void> {
  try {
    await deleteRep.mutateAsync(id);
    toast.success("Representative removed", `${name} is no longer on the list.`);
    if (representativeId.value === id) representativeId.value = "";
  } catch (e) {
    toast.error("Could not remove the representative", e instanceof Error ? e.message : undefined);
  }
}

// ── the two acts ───────────────────────────────────────────────────────────────────────────────
async function openSigning(): Promise<void> {
  try {
    await open.mutateAsync(undefined);
    toast.success("Handbook signing is open", "The driver signs it now, on their own link.");
  } catch (e) {
    toast.error("Could not open handbook signing", e instanceof Error ? e.message : undefined);
  }
}

/**
 * The same door as Open (APPLICATION-FLOW-V2-PLAN.md A-2): every press keeps the driver's link alive for
 * another `INVITE_TTL_DAYS_DEFAULT` days, and a second press never re-stamps who opened it. Nothing
 * else extends a filed invitation's link, and 0374 refuses every handbook mark on a lapsed one.
 */
async function extendLink(): Promise<void> {
  try {
    await open.mutateAsync(undefined);
    toast.success("Link extended", `The driver's link stays open for another ${INVITE_TTL_DAYS_DEFAULT} days.`);
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

      <div v-else-if="!status.openedAt" class="space-y-3">
        <p class="text-sm text-ink-secondary">
          Open it with the driver at the desk. They sign its five places on the same link they used for the
          application, with the signature they adopted there.
        </p>
        <BaseButton variant="primary" size="sm" :disabled="open.isPending.value" @click="openSigning">
          {{ open.isPending.value ? "Opening…" : "Open handbook signing" }}
        </BaseButton>
      </div>

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
          <BaseButton variant="secondary" size="sm" :disabled="open.isPending.value" @click="extendLink">
            {{ open.isPending.value ? "Extending…" : "Extend the driver's link" }}
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
      <p v-if="reps.length === 0" class="text-xs text-ink-muted">
        Nobody signs for the carrier yet. Add a representative to countersign handbooks.
      </p>
      <ul v-else class="divide-y divide-edge border-y border-edge">
        <li v-for="rep in reps" :key="rep.id" class="flex items-center justify-between gap-3 py-2 text-xs">
          <span class="text-ink">{{ rep.full_name }} <span class="text-ink-secondary">· {{ rep.title }}</span></span>
          <BaseButton variant="ghost" size="sm" :disabled="deleteRep.isPending.value" @click="removeRep(rep.id, rep.full_name)">
            Remove
          </BaseButton>
        </li>
      </ul>

      <div v-if="reps.length === 0 || addingRep" class="space-y-4 rounded-surface border border-edge p-4">
        <p class="text-sm font-medium text-ink">Add a representative</p>
        <p class="text-xs text-ink-secondary">
          Their signature prints where the carrier agrees. Upload a PNG of it — a scan or a photo of them
          signing on white paper.
        </p>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="Name">
            <BaseInput :id="id" v-model="repForm.fullName" />
          </FormField>
          <FormField v-slot="{ id }" label="Title" hint="Printed beside their signature.">
            <BaseInput :id="id" v-model="repForm.title" placeholder="Safety manager" />
          </FormField>
        </div>
        <FileDropzone
          accept=".png"
          :busy="addRep.isPending.value"
          busy-label="Saving…"
          :label="signature ? signature.name : 'Drag & drop the signature (PNG)'"
          hint="PNG only. Stored privately with the carrier's files."
          @files="signature = $event[0] ?? null"
        />
        <div class="flex gap-3">
          <BaseButton variant="primary" size="sm" :disabled="!canAddRep || addRep.isPending.value" @click="saveRep">
            Add representative
          </BaseButton>
          <BaseButton v-if="reps.length > 0" variant="ghost" size="sm" @click="addingRep = false">Cancel</BaseButton>
        </div>
      </div>
      <BaseButton v-else variant="link" size="sm" @click="addingRep = true">Add a representative</BaseButton>
    </div>
  </div>
</template>
