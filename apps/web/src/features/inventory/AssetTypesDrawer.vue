<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { assetTypeInputSchema, type AssetHeldBy, type AssetTypeDto } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppFormField as FormField,
  AppInput as BaseInput,
  AppSegmentedControl,
} from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { QueryState } from "@silvicom/ui";
import {
  useAdoptStandardKit,
  useAssetTypesQuery,
  useCreateAssetType,
  useUpdateAssetType,
} from "./useAssets";
import { useToastStore } from "@/stores/toast";

/**
 * The kinds of thing the shop owns (INVENTORY-PLAN.md I9 close-out, 2026-09-09).
 *
 * ── ⚠ THE DEAD END THIS EXISTS TO CLOSE ───────────────────────────────────────────────────────
 * `assetInputSchema.assetTypeId` is a required uuid, so an asset cannot be created without a type —
 * and until this drawer there was NO screen in the product that could create one. `POST
 * /asset-types` shipped at I8 with no consumer; `useCreateAssetType` had no caller; and two drawers
 * told the reader to "add one on Assets first", where nothing could. A fresh org's entire asset and
 * unit half was unreachable on day one. Measured 2026-09-09, and it is the same shape as the gap
 * `LocationsDrawer.vue` was built to close for stock locations at I4 — an endpoint with no consumer
 * and no step owning a screen.
 *
 * ── THE STANDARD KIT IS OFFERED ONLY WHILE THERE IS NOTHING ───────────────────────────────────
 * A4's answer (the owner's three lists) is one tap here, and the button disappears the moment the
 * org has a type. That is not tidiness: adopting the kit OVERWRITES fleet rules with the
 * catalogue's numbers, so a shop that has since decided its trailers carry six straps would find
 * four again. It is a first run, not a reset, and the only honest way to offer it is to make it
 * unreachable once a shop has started deciding for itself.
 *
 * ── `serialized` IS THE FIELD WITH CONSEQUENCES ───────────────────────────────────────────────
 * It decides whether `move_asset` refuses a second one on a unit (`IV020`), so the copy says what it
 * does rather than naming the column. A tablet is serialized — which tablet matters. Ratchet straps
 * are not: four straps are four straps, and a tag per strap is how the discipline gets abandoned in
 * week two (§2.1).
 *
 * ── AND SO IS `heldBy` (DE2b; D-DE1, owner 2026-10-27 and 2026-10-29) ─────────────────────────
 * Who holds this kind of thing: a truck, trailer or the shop — or a driver, which is a tablet's answer
 * and nothing else's. It decides what the move drawer offers (Give to a driver / Return to the shop,
 * or the truck-and-trailer picker) and how the On trucks tab words a kit line. No catalogue line and
 * no migration sets it: the owner sets Tablet once, here. Switching it while any of the type's things
 * sit with the other kind of holder is refused by 0524 (`held_by_conflict`), and the API's sentence —
 * move them first — is shown beside the choice, because that is where the person reads it.
 */

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

/** The footer submits the form by id — `PartForm.vue` records why the buttons are not in the body. */
const FORM_ID = "asset-type-form";

const toast = useToastStore();
const { data: types, isLoading, isError, isFetching, refetch } = useAssetTypesQuery();
const create = useCreateAssetType();
const update = useUpdateAssetType();
const adopt = useAdoptStandardKit();

/**
 * Empty is a READ's answer, never its absence (2026-10-14). This was `(types ?? []).length === 0`,
 * true while the read was in flight and true when it FAILED — so a shop whose kinds could not be
 * read was offered "Set it up", which overwrites the kit rules it had made its own (see above).
 */
const empty = computed(() => types.value !== undefined && types.value.length === 0);
const busy = computed(() => create.isPending.value || update.isPending.value || adopt.isPending.value);

const adding = ref(false);
const editing = ref<AssetTypeDto | null>(null);
const form = reactive({
  name: "",
  category: "",
  serialized: true,
  defaultKitQuantity: "0",
  heldBy: "unit" as AssetHeldBy,
});

/** The two answers, in the words a shop uses — the values are `asset_types.held_by`'s (0524). */
const HELD_BY_OPTIONS: { value: AssetHeldBy; label: string }[] = [
  { value: "unit", label: "A truck, trailer or the shop" },
  { value: "driver", label: "A driver (tablets)" },
];

function startAdd() {
  editing.value = null;
  Object.assign(form, { name: "", category: "", serialized: true, defaultKitQuantity: "0", heldBy: "unit" });
  errors.value = {};
  adding.value = true;
}
function startEdit(type: AssetTypeDto) {
  editing.value = type;
  Object.assign(form, {
    name: type.name,
    category: type.category ?? "",
    serialized: type.serialized,
    defaultKitQuantity: String(type.defaultKitQuantity),
    heldBy: type.heldBy,
  });
  errors.value = {};
  adding.value = true;
}

const errors = ref<Record<string, string>>({});

