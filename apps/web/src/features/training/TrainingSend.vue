<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { TrainingSendOutcome } from "@silvicom/shared";
import { AppBadge, AppButton, AppCallout, AppCard as BaseCard, AppCheckbox, AppDateField, AppFormField, AppSelect, DataTable, DataWorkspace, FilterBar, TablePagination, useQueryState, type DataTableColumn } from "@silvicom/ui";
import { useDriversQuery } from "@/composables/useDrivers";
import { useToastStore } from "@/stores/toast";
import { formatPhone } from "@/lib/format";
import { useSendTraining, useTrainingCatalogue, useTrainingReach } from "./useTraining";
import { publishedVersion, reachLabel, VIA_LABEL } from "./trainingRows";

/**
 * Safety › Training › Send to drivers (§8.1, D-TR3, D-TR11). The office picks drivers from the roster
 * and a course, and the API decides how each is reached: a text only where a number and a consent
 * cover it (an applicant today), else email, else the office copies the link and sends it itself.
 * Hired drivers are never texted until Q-TR9 (a driver-operations number and a driver consent) lands;
 * when it does, the API's answer changes and this tab with it.
 */
defineProps<{ canManage: boolean }>();
const toast = useToastStore();

const drivers = useDriversQuery();
const PAGE_SIZE = 50;
const qs = useQueryState();
const search = qs.param("search");
const page = qs.page();
watch(search, () => (page.value = 1));
const active = computed(() => (drivers.data.value ?? []).filter((d) => !d.archived_at));
const rows = computed(() => {
  const q = search.value.trim().toLowerCase();
  return active.value.filter((d) => !q || [d.full_name, d.phone, d.employee_id].some((v) => (v ?? "").toLowerCase().includes(q)));
});
const pageRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const selected = ref(new Set<string>());
const picked = computed(() => [...selected.value]);
const reach = useTrainingReach(picked);

const catalogue = useTrainingCatalogue();
const courses = computed(() => (catalogue.data.value ?? []).filter((c) => !c.retiredAt && c.lessons.some((l) => !l.retiredAt && publishedVersion(l))));
const courseId = ref("");
watch(courses, (cs) => {
  if (!courseId.value && cs[0]) courseId.value = cs[0].id;
}, { immediate: true });
const course = computed(() => courses.value.find((c) => c.id === courseId.value) ?? null);
const films = computed(() => (course.value?.lessons ?? []).filter((l) => !l.retiredAt && publishedVersion(l)));
const whole = ref(true);
const chosen = ref(new Set<string>());
watch(courseId, () => {
  whole.value = true;
  chosen.value = new Set();
});
const dueOn = ref<string | null>(null);

const columns: DataTableColumn[] = [
  { key: "full_name", label: "Driver" },
  { key: "phone", label: "Phone" },
  { key: "reach", label: "Can we text?" },
];

const send = useSendTraining();
const sent = ref<Array<TrainingSendOutcome & { name: string }>>([]);
const canSend = computed(() => picked.value.length > 0 && !!course.value && (whole.value || chosen.value.size > 0) && !send.isPending.value);
async function doSend() {
  if (!canSend.value || !course.value) return;
  try {
    const out = await send.mutateAsync({ driverIds: picked.value, courseId: course.value.id, lessonIds: whole.value ? null : [...chosen.value], dueOn: dueOn.value });
    const names = new Map(active.value.map((d) => [d.id, d.full_name]));
    sent.value = out.map((o) => ({ ...o, name: names.get(o.driverId) ?? "Driver" }));
    selected.value = new Set();
    const failed = out.filter((o) => !o.ok).length;
    if (failed) toast.warning(`Sent to ${out.length - failed} of ${out.length}`, "See below for who did not get it.");
    else toast.success(`Training sent to ${out.length} ${out.length === 1 ? "driver" : "drivers"}`);
  } catch (e) {
    toast.error("Training not sent", e instanceof Error ? e.message : undefined);
  }
}
async function copy(link: string) {
  await navigator.clipboard.writeText(link);
  toast.success("Link copied");
}
</script>

