<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  AppButton as BaseButton,
  AppCallout,
  AppDateTimeField,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSelect,
  AppTextarea,
  BaseModal,
} from "@silvicom/ui";
import {
  TOLL_PROVIDERS,
  TOLL_PROVIDER_LABEL,
  fieldValueToInstant,
  instantToFieldValue,
  isInServiceVehicleStatus,
  normaliseTagNumber,
  type TollProvider,
  type TransponderDto,
  type TransponderRetiredReason,
} from "@silvicom/shared";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useOrgTimezone } from "@/composables/useOrgTimezone";
import { useToastStore } from "@/stores/toast";
import { TollTagError, useTollTagWrites } from "./useTollTags";
import { tagLabel, type TollTagAction } from "./tollTagLabel";

/**
 * The four things the office does to a toll tag (TOLLS-PER-TRUCK-PLAN.md TL2): add one to this
 * truck, move it to another truck (or off), retire it, and void an entry that was wrong.
 *
 * ── EVERY CHANGE CARRIES WHEN ────────────────────────────────────────────────────────────────
 * A toll is charged to the truck that held the tag WHEN it went through the plaza (D-TL3), so "moved
 * Tuesday 6 a.m." and "moved now" put different money on different trucks. The time defaults to now
 * and is typed on the company's clock, never the browser's (`fieldValueToInstant`, D-PREC5).
 *
 * ── A TAG ALREADY ON FILE IS OFFERED, NOT DUPLICATED ─────────────────────────────────────────
 * Typing a number the fleet already holds comes back with that tag, and the dialog offers to move it
 * here from the time typed. A second row for one tag would split its tolls between two records.
 */

/**
 * `vehicleId` names the truck when the dialog is opened from that truck's page. From the Tolls page's
 * tag list it is absent, and "add" asks which truck instead (TL2b).
 */
const props = defineProps<{ action: TollTagAction | null; vehicleId?: string; unitNumber?: string }>();
const emit = defineEmits<{ close: [] }>();

const { zone } = useOrgTimezone();
const toast = useToastStore();
const writes = useTollTagWrites();
const { data: vehicles } = useVehiclesQuery();

const RETIRE_REASONS: Array<{ value: TransponderRetiredReason; label: string }> = [
  { value: "lost", label: "Lost or stolen" },
  { value: "returned", label: "Returned to the agency" },
  { value: "damaged", label: "Damaged" },
  { value: "replaced", label: "Replaced by a new tag" },
];
const providerOptions = TOLL_PROVIDERS.map((p) => ({ value: p, label: TOLL_PROVIDER_LABEL[p] }));

const form = reactive({
  provider: "ezpass" as TollProvider,
  tagNumber: "",
  issuer: "",
  at: "",
  toVehicle: "",
  onVehicle: "",
  reason: "lost" as TransponderRetiredReason,
  voidReason: "",
});
const error = ref<string | null>(null);
const existing = ref<TransponderDto | null>(null);

watch(
  () => props.action,
  (a) => {
    if (!a) return;
    Object.assign(form, { provider: "ezpass", tagNumber: "", issuer: "", toVehicle: "", onVehicle: "", reason: "lost", voidReason: "" });
    form.at = instantToFieldValue(new Date(), zone.value);
    error.value = null;
    existing.value = null;
  },
  { immediate: true },
);

const fleetTrucks = computed(() =>
  (vehicles.value ?? [])
    .filter((v) => isInServiceVehicleStatus(v.status))
    .sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true })),
);
const truckOptions = computed(() => [
  { value: "", label: "No truck (take it off)" },
  ...fleetTrucks.value
    .filter((v) => v.id !== (props.action?.kind === "move" ? props.action.tag.currentVehicleId : null))
    .map((v) => ({ value: v.id, label: `Unit ${v.unit_number}` })),
]);
const addTruckOptions = computed(() => [
  { value: "", label: "Choose the truck…" },
  ...fleetTrucks.value.map((v) => ({ value: v.id, label: `Unit ${v.unit_number}` })),
]);
/** The truck an "add" puts the tag on: the page's own truck, or the one picked in the dialog. */
const target = computed(() => {
  if (props.vehicleId) return { id: props.vehicleId, unit: props.unitNumber ?? "" };
  const v = fleetTrucks.value.find((x) => x.id === form.onVehicle);
  return v ? { id: v.id, unit: v.unit_number } : null;
});

const title = computed(() => {
  const a = props.action;
  if (!a) return "";
  if (a.kind === "add") return props.vehicleId ? `Add a toll tag to unit ${props.unitNumber}` : "Add a toll tag";
  if (a.kind === "move") return `Move ${tagLabel(a.tag)}`;
  if (a.kind === "retire") return `Retire ${tagLabel(a.tag)}`;
  return "Void a wrong entry";
});
const atLabel = computed(() => {
  const k = props.action?.kind;
  return k === "add" ? "On this truck since" : k === "move" ? "Moved at" : "Came off the truck at";
});
const typedNumberOk = computed(() => normaliseTagNumber(form.tagNumber) != null);
const atInstant = computed(() => fieldValueToInstant(form.at, zone.value));
const busy = computed(() => Object.values(writes).some((m) => m.isPending.value));
const ready = computed(() => {
  const k = props.action?.kind;
  if (k === "void") return form.voidReason.trim().length > 0;
  if (!atInstant.value) return false;
  return k === "add" ? typedNumberOk.value && target.value !== null : true;
});

