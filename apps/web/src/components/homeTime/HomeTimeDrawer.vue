<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  formatNotesParam,
  type HomeTimeChange,
  type HomeTimeMark,
  type HomeTimePeriod,
} from "@silvicom/shared";
import { AppButton as BaseButton, AppCombobox as ComboSelect, AppFormField as FormField, FactList, QueryState, useConfirm, type Fact } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import { BADGE_BASE, toneClass } from "@/lib/badges";
import { formatDateTime } from "@/lib/format";
import { useToastStore } from "@/stores/toast";
import { useNotesAccess } from "@/components/notes/useUnitNotes";
import HomeTimeForm from "./HomeTimeForm.vue";
import { HOME_TIME_END_WORDS, HOME_TIME_STATE_BADGE, HOME_TIME_TRUCK_WORDS, spanWords } from "./homeTimeView";
import { HOME_TIME_NEW, useHomeTimeDrawer } from "./useHomeTimeDrawer";
import {
  useCanMarkHomeTime,
  useCancelHomeTime,
  useChangeHomeTime,
  useEndHomeTime,
  useHomeTimeDrivers,
  useHomeTimeList,
  useMarkHomeTime,
  useReopenHomeTime,
} from "./useHomeTime";

/**
 * One driver's home time (HOME-TIME-PLAN §3.3, D-HT8) — the shared `SlideOver`, mounted ONCE per page
 * and opened by the URL (`useHomeTimeDrawer`), so the truck's drawer, the Home time tab, the driver's
 * page and a pasted link all open the same thing.
 *
 * ── WHAT IT SHOWS ───────────────────────────────────────────────────────────────────────────────
 * - No live period: the form (when, due back, where the truck is). Two clicks from a board row.
 * - A live period: its facts, and what can be done with it — **Back from home time** (one click, ends
 *   it now), **Change** (the same form, on this period), **Truck is back at the yard**, **Cancel**
 *   (asks first; the row stays, signed).
 * - A period that ended: **Reopen**, for the end somebody pressed by mistake or the system made.
 * - `?homeTime=new`: a driver search first, then the same drawer on him.
 *
 * A viewer without the permission to mark (D-HT7) sees the facts and no buttons; the API refuses the
 * writes whatever this shows.
 *
 * No note field (D-HT20): "Notes on this driver" opens the office's notes on him, where a remark
 * belongs and where the driver himself cannot read it.
 */
const props = defineProps<{
  zone: string;
  /** When this driver's truck empties, if it is carrying a load — the form's default "Leaves". */
  leavesHint?: (driverId: string) => string | null;
}>();

const drawer = useHomeTimeDrawer();
const route = useRoute();
const router = useRouter();
const toast = useToastStore();
const ask = useConfirm();
const canMark = useCanMarkHomeTime();
const readsNotes = useNotesAccess();

const open = computed(() => drawer.target.value !== null);
const choosing = computed(() => drawer.target.value === HOME_TIME_NEW);
const driverId = computed(() => (open.value && !choosing.value ? drawer.target.value : null));

const list = useHomeTimeList(open);
const drivers = useHomeTimeDrivers(open);

const option = computed(() => drivers.data.value?.find((d) => d.driverId === driverId.value) ?? null);
/** The driver's live period — the tab's order puts the most pressing first, and he has one. */
const period = computed<HomeTimePeriod | null>(() => list.data.value?.live.find((p) => p.driverId === driverId.value) ?? null);
/** His newest ENDED period, for Reopen. A canceled one was a mistake and stays closed. */
const lastEnded = computed<HomeTimePeriod | null>(() => list.data.value?.recent.find((p) => p.driverId === driverId.value && p.state === "ended") ?? null);
const settings = computed(() => list.data.value?.settings ?? null);

const driverName = computed(() => period.value?.driverName ?? option.value?.driverName ?? lastEnded.value?.driverName ?? null);
const unitNumber = computed(() => period.value?.unitNumber ?? option.value?.unitNumber ?? null);

const changing = ref(false);
watch(() => drawer.target.value, () => (changing.value = false));
/** The form is on screen: a new period for somebody who may mark one, or a change to the live one. */
const formShown = computed(() => canMark.value && !!driverId.value && !!settings.value && (period.value ? changing.value : !!option.value));

const at = (iso: string | null | undefined) => formatDateTime(iso, "—", props.zone);
const title = computed(() => (choosing.value ? "Mark home time" : "Home time"));
const description = computed(() => {
  if (choosing.value) return "Choose the driver who is going home.";
  return [driverName.value, unitNumber.value ? `Truck ${unitNumber.value}` : null].filter(Boolean).join(" · ") || undefined;
});

