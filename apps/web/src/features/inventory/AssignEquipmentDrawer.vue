<script setup lang="ts">
import { computed, ref } from "vue";
import {
  AppButton as BaseButton,
  AppFormField as FormField,
  AppIcon,
  AppIconButton,
  AppInput as BaseInput,
  provideTouchTargets,
} from "@silvicom/ui";
import { ScanIcon, XMarkIcon } from "@silvicom/ui/icons";
import type { AssetDto, AssetMovementInput, ScanResult } from "@silvicom/shared";
import SlideOver from "@/components/SlideOver.vue";
import BarcodeCamera from "@/components/BarcodeCamera.vue";
import { useScanInput } from "@/composables/useScanInput";
import { useTouchedWindow } from "@/composables/usePhoneFirst";
import { useVehiclesQuery } from "@/composables/useVehicles";
import { useDriversQuery } from "@/composables/useDrivers";
import { useToastStore } from "@/stores/toast";
import AssetDrawer from "./AssetDrawer.vue";
import type { AssetFormSeed } from "./AssetForm.vue";
import { useAssetTypesQuery, useMoveAsset } from "./useAssets";
import { resolveScanCode } from "./useScan";
import { SCAN_PAGE_READER } from "./shopBarcodeFormats";
import {
  assignPayload,
  holderPartner,
  judgeScan,
  type AssignTarget,
  type AssignVerdict,
} from "./assignLine";

/**
 * Assign equipment — scan things onto the truck, trailer or driver whose page opened this
 * (EQUIPMENT-ASSIGN-BY-SCAN-PROPOSAL.md §3.1, EA1; owner 2026-10-30).
 *
 * ── A LIST, NOT A FORM ────────────────────────────────────────────────────────────────────────
 * Every scan adds a line and the drawer keeps listening, so a box of straps is scanned in one go and
 * confirmed once. Each line says what Confirm will do to it, judged by `assignLine.ts` — including
 * the lines it will NOT do (a tablet scanned on a truck, a shop part, a retired item), so nothing is
 * refused after the person has pressed Confirm and walked away.
 *
 * ── THE VERDICT IS COMPUTED, THE ANSWER IS STORED ─────────────────────────────────────────────
 * A line keeps the API's answer (`ScanResult`) and the holder it is going to, and the verdict is
 * derived from those and the types on every render. So a line scanned before the types arrived is
 * re-judged when they do, rather than keeping a guess — `isDriverHeld` cannot tell a tablet on the
 * shelf from a strap without its type, and guessing would put a tablet on a truck for `IV025` to
 * refuse.
 *
 * ── ONE MOVEMENT ID PER LINE, MINTED WHEN THE SCAN LANDED (D-INV27) ───────────────────────────
 * Confirm posts one `move_asset` per line through the same route the move drawer uses, each with the
 * id the line was given when it was scanned. A Confirm that half-fails on bad bay wifi and is pressed
 * again re-sends the same ids, and the ones that landed the first time answer with the row they
 * already wrote — never a second move. Lines that landed say so and stay out of the retry.
 *
 * ── THE SCANNER ───────────────────────────────────────────────────────────────────────────────
 * The Tera Pro is a keyboard: `useScanInput`'s document listener reads it while this drawer is up and
 * nothing is stacked on it. The typed field is the fogged-label fallback (Enter or Tab sends, as on
 * the Scan page, R11), and the camera is M9c's overlay, reading our QR, a sticker's Code 128 and the
 * same symbols the Scan page reads — so anything that page can find, this list can take.
 */

const props = defineProps<{ open: boolean; target: AssignTarget }>();
const emit = defineEmits<{ close: [] }>();

type LineState = "looking" | "judged" | "lookup_failed" | "saving" | "saved" | "failed";
interface Line {
  key: number;
  code: string;
  moveId: string;
  state: LineState;
  result: ScanResult | null;
  /** Where it goes: the page's holder, or the one a refused line offered instead. */
  to: AssignTarget;
  error: string | null;
  flash: boolean;
}

