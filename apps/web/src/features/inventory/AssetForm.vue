<script lang="ts">
/** The form's id, which its drawer's pinned footer submits by `form=`. */
export const ASSET_FORM_ID = "asset-form";
</script>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  ASSET_STATUSES,
  ASSET_STATUS_LABELS,
  ITEM_CONDITIONS,
  ITEM_CONDITION_LABELS,
  assetCreateSchema,
  assetInputSchema,
  type AssetCreateInput,
  type AssetDto,
  type AssetTypeDto,
  type StockLocationDto,
} from "@silvicom/shared";
import {
  AppCombobox as ComboSelect,
  AppDateField,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppTextarea as BaseTextarea,
} from "@silvicom/ui";

/**
 * What an asset IS — never where it is (INVENTORY-PLAN.md I8, D-INV3).
 *
 * ── THE HOLDER APPEARS ONCE, ON A NEW ASSET, AND NEVER AGAIN ──────────────────────────────────
 * "Where it starts" is the one moment an asset's place is written outside `move_asset`: a tablet
 * unpacked onto the crib shelf was not moved there from anywhere, so it writes no ledger row.
 * Every later change of place is a movement, which is why this form drops the field entirely when
 * editing. An edit screen that could quietly re-home a tablet would leave its own history saying it
 * is still in 611 — and `rebuild_asset_holders` would then put it back there.
 *
 * ── IT ASKS FOR NEITHER IDENTIFIER ────────────────────────────────────────────────────────────
 * No tag, no number. `display_seq` is allocated by the database under a lock and rendered as
 * `A-0412` by `nextDisplayNo`; a tag is issued at I10 with a uniqueness check no form can perform,
 * and 0333 refuses to change one once set (`IV022`) because a tag is printed onto polyester and
 * stuck to a thing. A field here would be a client naming an identifier the system owns.
 *
 * ── A BLANK OPTIONAL FIELD IS SENT AS NULL, NOT AS "" ─────────────────────────────────────────
 * `PartForm.vue`'s rule and the same reason: `optionalText` accepts both, so an empty string would
 * be stored and `serialNumber` would then be present-but-empty on some rows and absent on others —
 * two spellings of one fact for every consumer downstream.
 *
 * ── THE CONTROLS ARE THE PRODUCT'S OWN (2026-09-10) ───────────────────────────────────────────
 * Dates go through `AppDateField`, the picker every other date in the app opens — these two were
 * the last native `type="date"` inputs left, and on a tablet they opened the operating system's
 * wheel while every other date in the product opened ours. Selects are `AppCombobox` for the reason
 * `InspectorDrawer.vue` records, and the buttons live in the drawer's pinned footer, submitting
 * this form by id (`PartForm.vue` carries that argument).
 */


const props = defineProps<{
  asset?: AssetDto | null;
  types: AssetTypeDto[];
  /** Active locations only: 0333 refuses a placement into a bay that has been closed (`IV012`). */
  locations: StockLocationDto[];
}>();
const emit = defineEmits<{ submit: [input: AssetCreateInput] }>();

const editing = computed(() => Boolean(props.asset));

const form = reactive({
  assetTypeId: props.asset?.assetTypeId ?? "",
  name: props.asset?.name ?? "",
  serialNumber: props.asset?.serialNumber ?? "",
  model: props.asset?.model ?? "",
  manufacturer: props.asset?.manufacturer ?? "",
  status: (props.asset?.status ?? "in_service") as string,
  condition: (props.asset?.condition ?? "good") as string,
  purchasedAt: props.asset?.purchasedAt ?? "",
  purchaseCost: props.asset?.purchaseCost === null || props.asset === undefined ? "" : String(props.asset?.purchaseCost ?? ""),
  warrantyExpiresAt: props.asset?.warrantyExpiresAt ?? "",
  notes: props.asset?.notes ?? "",
  locationId: "",
});

