<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { stockLocationInputSchema, type StockLocationDto } from "@silvicom/shared";
import {
  AppBadge,
  AppButton as BaseButton,
  AppFormField as FormField,
  AppInput as BaseInput,
} from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { useCreateLocation, useLocationsQuery, useUpdateLocation } from "./useInventory";
import { useToastStore } from "@/stores/toast";

/**
 * Where the shop keeps things (D-INV1) — the list, and the form that adds to it.
 *
 * ── WHY THIS EXISTS AT I4, WHEN NO STEP ASKED FOR IT ──────────────────────────────────────────
 * Measured on 2026-09-09: production holds **zero rows in all four inventory tables**, and
 * `stock_locations` is the one nothing in the product could ever write. I3 shipped `POST /locations`
 * and `PATCH /locations/:id`; no step in INVENTORY-PLAN.md owns a screen for them; and I11's
 * settings drawer chooses a DEFAULT location, which presumes some already exist. Followed literally
 * the programme would have reached I5 with a receive drawer that has nowhere to receive into.
 *
 * That is the same class of gap the 2026-09-09 review found for `reorder_point` — an endpoint with
 * no consumer and no step owning one — and it is closed the same way, in the step whose screens
 * first need it. Recorded in the plan's §8 rather than left as a surprise for I5.
 *
 * ── IT IS A DRAWER ON PARTS, NOT A FIFTH NAV ENTRY ────────────────────────────────────────────
 * I4's ruling fixes the maintenance group's membership, and a shop with one bay does not want a
 * menu item for the list of it. The "Stock locations" button is where I11's inventory settings
 * land too, so the two arrive in one place rather than as two shop-configuration surfaces a year
 * apart.
 *
 * ── THE ACTIONS ARE IN THE FOOTER (2026-09-10) ────────────────────────────────────────────────
 * "Add a location" while the list is showing; Cancel and Save while the form is. Pinned, so a
 * long list of bays never scrolls the way in out of reach — `PartForm.vue` records the rule.
 *
 * ── CLOSING, NOT DELETING ─────────────────────────────────────────────────────────────────────
 * A closed location keeps its stock lines and its history; what changes is that the RPC refuses a
 * movement into it (`IV012`). So every picker in the product asks for active locations only, and
 * this screen is the one place that shows the closed ones — because reopening one has to be
 * possible from somewhere.
 */

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const FORM_ID = "location-form";

const toast = useToastStore();
const { data: locations, isLoading } = useLocationsQuery(true);
const create = useCreateLocation();
const update = useUpdateLocation();

const adding = ref(false);
const editing = ref<StockLocationDto | null>(null);
const form = reactive({ name: "", code: "", address: "" });
const errors = ref<Record<string, string>>({});

const submitting = computed(() => create.isPending.value || update.isPending.value);

function startAdd() {
  editing.value = null;
  Object.assign(form, { name: "", code: "", address: "" });
  errors.value = {};
  adding.value = true;
}

function startEdit(location: StockLocationDto) {
  editing.value = location;
  Object.assign(form, { name: location.name, code: location.code, address: location.address ?? "" });
  errors.value = {};
  adding.value = true;
}

async function onSubmit() {
  const parsed = stockLocationInputSchema.safeParse({
    name: form.name,
    code: form.code,
    address: form.address.trim() === "" ? null : form.address,
  });
  if (!parsed.success) {
    const map: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !map[key]) map[key] = issue.message;
    }
    errors.value = map;
    return;
  }
  try {
    if (editing.value) await update.mutateAsync({ id: editing.value.id, patch: parsed.data });
    else await create.mutateAsync(parsed.data);
    toast.success(editing.value ? "Location saved" : "Location added");
    adding.value = false;
    editing.value = null;
  } catch (e) {
    // The API's own sentence — a duplicate code is refused by name, and "Could not save" would
    // throw away the half of the answer that says what to change.
    toast.error("Could not save the location", e instanceof Error ? e.message : undefined);
  }
}

async function setActive(location: StockLocationDto, active: boolean) {
  try {
    await update.mutateAsync({ id: location.id, patch: { active } });
    toast.success(active ? "Location reopened" : "Location closed");
  } catch (e) {
    toast.error("Could not change the location", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver
    :open="open"
    title="Stock locations"
    description="Where the shop keeps things. A part sits on a shelf at one of these, and stock is counted per location."
    @close="emit('close')"
  >
    <div class="space-y-4">
      <ul v-if="locations?.length" class="divide-y divide-edge-subtle">
        <li v-for="location in locations" :key="location.id" class="flex items-start justify-between gap-3 py-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-ink">
              {{ location.name }}
              <span class="ml-1 font-mono text-xs text-ink-tertiary">{{ location.code }}</span>
            </p>
            <p v-if="location.address" class="mt-0.5 text-xs text-ink-tertiary">{{ location.address }}</p>
            <AppBadge v-if="!location.active" tone="neutral" class="mt-1">Closed</AppBadge>
          </div>
          <div class="flex shrink-0 gap-2">
            <BaseButton variant="ghost" size="sm" @click="startEdit(location)">Edit</BaseButton>
            <BaseButton
              v-if="location.active"
              variant="ghost"
              size="sm"
              @click="setActive(location, false)"
            >
              Close
            </BaseButton>
            <BaseButton v-else variant="ghost" size="sm" @click="setActive(location, true)">Reopen</BaseButton>
          </div>
        </li>
      </ul>
      <p v-else-if="!isLoading" class="text-sm text-ink-tertiary">
        No locations yet. Add the shop itself first — everything on a shelf is somewhere.
      </p>

      <form v-if="adding" :id="FORM_ID" class="border-t border-edge-subtle pt-5" @submit.prevent="onSubmit">
        <h3 class="text-sm font-semibold text-ink">{{ editing ? "Edit location" : "New location" }}</h3>
        <div class="mt-4 space-y-4">
          <FormField v-slot="{ id }" label="Name" :error="errors.name">
            <BaseInput :id="id" v-model="form.name" placeholder="Main shop" :invalid="!!errors.name" />
          </FormField>
          <!-- Capped at 24 characters because it is what somebody says across a bay, not a label. -->
          <FormField v-slot="{ id }" label="Short code" hint="What people call it out loud." :error="errors.code">
            <BaseInput :id="id" v-model="form.code" placeholder="MAIN" :invalid="!!errors.code" />
          </FormField>
          <FormField v-slot="{ id }" label="Address">
            <BaseInput :id="id" v-model="form.address" />
          </FormField>
        </div>
      </form>
    </div>
    <template #footer>
      <div v-if="adding" class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="submitting" @click="adding = false">Cancel</BaseButton>
        <BaseButton :form="FORM_ID" type="submit" variant="primary" :disabled="submitting">
          {{ submitting ? "Saving…" : editing ? "Save location" : "Add location" }}
        </BaseButton>
      </div>
      <div v-else class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" @click="emit('close')">Close</BaseButton>
        <BaseButton variant="primary" @click="startAdd">Add a location</BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