/**
 * The shop's 48 px floor (contract §9), on whichever page opened this. The vehicle, trailer and driver
 * pages are not phone-first, so `AppShell` gives them none — but this list is used standing at a truck
 * with a tablet in one hand and the scanner in the other, and the browser pass measured its controls
 * at 32–40 px there (2026-10-30). `ShopLayout`'s same call, for the same reason, gave the Scan page its.
 */
provideTouchTargets(useTouchedWindow());

const toast = useToastStore();
const move = useMoveAsset();
const { data: types } = useAssetTypesQuery();
const { data: vehicles } = useVehiclesQuery();
const { data: drivers } = useDriversQuery();
const partner = computed(() => holderPartner(props.target, vehicles.value, drivers.value));

const lines = ref<Line[]>([]);
let seq = 0;
const typed = ref("");
const cameraOpen = ref(false);
/** The line whose code went into Add equipment; its answer becomes the new item on save. */
const addingFor = ref<{ key: number; seed: AssetFormSeed } | null>(null);
const saving = computed(() => lines.value.some((l) => l.state === "saving"));

function verdictOf(line: Line): AssignVerdict | null {
  if (!line.result) return null;
  // Only the page's own holder offers somewhere else: an "instead" has no "instead" of its own.
  const offer = line.to.id === props.target.id ? partner.value : null;
  return judgeScan(line.result, line.to, types.value, offer);
}

function flash(line: Line) {
  line.flash = true;
  setTimeout(() => (line.flash = false), 900);
}

async function take(raw: string) {
  const code = raw.trim();
  if (!code) return;
  const same = lines.value.find((l) => l.code === code && l.state !== "lookup_failed");
  if (same) return flash(same);
  lines.value = [
    { key: (seq += 1), code, moveId: crypto.randomUUID(), state: "looking", result: null, to: props.target, error: null, flash: false },
    ...lines.value,
  ];
  // The reactive copy, so the answer landing re-renders the line.
  const added = lines.value[0]!;
  try {
    added.result = await resolveScanCode(code);
    added.state = "judged";
  } catch (e) {
    added.state = "lookup_failed";
    added.error = e instanceof Error ? e.message : "Could not look that code up.";
    return;
  }
  // The same item scanned by a second label or by its IMEI is one line, not two moves.
  const assetId = added.result.kind === "asset" ? added.result.asset.id : null;
  const earlier = assetId
    ? lines.value.find((l) => l !== added && l.result?.kind === "asset" && l.result.asset.id === assetId)
    : undefined;
  if (earlier) {
    lines.value = lines.value.filter((l) => l !== added);
    flash(earlier);
  }
}

const scanner = useScanInput({
  enabled: computed(() => props.open && !cameraOpen.value && addingFor.value === null),
  onScan: (code) => void take(code),
});

function onTypedEnd(event: KeyboardEvent) {
  if (event.key === "Tab" && !typed.value.trim()) return;
  event.preventDefault();
  scanner.submit(typed.value);
  typed.value = "";
}

function remove(line: Line) {
  lines.value = lines.value.filter((l) => l !== line);
}

function sendInstead(line: Line, to: AssignTarget) {
  line.to = to;
}

/** Add it: the new item replaces the line's empty answer; "Save and add another" adds more lines. */
function onSaved(asset: AssetDto) {
  const result: ScanResult = { kind: "asset", code: asset.displayNo, asset };
  const line = addingFor.value ? lines.value.find((l) => l.key === addingFor.value!.key) : undefined;
  if (line && line.result?.kind !== "asset") {
    line.result = result;
    line.state = "judged";
    return;
  }
  lines.value = [
    { key: (seq += 1), code: asset.displayNo, moveId: crypto.randomUUID(), state: "judged", result, to: props.target, error: null, flash: false },
    ...lines.value,
  ];
}

const toAssign = computed(() =>
  lines.value.filter((l) => (l.state === "judged" || l.state === "failed") && verdictOf(l)?.kind === "assign"),
);

/** Fixed at the first Confirm and reused by a retry, so a re-sent move keeps the moment it was made. */
let occurredAt: string | null = null;