const driverOptions = computed(() => {
  const home = new Set((list.data.value?.live ?? []).map((p) => p.driverId));
  return (drivers.data.value ?? []).map((d) => ({
    value: d.driverId,
    label: [d.driverName, d.unitNumber ? `Truck ${d.unitNumber}` : null, home.has(d.driverId) ? "home time marked" : null].filter(Boolean).join(" · "),
  }));
});
const chosen = computed({ get: () => "", set: (id: string) => id && drawer.choose(id) });

const facts = computed<Fact[]>(() => {
  const p = period.value;
  if (!p) return [];
  const now = Date.now();
  const back = Date.parse(p.expectedReturnAt);
  const due = p.state === "overdue" ? `${at(p.expectedReturnAt)} — ${spanWords(now - back)} ago` : p.state === "active" ? `${at(p.expectedReturnAt)} — in ${spanWords(back - now)}` : at(p.expectedReturnAt);
  return [
    { label: p.state === "scheduled" ? "Leaves" : "Left", value: at(p.startAt) },
    { label: "Returns", value: due, ...(p.state === "overdue" ? { tone: "text-danger-700" } : {}) },
    { label: "Truck", value: p.disposition === "no_truck" ? HOME_TIME_TRUCK_WORDS.no_truck : `${p.unitNumber ?? "Truck"} — ${HOME_TIME_TRUCK_WORDS[p.disposition].toLowerCase()}` },
    { label: "Marked by", value: p.markedByName ? `${p.markedByName}, ${at(p.createdAt)}` : at(p.createdAt) },
  ];
});

const mark = useMarkHomeTime();
const change = useChangeHomeTime();
const end = useEndHomeTime();
const cancel = useCancelHomeTime();
const reopen = useReopenHomeTime();
const busy = computed(() => mark.isPending.value || change.isPending.value || end.isPending.value || cancel.isPending.value || reopen.isPending.value);

async function run(done: string, failed: string, act: () => Promise<unknown>, after?: () => void): Promise<void> {
  try {
    await act();
    toast.success(done);
    after?.();
  } catch (e) {
    toast.error(failed, e instanceof Error ? e.message : undefined);
  }
}

const onMark = (input: HomeTimeMark) => run("Home time marked", "Could not mark the home time", () => mark.mutateAsync(input), drawer.close);
function onChange(input: HomeTimeChange): void {
  const p = period.value;
  if (!p) return;
  // Nothing moved: close the form and say nothing, as the API would write nothing.
  if (Object.keys(input).length === 0) {
    changing.value = false;
    return;
  }
  void run("Home time changed", "Could not change the home time", () => change.mutateAsync({ id: p.id, change: input }), () => (changing.value = false));
}
const onBack = (p: HomeTimePeriod) => run(`${p.driverName} is back from home time`, "Could not end the home time", () => end.mutateAsync({ id: p.id }), drawer.close);
const onYard = (p: HomeTimePeriod) => run("Truck marked back at the yard", "Could not change the home time", () => change.mutateAsync({ id: p.id, change: { disposition: "at_yard" } }));
const onReopen = (p: HomeTimePeriod) => run("Home time reopened", "Could not reopen the home time", () => reopen.mutateAsync({ id: p.id }));
async function onCancel(p: HomeTimePeriod): Promise<void> {
  const asked = await ask({
    title: `Cancel ${p.driverName}'s home time?`,
    message: "Use this when it was marked by mistake. The record stays, with who canceled it. If the driver is back, use Back from home time instead.",
    confirmLabel: "Cancel home time",
    tone: "danger",
  });
  if (asked) await run("Home time canceled", "Could not cancel the home time", () => cancel.mutateAsync({ id: p.id }), drawer.close);
}

/** The driver's notes, in the notes drawer: one navigation that closes this drawer and opens that one. */
function openNotes(): void {
  if (!driverId.value) return;
  const { homeTime: _h, ...rest } = route.query;
  const { notes, note } = formatNotesParam({ subjects: [{ kind: "driver", id: driverId.value }], noteId: null });
  void router.push({ query: { ...rest, notes, note } });
}
</script>

