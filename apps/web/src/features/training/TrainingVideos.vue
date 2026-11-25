<script setup lang="ts">
import { computed, ref } from "vue";
import type { TrainingCourseSummary, TrainingLessonSummary } from "@silvicom/shared";
import { AppBadge, AppButton, AppCard as BaseCard, AppFormField, AppInput, BaseModal, DataTable, DIALOG_FOOTER_CLASS, QueryState, useQueryState, type DataTableColumn } from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import TrainingFilmDrawer from "./TrainingFilmDrawer.vue";
import { useCreateCourse, useCreateLesson, useTrainingCatalogue } from "./useTraining";
import { clock, publishedVersion, VERSION_STATE, workingVersion } from "./trainingRows";

/**
 * Safety › Training › Videos (§8.3): each course, its films in order, and where each film stands.
 * Adding a film is four steps on one page (D-TR5): name it, upload the MP4, mark chapters, write
 * questions, publish — the drawer does the last four. The open film is in the URL (`?film=`).
 */
defineProps<{ canManage: boolean }>();
const qs = useQueryState();
const filmId = qs.param("film");
const toast = useToastStore();

const catalogue = useTrainingCatalogue();
const courses = computed(() => (catalogue.data.value ?? []).filter((c) => !c.retiredAt));
const openFilm = computed<TrainingLessonSummary | null>(() => {
  for (const c of courses.value) for (const l of c.lessons) if (l.id === filmId.value) return l;
  return null;
});
const openCourse = computed<TrainingCourseSummary | null>(() => courses.value.find((c) => c.lessons.some((l) => l.id === filmId.value)) ?? null);

const columns: DataTableColumn[] = [
  { key: "title", label: "Video" },
  { key: "length", label: "Length", numeric: true },
  { key: "chapters", label: "Chapters", numeric: true },
  { key: "questions", label: "Questions", numeric: true },
  { key: "version", label: "Version" },
  { key: "state", label: "State" },
];
const rowsOf = (c: TrainingCourseSummary) =>
  c.lessons
    .filter((l) => !l.retiredAt)
    .map((l, i) => {
      const w = workingVersion(l);
      const live = publishedVersion(l);
      return { id: l.id, n: i + 1, title: l.title, w, live, length: clock(w?.durationMs), chapters: w?.chapters.length ?? 0, questions: w?.questionCount ?? 0 };
    });
const courseLine = (c: TrainingCourseSummary) => {
  const live = c.lessons.filter((l) => !l.retiredAt).map(publishedVersion).filter((v) => v !== null);
  const minutes = Math.round(live.reduce((t, v) => t + (v.durationMs ?? 0), 0) / 60000);
  return `${live.length} published ${live.length === 1 ? "video" : "videos"}, about ${minutes} min`;
};

// ── new course / new video ───────────────────────────────────────────────────────────────────
const dialog = ref<{ kind: "course" } | { kind: "film"; courseId: string } | null>(null);
const title = ref("");
const createCourse = useCreateCourse();
const createLesson = useCreateLesson();
const saving = computed(() => createCourse.isPending.value || createLesson.isPending.value);
function open(d: NonNullable<typeof dialog.value>) {
  title.value = "";
  dialog.value = d;
}
async function save() {
  const d = dialog.value;
  if (!d || !title.value.trim()) return;
  try {
    if (d.kind === "course") {
      await createCourse.mutateAsync({ title: title.value.trim(), description: null });
      toast.success("Course added");
    } else {
      const { id } = await createLesson.mutateAsync({ courseId: d.courseId, title: title.value.trim() });
      filmId.value = id; // straight on to uploading it
    }
    dialog.value = null;
  } catch (e) {
    toast.error(d.kind === "course" ? "Course not added" : "Video not added", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <QueryState :loading="catalogue.isLoading.value" :error="catalogue.error.value" error-text="Could not load the training videos." :retrying="catalogue.isFetching.value" @retry="catalogue.refetch()">
    <div class="space-y-6">
      <div v-if="canManage" class="flex justify-end">
        <AppButton data-test="training-new-course" @click="open({ kind: 'course' })">New course</AppButton>
      </div>
      <p v-if="!courses.length" class="text-sm text-ink-secondary" data-test="training-empty">
        No training yet.{{ canManage ? " Add a course, then add its videos one at a time." : "" }}
      </p>
      <section v-for="c in courses" :key="c.id" class="space-y-2" :data-test="`training-course-${c.id}`">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold text-ink">{{ c.title }}</h2>
            <p class="text-xs text-ink-tertiary">{{ courseLine(c) }}</p>
          </div>
          <AppButton v-if="canManage" variant="primary" size="sm" :data-test="`training-add-video-${c.id}`" @click="open({ kind: 'film', courseId: c.id })">Add video</AppButton>
        </div>
        <BaseCard padding="none">
          <DataTable :columns="columns" :rows="rowsOf(c)" embedded row-key="id" @row-click="(row) => (filmId = row.id)">
            <template #empty><p>No videos in this course yet.</p></template>
            <template #cell-title="{ row }">
              <span class="flex items-center gap-3">
                <img v-if="row.w?.posterUrl" :src="row.w.posterUrl" alt="" width="64" height="36" class="h-9 w-16 shrink-0 rounded-detail object-cover" loading="lazy" />
                <span v-else class="h-9 w-16 shrink-0 rounded-detail bg-surface-subtle" />
                <span class="font-medium text-ink">{{ row.n }}. {{ row.title }}</span>
              </span>
            </template>
            <template #cell-version="{ row }">
              <span class="text-ink-secondary">{{ row.w ? `v${row.w.versionNo}` : "—" }}</span>
              <span v-if="row.live && row.w && row.live.id !== row.w.id" class="block text-xs text-ink-tertiary">v{{ row.live.versionNo }} is live</span>
            </template>
            <template #cell-state="{ row }">
              <AppBadge v-if="row.w" :tone="VERSION_STATE[row.w.state].tone">{{ VERSION_STATE[row.w.state].label }}</AppBadge>
              <AppBadge v-else tone="neutral">No video uploaded</AppBadge>
            </template>
          </DataTable>
        </BaseCard>
      </section>
    </div>
  </QueryState>

  <TrainingFilmDrawer :film="openFilm" :course-title="openCourse?.title ?? ''" :can-manage="canManage" @close="filmId = ''" />

  <BaseModal :open="dialog !== null" :title="dialog?.kind === 'course' ? 'New course' : 'Add a video'" @close="dialog = null">
    <form class="space-y-4" @submit.prevent="save">
      <AppFormField v-slot="{ id }" :label="dialog?.kind === 'course' ? 'Course name' : 'Video title'" :hint="dialog?.kind === 'course' ? 'For example: Defensive driving, Act I.' : 'As drivers will see it, for example: Following distance.'" required>
        <AppInput :id="id" v-model="title" maxlength="120" data-test="training-title" />
      </AppFormField>
      <div :class="DIALOG_FOOTER_CLASS">
        <AppButton @click="dialog = null">Cancel</AppButton>
        <AppButton variant="primary" type="submit" :disabled="!title.trim() || saving" data-test="training-title-save">{{ dialog?.kind === "course" ? "Add course" : "Add and upload" }}</AppButton>
      </div>
    </form>
  </BaseModal>
</template>