async function confirm() {
  occurredAt ??= new Date().toISOString();
  const batch = toAssign.value;
  let landed = 0;
  for (const line of batch) {
    const v = verdictOf(line);
    if (v?.kind !== "assign") continue;
    line.state = "saving";
    line.error = null;
    try {
      await move.mutateAsync(assignPayload(line.moveId, v, occurredAt) as AssetMovementInput);
      line.state = "saved";
      landed += 1;
    } catch (e) {
      // The API's own sentence — `IV020` says the truck already carries the one it should, `IV012`
      // that the driver has left. "Could not assign" alone would drop the half that says what to do.
      line.state = "failed";
      line.error = e instanceof Error ? e.message : "Could not assign it.";
    }
  }
  const failed = batch.length - landed;
  if (failed === 0) {
    const where = new Set(batch.map((l) => l.to.id)).size === 1 ? ` ${batch[0]!.to.kind === "driver" ? "given to" : "assigned to"} ${batch[0]!.to.label}` : " assigned";
    toast.success(`${landed} ${landed === 1 ? "item" : "items"}${where}`);
    close();
    return;
  }
  toast.error(`${failed} of ${batch.length} could not be assigned`, "Each one says why. Press Confirm again to retry them.");
}

function close() {
  lines.value = [];
  occurredAt = null;
  cameraOpen.value = false;
  addingFor.value = null;
  emit("close");
}

const confirmLabel = computed(() => {
  const n = toAssign.value.length;
  if (saving.value) return "Saving…";
  if (n === 0) return "Confirm";
  return `${props.target.kind === "driver" ? "Give" : "Assign"} ${n}`;
});

/** One sentence per line, and the tone it is said in. */
function describe(line: Line): { text: string; tone: "ok" | "warn" | "muted" | "danger" } {
  if (line.state === "looking") return { text: "Looking it up…", tone: "muted" };
  if (line.state === "lookup_failed") return { text: line.error ?? "Could not look that code up.", tone: "danger" };
  if (line.state === "saved") return { text: line.to.kind === "driver" ? `Given to ${line.to.label}` : `On ${line.to.label}`, tone: "ok" };
  if (line.state === "failed") return { text: line.error ?? "Could not assign it.", tone: "danger" };
  const v = verdictOf(line);
  if (!v) return { text: "", tone: "muted" };
  switch (v.kind) {
    case "assign": {
      const verb = v.to.kind === "driver" ? `Goes to ${v.to.label}` : `Goes on ${v.to.label}`;
      return v.fromLabel ? { text: `${verb} — moves from ${v.fromLabel}`, tone: "warn" } : { text: verb, tone: "ok" };
    }
    case "here":
      return { text: v.to.kind === "driver" ? `Already with ${v.to.label}` : `Already on ${v.to.label}`, tone: "muted" };
    case "wrong_holder":
      return { text: v.message, tone: "danger" };
    case "retired":
      return { text: "Retired — no longer in use.", tone: "danger" };
    case "new":
    case "refused":
      return { text: v.message, tone: v.kind === "new" ? "warn" : "danger" };
  }
}

function title(line: Line): string {
  if (line.result?.kind === "asset") return `${line.result.asset.displayNo} · ${line.result.asset.name}`;
  return line.code;
}

/** The holder a refused line offers, when it has one. */
function insteadOf(line: Line): AssignTarget | null {
  const v = verdictOf(line);
  return v?.kind === "wrong_holder" ? v.instead : null;
}
function seedOf(line: Line): AssetFormSeed | null {
  const v = verdictOf(line);
  return v?.kind === "new" ? v.seed : null;
}
function insteadLabel(to: AssignTarget): string {
  return to.kind === "driver" ? `Give to ${to.label} instead` : `Put on ${to.label} instead`;
}

const TONE = {
  ok: "text-success-700",
  warn: "font-medium text-warning-700",
  muted: "text-ink-tertiary",
  danger: "font-medium text-danger-700",
} as const;

const heading = computed(() => (props.target.kind === "driver" ? `Give equipment to ${props.target.label}` : `Assign equipment to ${props.target.label}`));
const FORM_ID = "assign-equipment-form";
</script>