<template>
  <SlideOver :open="open" :title="title" :description="description" @close="drawer.close()">
    <div v-if="open" class="space-y-6" data-testid="home-time-drawer">
      <QueryState
        compact
        :loading="list.isLoading.value || drivers.isLoading.value"
        :error="list.isError.value ? list.error.value : drivers.isError.value ? drivers.error.value : null"
        :retrying="list.isFetching.value || drivers.isFetching.value"
        loading-text="Loading home time…"
        error-text="Could not load home time."
        @retry="
          list.refetch();
          drivers.refetch();
        "
      >
        <FormField v-if="choosing" v-slot="{ id }" label="Driver">
          <ComboSelect :id="id" v-model="chosen" :options="driverOptions" placeholder="Search a driver or a truck" />
        </FormField>

        <template v-else-if="period">
          <section aria-labelledby="home-time-now-heading" class="space-y-3">
            <div class="flex items-center justify-between gap-2">
              <h3 id="home-time-now-heading" class="text-sm font-semibold text-ink">{{ period.state === "scheduled" ? "Scheduled home time" : "On home time" }}</h3>
              <span :class="[BADGE_BASE, toneClass(HOME_TIME_STATE_BADGE[period.state].tone)]">{{ HOME_TIME_STATE_BADGE[period.state].label }}</span>
            </div>
            <!-- Two columns: the drawer is a phone's width at any screen size, and four squeeze a date onto three lines. -->
            <FactList :facts="facts" :columns="2" data-testid="home-time-facts" />
          </section>

          <HomeTimeForm
            v-if="formShown && settings"
            :key="period.id"
            :period="period"
            :driver-id="period.driverId"
            :vehicle-id="period.vehicleId"
            :unit-number="period.unitNumber"
            :settings="settings"
            :zone="zone"
            @change="onChange"
          />
          <div v-else-if="canMark" class="flex flex-wrap items-center gap-2" data-testid="home-time-actions">
            <BaseButton v-if="period.state !== 'scheduled'" variant="primary" :disabled="busy" @click="onBack(period)">Back from home time</BaseButton>
            <BaseButton variant="secondary" :disabled="busy" @click="changing = true">Change</BaseButton>
            <BaseButton v-if="period.disposition === 'with_driver' && period.state !== 'scheduled'" variant="secondary" :disabled="busy" @click="onYard(period)">
              Truck is back at the yard
            </BaseButton>
            <BaseButton variant="link" :disabled="busy" @click="onCancel(period)">Cancel home time</BaseButton>
          </div>
        </template>

        <template v-else-if="driverId">
          <HomeTimeForm
            v-if="formShown && settings && option"
            :key="option.driverId"
            :driver-id="option.driverId"
            :vehicle-id="option.vehicleId"
            :unit-number="option.unitNumber"
            :last-disposition="option.lastDisposition"
            :leaves-hint="leavesHint?.(option.driverId) ?? null"
            :settings="settings"
            :zone="zone"
            @mark="onMark"
          />
          <p v-else-if="!option && !lastEnded" class="text-sm text-ink-muted">This driver is not on the active roster, and has no home time marked.</p>
          <p v-else-if="!canMark" class="text-sm text-ink-muted">No home time is marked for this driver.</p>

          <section v-if="lastEnded" aria-labelledby="home-time-last-heading" class="space-y-1" data-testid="home-time-last">
            <h3 id="home-time-last-heading" class="text-sm font-semibold text-ink">Last home time</h3>
            <p class="text-sm text-ink">{{ at(lastEnded.startAt) }} to {{ at(lastEnded.endAt) }}</p>
            <p v-if="lastEnded.endReason" class="text-xs text-ink-muted">{{ HOME_TIME_END_WORDS[lastEnded.endReason] }}.</p>
            <BaseButton v-if="canMark" variant="link" :disabled="busy" @click="onReopen(lastEnded)">Reopen it — the driver is still home</BaseButton>
          </section>
        </template>

        <p v-if="driverId && readsNotes" class="text-sm">
          <BaseButton variant="link" data-testid="home-time-notes" @click="openNotes">Notes on {{ driverName ?? "this driver" }}</BaseButton>
        </p>
      </QueryState>
    </div>

    <template v-if="formShown" #footer>
      <div class="flex items-center justify-end gap-2">
        <BaseButton variant="secondary" :disabled="busy" @click="period ? (changing = false) : drawer.close()">Cancel</BaseButton>
        <BaseButton form="home-time-form" type="submit" variant="primary" :disabled="busy">{{ period ? "Save changes" : "Mark home time" }}</BaseButton>
      </div>
    </template>
  </SlideOver>
</template>