const typeOptions = computed(() => props.types.map((t) => ({ value: t.id, label: t.name })));
const locationOptions = computed(() =>
  props.locations.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` })),
);
const CONDITION_OPTIONS = ITEM_CONDITIONS.map((c) => ({ value: c, label: ITEM_CONDITION_LABELS[c] }));
const STATUS_OPTIONS = ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_LABELS[s] }));

const blankToNull = (v: string): string | null => (v.trim() === "" ? null : v);
const errors = ref<Record<string, string>>({});

function onSubmit() {
  const base = {
    assetTypeId: form.assetTypeId,
    name: form.name,
    serialNumber: blankToNull(form.serialNumber),
    model: blankToNull(form.model),
    manufacturer: blankToNull(form.manufacturer),
    status: form.status,
    condition: form.condition,
    purchasedAt: blankToNull(form.purchasedAt),
    purchaseCost: form.purchaseCost.trim() === "" ? null : Number(form.purchaseCost),
    warrantyExpiresAt: blankToNull(form.warrantyExpiresAt),
    notes: blankToNull(form.notes),
  };
  // The edit path validates against `assetInputSchema`, which has no holder at all, so a stray
  // `locationId` cannot reach the PATCH even if this component were changed to bind one.
  const result = editing.value
    ? assetInputSchema.safeParse(base)
    : assetCreateSchema.safeParse({ ...base, locationId: blankToNull(form.locationId) });
  if (!result.success) {
    const map: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !map[key]) map[key] = issue.message;
    }
    errors.value = map;
    return;
  }
  errors.value = {};
  emit("submit", result.data as AssetCreateInput);
}
</script>

<template>
  <form :id="ASSET_FORM_ID" class="space-y-6" @submit.prevent="onSubmit">
    <section aria-labelledby="asset-form-what">
      <h3 id="asset-form-what" class="text-sm font-semibold text-ink">What it is</h3>
      <p class="mt-1 text-sm text-ink-muted">The number is issued when it is saved; a tag comes from the label sheet.</p>
      <div class="mt-4 space-y-4">
        <FormField v-slot="{ id }" label="Kind of thing" :error="errors.assetTypeId">
          <ComboSelect
            :id="id"
            v-model="form.assetTypeId"
            :options="typeOptions"
            placeholder="Tablet, load bar, ratchet strap…"
            empty-text="No kinds yet. Add one under Asset kinds first — a kind says whether each of these is tracked individually."
          />
        </FormField>

        <FormField v-slot="{ id }" label="Name" :error="errors.name">
          <BaseInput :id="id" v-model="form.name" :invalid="!!errors.name" placeholder="Cab tablet" />
        </FormField>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="Serial number" hint="What is stamped on it. Optional.">
            <BaseInput :id="id" v-model="form.serialNumber" />
          </FormField>
          <FormField v-slot="{ id }" label="Model">
            <BaseInput :id="id" v-model="form.model" />
          </FormField>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField v-slot="{ id }" label="Manufacturer">
            <BaseInput :id="id" v-model="form.manufacturer" />
          </FormField>
          <FormField v-slot="{ id }" label="Condition" :error="errors.condition">
            <ComboSelect :id="id" v-model="form.condition" :options="CONDITION_OPTIONS" placeholder="Good, worn, damaged" />
          </FormField>
        </div>

        <!-- Editable, and `retired` is not special-cased: the office corrects a status typed wrongly,
             while `move_asset` sets it when a `retired` movement is written. Both are the same column. -->
        <FormField v-if="editing" v-slot="{ id }" label="Status" :error="errors.status">
          <ComboSelect :id="id" v-model="form.status" :options="STATUS_OPTIONS" placeholder="In service" />
        </FormField>
      </div>
    </section>

    <!-- Only when adding. See the header: after this, where it is comes from a move. -->
    <section v-if="!editing" aria-labelledby="asset-form-where">
      <h3 id="asset-form-where" class="text-sm font-semibold text-ink">Where it starts</h3>
      <p class="mt-1 text-sm text-ink-muted">Every later change of place is a move, recorded in its history.</p>
      <div class="mt-4 space-y-4">
        <FormField v-slot="{ id }" label="Location" hint="Leave empty if nothing is decided yet." :error="errors.locationId">
          <ComboSelect
            :id="id"
            v-model="form.locationId"
            :options="locationOptions"
            placeholder="A bay or the tool crib"
            empty-text="No locations yet."
          />
        </FormField>
      </div>
    </section>

    <section aria-labelledby="asset-form-bought">
      <h3 id="asset-form-bought" class="text-sm font-semibold text-ink">Bought</h3>
      <div class="mt-4 space-y-4">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField v-slot="{ id }" label="Bought on">
            <AppDateField :id="id" v-model="form.purchasedAt" />
          </FormField>
          <FormField v-slot="{ id }" label="Cost" :error="errors.purchaseCost">
            <BaseInput :id="id" v-model="form.purchaseCost" inputmode="decimal" />
          </FormField>
          <FormField v-slot="{ id }" label="Warranty until">
            <AppDateField :id="id" v-model="form.warrantyExpiresAt" />
          </FormField>
        </div>

        <FormField v-slot="{ id }" label="Notes">
          <BaseTextarea :id="id" v-model="form.notes" :rows="2" />
        </FormField>
      </div>
    </section>
  </form>
</template>
