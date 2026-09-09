<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { assetTypeInputSchema, type AssetTypeDto } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCheckbox as BaseCheckbox,
  AppFormField as FormField,
  AppInput as BaseInput,
} from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
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
 */

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const toast = useToastStore();
const { data: types } = useAssetTypesQuery();
const create = useCreateAssetType();
const update = useUpdateAssetType();
const adopt = useAdoptStandardKit();

const empty = computed(() => (types.value ?? []).length === 0);
const busy = computed(() => create.isPending.value || update.isPending.value || adopt.isPending.value);

const adding = ref(false);
const editing = ref<AssetTypeDto | null>(null);
const form = reactive({ name: "", category: "", serialized: true, defaultKitQuantity: "0" });

function startAdd() {
  editing.value = null;
  Object.assign(form, { name: "", category: "", serialized: true, defaultKitQuantity: "0" });
  adding.value = true;
}
function startEdit(type: AssetTypeDto) {
  editing.value = type;
  Object.assign(form, {
    name: type.name,
    category: type.category ?? "",
    serialized: type.serialized,
    defaultKitQuantity: String(type.defaultKitQuantity),
  });
  adding.value = true;
}

const errors = ref<Record<string, string>>({});

async function submit() {
  const parsed = assetTypeInputSchema.safeParse({
    name: form.name,
    category: form.category.trim() === "" ? null : form.category,
    serialized: form.serialized,
    defaultKitQuantity: Number(form.defaultKitQuantity || "0"),
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
  <SlideOver :open="props.open" title="Kinds of thing" @close="emit('close')">
    <div class="space-y-4">
      <p class="text-xs text-ink-tertiary">
        A kind of thing is what an asset is one of, and what a kit rule counts. Nothing can be added
        to the shop until at least one exists.
      </p>

      <!-- A4's answer, and only while there is nothing. See the header for why it disappears. -->
      <div v-if="empty" class="rounded-control bg-surface-subtle px-3 py-2.5 ring-1 ring-edge">
        <p class="text-sm font-medium text-ink">Start from the standard kit</p>
        <p class="mt-0.5 text-xs text-ink-muted">
          Twelve kinds of thing and the kit each truck, dry van and reefer carries — the five
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
            </p>
          </div>
          <BaseButton size="sm" @click="startEdit(type)">Edit</BaseButton>
        </li>
      </ul>

      <BaseButton v-if="!adding" :disabled="busy" @click="startAdd">Add a kind of thing</BaseButton>

      <form v-else class="space-y-4 border-t border-edge-subtle pt-4" @submit.prevent="submit">
        <FormField v-slot="{ id }" label="Name" :error="errors.name">
          <BaseInput :id="id" v-model="form.name" :invalid="!!errors.name" placeholder="Load bar" />
        </FormField>
        <FormField v-slot="{ id }" label="Category" hint="How the list groups. Optional.">
          <BaseInput :id="id" v-model="form.category" placeholder="Securement" />
        </FormField>
        <FormField
          v-slot="{ id }"
          label="How many a unit carries by default"
          hint="Used when no kit rule says otherwise. Zero is the usual answer — the rules on Units say the rest."
          :error="errors.defaultKitQuantity"
        >
          <BaseInput :id="id" v-model="form.defaultKitQuantity" inputmode="numeric" />
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
        <div class="flex justify-end gap-2">
          <BaseButton type="button" @click="adding = false">Cancel</BaseButton>
          <BaseButton type="submit" variant="primary" :disabled="busy">
            {{ editing ? "Save" : "Add" }}
          </BaseButton>
        </div>
      </form>
    </div>
  </SlideOver>
</template>