<template>
  <div class="space-y-6">
    <AppCallout tone="info" data-test="send-texting-note">
      Texting company drivers is not switched on yet. Our texting number is approved for job applicants only, and drivers have not agreed to
      receive texts. Until that is set up, the link goes by email, or you copy it and send it yourself. Applicants can be texted today.
    </AppCallout>

    <section v-if="sent.length" class="space-y-2" aria-labelledby="send-results" data-test="send-results">
      <h2 id="send-results" class="text-sm font-semibold text-ink">Just sent</h2>
      <ul class="divide-y divide-edge-subtle rounded-surface ring-1 ring-inset ring-edge">
        <li v-for="s in sent" :key="s.assignmentId" class="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
          <span class="min-w-0">
            <span class="font-medium text-ink">{{ s.name }}</span>
            <span class="block text-xs text-ink-tertiary">{{ s.ok ? VIA_LABEL[s.via] : (s.detail ?? "Not sent") }}</span>
          </span>
          <span v-if="s.link" class="flex items-center gap-2">
            <code class="max-w-xs truncate font-mono text-xs text-ink-secondary">{{ s.link }}</code>
            <AppButton size="sm" :data-test="`send-copy-${s.driverId}`" @click="copy(s.link)">Copy link</AppButton>
          </span>
          <AppBadge v-else :tone="s.ok ? 'success' : 'danger'">{{ s.ok ? "Sent" : "Not sent" }}</AppBadge>
        </li>
      </ul>
      <p class="text-xs text-ink-tertiary">A copied link opens only this driver's training. Send it to them yourself, by text from your own phone or by message.</p>
    </section>

    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <DataWorkspace>
        <FilterBar v-model:search="search" embedded search-placeholder="Search name, phone or employee number…" :count="rows.length" count-label="drivers" :active-count="search.trim() ? 1 : 0" @clear-all="qs.set({ search: undefined })" />
        <DataTable
          v-model:selected="selected"
          :columns="columns"
          :rows="pageRows"
          embedded
          row-key="id"
          :selectable="canManage"
          :loading="drivers.isLoading.value"
          :error="drivers.isError.value ? 'Could not load the drivers.' : null"
          :retrying="drivers.isFetching.value"
          @retry="drivers.refetch()"
        >
          <template #empty><p>No driver matches.</p></template>
          <template #cell-full_name="{ value }"><span class="font-medium text-ink">{{ value }}</span></template>
          <template #cell-phone="{ value }"><span class="text-ink-secondary">{{ value ? formatPhone(value) : "—" }}</span></template>
          <template #cell-reach="{ row }">
            <template v-if="selected.has(row.id)">
              <span class="block text-ink">{{ reachLabel(reach.data.value?.[row.id]).label }}</span>
              <span v-if="reachLabel(reach.data.value?.[row.id]).detail" class="block text-xs text-ink-tertiary">{{ reachLabel(reach.data.value?.[row.id]).detail }}</span>
            </template>
            <span v-else class="text-ink-tertiary">Pick to check</span>
          </template>
          <template #footer>
            <TablePagination :page="page" :page-size="PAGE_SIZE" :total="rows.length" :loading="drivers.isFetching.value" @update:page="page = $event" />
          </template>
        </DataTable>
      </DataWorkspace>

      <BaseCard v-if="canManage" class="space-y-4 self-start">
        <h2 class="text-sm font-semibold text-ink">Send training</h2>
        <p v-if="!courses.length" class="text-sm text-ink-secondary">No course has a published video yet. Publish one under Videos first.</p>
        <template v-else>
          <AppFormField v-slot="{ id }" label="Course" required>
            <AppSelect :id="id" v-model="courseId" :options="courses.map((c) => ({ value: c.id, label: c.title }))" data-test="send-course" />
          </AppFormField>
          <fieldset class="space-y-2">
            <legend class="text-sm font-medium text-ink">What to watch</legend>
            <AppCheckbox v-model="whole" :label="`The whole course (${films.length} ${films.length === 1 ? 'video' : 'videos'})`" data-test="send-whole" />
            <div v-if="!whole" class="space-y-1 pl-6">
              <p class="text-xs text-ink-tertiary">Or pick single videos, for retraining after an event.</p>
              <AppCheckbox
                v-for="f in films"
                :key="f.id"
                :model-value="chosen.has(f.id)"
                :label="f.title"
                @update:model-value="(v: boolean) => { const n = new Set(chosen); v ? n.add(f.id) : n.delete(f.id); chosen = n; }"
              />
            </div>
          </fieldset>
          <AppFormField v-slot="{ id }" label="Finish by" hint="Optional. Shown to the driver, and late ones are marked on Progress.">
            <AppDateField :id="id" v-model="dueOn" data-test="send-due" />
          </AppFormField>
          <p class="text-sm text-ink-secondary" data-test="send-summary">
            {{ picked.length ? `${picked.length} ${picked.length === 1 ? "driver" : "drivers"} picked.` : "No driver picked." }}
          </p>
          <AppButton variant="primary" class="w-full" :disabled="!canSend" data-test="send-go" @click="doSend">{{ send.isPending.value ? "Sending…" : "Send" }}</AppButton>
        </template>
      </BaseCard>
    </div>
  </div>
</template>