<template>
  <SlideOver :open="open" :title="heading" size="lg" @close="close">
    <form :id="FORM_ID" class="space-y-4" @submit.prevent="confirm">
      <div class="rounded-control bg-surface-subtle p-4 ring-1 ring-edge">
        <p class="text-sm font-medium text-ink">Scan each label</p>
        <p class="mt-0.5 text-sm text-ink-secondary">
          {{ target.kind === "driver" ? "Tablets go to drivers." : "Everything except tablets goes on a truck or trailer." }}
          Scan as many as you like, then press {{ target.kind === "driver" ? "Give" : "Assign" }}.
        </p>
        <FormField v-slot="{ id }" label="Or type the code" hint="The code printed under the QR, or the item's number like A-0412." class="mt-3">
          <!-- Stacked on a phone, as the sticker field is (M9c's pass: 105 px beside the button at 390 px). -->
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <BaseInput
              :id="id"
              v-model="typed"
              class="min-w-0 sm:flex-1"
              autocomplete="off"
              autocapitalize="characters"
              data-test="assign-typed"
              @keydown.enter="onTypedEnd"
              @keydown.tab="onTypedEnd"
            />
            <BaseButton type="button" variant="secondary" data-test="assign-camera" @click="cameraOpen = true">
              <AppIcon :icon="ScanIcon" class="size-5" aria-hidden="true" />
              Use the camera
            </BaseButton>
          </div>
        </FormField>
      </div>

      <p v-if="lines.length === 0" class="py-6 text-center text-sm text-ink-tertiary" data-test="assign-empty">
        Nothing scanned yet.
      </p>
      <ul v-else class="divide-y divide-edge-subtle rounded-control ring-1 ring-edge" aria-live="polite" data-test="assign-lines">
        <li
          v-for="line in lines"
          :key="line.key"
          class="flex items-start gap-3 px-3 py-2.5 transition-colors"
          :class="line.flash ? 'bg-warning-50' : ''"
          data-test="assign-line"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-ink">{{ title(line) }}</p>
            <p v-if="line.result?.kind === 'asset'" class="text-xs text-ink-tertiary">{{ line.result.asset.assetTypeName }}</p>
            <p class="mt-0.5 text-sm" :class="TONE[describe(line).tone]">{{ describe(line).text }}</p>
            <template v-if="line.state === 'judged'">
              <BaseButton
                v-if="insteadOf(line)"
                type="button"
                size="sm"
                class="mt-2"
                data-test="assign-instead"
                @click="sendInstead(line, insteadOf(line)!)"
              >
                {{ insteadLabel(insteadOf(line)!) }}
              </BaseButton>
              <BaseButton
                v-if="seedOf(line)"
                type="button"
                size="sm"
                class="mt-2"
                data-test="assign-add"
                @click="addingFor = { key: line.key, seed: seedOf(line)! }"
              >
                Add it
              </BaseButton>
            </template>
          </div>
          <AppIconButton
            v-if="line.state !== 'saving' && line.state !== 'saved'"
            :icon="XMarkIcon"
            label="Take it off the list"
            variant="ghost"
            size="sm"
            @click="remove(line)"
          />
        </li>
      </ul>
    </form>
    <template #footer>
      <div class="flex items-center justify-end gap-3">
        <BaseButton variant="ghost" :disabled="saving" @click="close">Cancel</BaseButton>
        <BaseButton :form="FORM_ID" type="submit" variant="primary" :disabled="saving || toAssign.length === 0" data-test="assign-confirm">
          {{ confirmLabel }}
        </BaseButton>
      </div>
    </template>
    <!-- Inside the drawer's slot, as the sticker field's camera is, so Escape closes the camera and
         not the drawer under it (`BarcodeCamera`'s header). Kept open: a box of straps is many reads. -->
    <BarcodeCamera
      v-if="cameraOpen"
      title="Scan labels"
      hint="Hold each label inside the box. Close when you are done."
      :reader="SCAN_PAGE_READER"
      @read="(text) => void take(text)"
      @close="cameraOpen = false"
    />
    <AssetDrawer
      v-if="addingFor"
      :open="true"
      :initial="addingFor.seed"
      @saved="onSaved"
      @close="addingFor = null"
    />
  </SlideOver>
</template>