function fail(e: unknown) {
  error.value = e instanceof Error ? e.message : "Could not save the toll tag. Try again.";
  existing.value = e instanceof TollTagError ? e.existing : null;
}

async function submit() {
  const a = props.action;
  if (!a || !ready.value) return;
  error.value = null;
  try {
    if (a.kind === "add") {
      const truck = target.value!;
      const tag = await writes.register.mutateAsync({
        provider: form.provider,
        tagNumber: form.tagNumber,
        issuer: form.issuer.trim() || null,
        vehicleId: truck.id,
        at: atInstant.value,
      });
      toast.success(`${tagLabel(tag)} is on unit ${truck.unit}`);
    } else if (a.kind === "move") {
      await writes.move.mutateAsync({ id: a.tag.id, input: { vehicleId: form.toVehicle || null, at: atInstant.value! } });
      toast.success(form.toVehicle ? `${tagLabel(a.tag)} moved` : `${tagLabel(a.tag)} taken off the truck`);
    } else if (a.kind === "retire") {
      await writes.retire.mutateAsync({ id: a.tag.id, input: { reason: form.reason, at: atInstant.value! } });
      toast.success(`${tagLabel(a.tag)} retired`);
    } else {
      await writes.voidEntry.mutateAsync({ id: a.entryId, input: { reason: form.voidReason.trim() } });
      toast.success("Entry voided. Its tolls now follow the corrected history.");
    }
    emit("close");
  } catch (e) {
    fail(e);
  }
}

/** The tag typed is on file: move THAT tag here, from the time typed. */
async function moveExistingHere() {
  const truck = target.value;
  if (!existing.value || !atInstant.value || !truck) return;
  try {
    await writes.move.mutateAsync({ id: existing.value.id, input: { vehicleId: truck.id, at: atInstant.value } });
    toast.success(`${tagLabel(existing.value)} is on unit ${truck.unit}`);
    emit("close");
  } catch (e) {
    fail(e);
  }
}
</script>

<template>
  <BaseModal :open="action !== null" :title="title" @close="emit('close')">
    <form id="toll-tag-form" class="space-y-4" @submit.prevent="submit">
      <template v-if="action?.kind === 'add'">
        <FormField v-if="!vehicleId" v-slot="{ id }" label="Truck">
          <AppSelect :id="id" v-model="form.onVehicle" :options="addTruckOptions" data-test="add-on-truck" />
        </FormField>
        <FormField v-slot="{ id }" label="Provider">
          <AppSelect :id="id" v-model="form.provider" :options="providerOptions" />
        </FormField>
        <FormField
          v-slot="{ id }"
          label="Tag number"
          hint="As printed on the tag. Spaces and dashes are fine."
          :error="form.tagNumber && !typedNumberOk ? 'A tag number is 4 to 24 letters and digits.' : undefined"
        >
          <BaseInput :id="id" v-model="form.tagNumber" autocomplete="off" data-test="tag-number" />
        </FormField>
        <FormField v-slot="{ id }" label="Issued by" hint="Optional. The agency on the account, e.g. NTTA or Illinois Tollway.">
          <BaseInput :id="id" v-model="form.issuer" maxlength="64" />
        </FormField>
      </template>
      <FormField v-if="action?.kind === 'move'" v-slot="{ id }" label="Move to">
        <AppSelect :id="id" v-model="form.toVehicle" :options="truckOptions" data-test="move-to" />
      </FormField>
      <FormField v-if="action?.kind === 'retire'" v-slot="{ id }" label="Why">
        <AppSelect :id="id" v-model="form.reason" :options="RETIRE_REASONS" />
      </FormField>
      <template v-if="action?.kind === 'void'">
        <p class="text-sm text-ink-secondary">
          {{ action.entryLabel }}. A voided entry stays in the history, crossed out, and its tolls are charged by the
          entries left.
        </p>
        <FormField v-slot="{ id }" label="What was wrong">
          <AppTextarea :id="id" v-model="form.voidReason" rows="2" maxlength="500" data-test="void-reason" />
        </FormField>
      </template>
      <FormField
        v-if="action && action.kind !== 'void'"
        v-slot="{ id }"
        :label="atLabel"
        hint="On the company's clock. Tolls before this time stay with the truck that had the tag."
      >
        <AppDateTimeField :id="id" v-model="form.at" />
      </FormField>
      <AppCallout v-if="error" tone="danger" role="alert" data-test="toll-tag-error">
        {{ error }}
        <div v-if="existing && target" class="mt-2">
          <BaseButton size="sm" :disabled="busy" data-test="move-existing" @click="moveExistingHere">
            Move {{ tagLabel(existing) }} to unit {{ target?.unit }}
          </BaseButton>
        </div>
      </AppCallout>
    </form>
    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">Cancel</BaseButton>
      <BaseButton
        form="toll-tag-form"
        type="submit"
        :variant="action?.kind === 'retire' || action?.kind === 'void' ? 'danger' : 'primary'"
        :disabled="!ready || busy"
        data-test="toll-tag-submit"
      >
        {{ busy ? "Saving…" : action?.kind === "add" ? "Add tag" : action?.kind === "move" ? "Move tag" : action?.kind === "retire" ? "Retire tag" : "Void entry" }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