async function submit() {
  const parsed = assetTypeInputSchema.safeParse({
    name: form.name,
    category: form.category.trim() === "" ? null : form.category,
    serialized: form.serialized,
    defaultKitQuantity: Number(form.defaultKitQuantity || "0"),
    heldBy: form.heldBy,
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
  errors.value = {};
  try {
    if (editing.value) await update.mutateAsync({ id: editing.value.id, patch: parsed.data });
    else await create.mutateAsync(parsed.data);
    toast.success(editing.value ? "Type saved" : "Type added");
    adding.value = false;
  } catch (e) {
    if ((e as { code?: string }).code === "held_by_conflict") {
      errors.value = { heldBy: (e as Error).message };
      return;
    }
    toast.error("Could not save the type", e instanceof Error ? e.message : undefined);
  }
}

async function adoptKit() {
  try {
    const result = await adopt.mutateAsync();
    toast.success(
      "Standard kit set up",
      `${result.typesCreated} kinds of thing and ${result.rulesSet} kit rules. Edit any of them here or on Units.`,
    );
  } catch (e) {
    toast.error("Could not set up the standard kit", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver
    :open="props.open"
    title="Types of equipment"
    description="A type is what a piece of equipment is one of, and what a should-carry rule counts. Nothing can be added until at least one exists."
    @close="emit('close')"
  >
    <div class="space-y-4">
      <QueryState
        :loading="isLoading"
        :error="isError"
        :retrying="isFetching"
        loading-text="Loading the types…"
        error-text="Could not load the types."
        @retry="refetch()"
      >
        <!-- A4's answer, and only while there is nothing. See the header for why it disappears. -->
        <div v-if="empty" class="rounded-control bg-surface-subtle px-3 py-2.5 ring-1 ring-edge">
          <p class="text-sm font-medium text-ink">Start from the standard list</p>
          <p class="mt-0.5 text-xs text-ink-muted">
            Twelve types and what each truck, dry van and reefer carries — the five
            §393.95 asks about, plus this fleet's securement. Every number is editable afterwards.
          </p>
          <BaseButton class="mt-2" variant="primary" :disabled="busy" @click="adoptKit">
            Set it up
          </BaseButton>
        </div>

        <ul v-if="!empty" class="divide-y divide-edge-subtle">
          <li v-for="type in types ?? []" :key="type.id" class="flex items-center justify-between gap-3 py-2">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-ink">{{ type.name }}</p>
              <p class="mt-0.5 text-xs text-ink-tertiary">
                {{ type.category ?? "No category" }}
                <span v-if="type.serialized"> · tracked one by one</span>
                <span v-if="type.heldBy === 'driver'"> · held by a driver</span>
              </p>
            </div>
            <BaseButton size="sm" @click="startEdit(type)">Edit</BaseButton>
          </li>
        </ul>
      </QueryState>

      <form v-if="adding" :id="FORM_ID" class="border-t border-edge-subtle pt-5" @submit.prevent="submit">
        <h3 class="text-sm font-semibold text-ink">{{ editing ? "Edit kind" : "New kind of thing" }}</h3>
        <div class="mt-4 space-y-4">
          <FormField v-slot="{ id }" label="Name" :error="errors.name">
            <BaseInput :id="id" v-model="form.name" :invalid="!!errors.name" placeholder="Load bar" />
          </FormField>
          <FormField v-slot="{ id }" label="Category" hint="How the list groups. Optional.">
            <BaseInput :id="id" v-model="form.category" placeholder="Securement" />
          </FormField>
          <FormField
            v-slot="{ id }"
            label="How many a truck or trailer carries by default"
            hint="Used when no rule says otherwise. Zero is the usual answer — the rules on Trucks & trailers say the rest."
            :error="errors.defaultKitQuantity"
          >
            <BaseInput :id="id" v-model="form.defaultKitQuantity" inputmode="numeric" />
          </FormField>
          <FormField
            label="Who holds one"
            hint="A driver takes a tablet home with them; everything else stays on a truck, a trailer or a shelf."
            :error="errors.heldBy"
          >
            <AppSegmentedControl v-model="form.heldBy" :options="HELD_BY_OPTIONS" label="Who holds one" />
          </FormField>
          <!-- The copy says what the flag DOES, because what it does is refuse a second one. -->
          <div class="rounded-control bg-surface-subtle px-3 py-2.5 ring-1 ring-edge">
            <BaseCheckbox v-model="form.serialized">
              <span class="text-sm">
                <span class="font-medium text-ink">Track each one separately</span>
                <span class="block text-xs text-ink-muted">
                  For things where which one matters — a tablet has a serial number and a warranty. Off
                  for straps and chocks, where four are just four.
                </span>
              </span>
            </BaseCheckbox>
          </div>
        </div>
      </form>
    </div>
    <template #footer>
      <div v-if="adding" class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="busy" @click="adding = false">Cancel</BaseButton>
        <BaseButton :form="FORM_ID" type="submit" variant="primary" :disabled="busy">
          {{ busy ? "Saving…" : editing ? "Save kind" : "Add kind" }}
        </BaseButton>
      </div>
      <div v-else class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" @click="emit('close')">Close</BaseButton>
        <BaseButton variant="primary" :disabled="busy" @click="startAdd">Add a type</BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
