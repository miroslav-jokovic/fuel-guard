<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { publishBlockers, type TrainingChapter, type TrainingLessonSummary, type TrainingQuestionView } from "@silvicom/shared";
import { AppBadge, AppButton, AppCallout, AppInput, useConfirm } from "@silvicom/ui";
import SlideOver from "@/components/SlideOver.vue";
import FileDropzone from "@/components/ui/FileDropzone.vue";
import { useToastStore } from "@/stores/toast";
import TrainingQuestionDialog from "./TrainingQuestionDialog.vue";
import {
  useDeleteQuestion,
  usePublishVersion,
  useTrainingPreview,
  useTrainingQuestions,
  useUpdateVersion,
  useUploadFilm,
  useWithdrawVersion,
} from "./useTraining";
import { clock, parseClock, VERSION_STATE, withChapter, workingVersion } from "./trainingRows";

/**
 * One film, start to published (§8.3, D-TR5): upload the MP4 (a new version each time), let the
 * worker make the phone versions, mark chapters while watching it, write the questions, publish.
 * A published version is frozen (0648's triggers); changing it means uploading a new one, and drivers
 * who passed the old one keep that record, which names it.
 */
const props = defineProps<{ film: TrainingLessonSummary | null; courseTitle: string; canManage: boolean }>();
const emit = defineEmits<{ close: [] }>();
const toast = useToastStore();
const ask = useConfirm();

const version = computed(() => (props.film ? workingVersion(props.film) : null));
const versionId = computed(() => version.value?.id ?? null);
const editable = computed(() => props.canManage && !!version.value && version.value.state !== "published" && version.value.state !== "withdrawn");
const watchable = computed(() => !!version.value && ["ready", "published", "withdrawn"].includes(version.value.state));
const preview = useTrainingPreview(versionId, watchable);
const questions = useTrainingQuestions(versionId);

// ── upload ─────────────────────────────────────────────────────────────────────────────────────
const upload = useUploadFilm();
async function onFiles(files: File[]) {
  const file = files[0];
  if (!file || !props.film) return;
  try {
    await upload.mutateAsync({ lessonId: props.film.id, file });
    toast.success("Video uploaded", "It is being prepared for phones. This takes a minute or two.");
  } catch (e) {
    toast.error("Video not uploaded", e instanceof Error ? e.message : undefined);
  }
}

// ── chapters ───────────────────────────────────────────────────────────────────────────────────
const player = ref<HTMLVideoElement | null>(null);
const chapters = ref<TrainingChapter[]>([]);
watch(version, (v) => (chapters.value = v ? [...v.chapters] : []), { immediate: true });
const dirty = computed(() => JSON.stringify(chapters.value) !== JSON.stringify(version.value?.chapters ?? []));
const markTitle = ref("");
const markAt = ref("");
function markHere() {
  if (player.value) markAt.value = clock(player.value.currentTime * 1000);
}
const markMs = computed(() => parseClock(markAt.value));
function addMark() {
  if (markMs.value === null || !markTitle.value.trim()) return;
  chapters.value = withChapter(chapters.value, { title: markTitle.value.trim(), startMs: markMs.value });
  markTitle.value = "";
  markAt.value = "";
}
function seek(ms: number) {
  if (player.value) player.value.currentTime = ms / 1000;
}
const updateVersion = useUpdateVersion();
async function saveChapters() {
  if (!versionId.value) return;
  try {
    await updateVersion.mutateAsync({ id: versionId.value, chapters: chapters.value });
    toast.success("Chapters saved");
  } catch (e) {
    toast.error("Chapters not saved", e instanceof Error ? e.message : undefined);
  }
}

// ── questions ──────────────────────────────────────────────────────────────────────────────────
const editing = ref<{ question: TrainingQuestionView | null } | null>(null);
const removeQuestion = useDeleteQuestion();
const chapterTitle = (i: number) => version.value?.chapters[i]?.title ?? "Whole video";
async function remove(q: TrainingQuestionView) {
  if (!versionId.value) return;
  if (!(await ask({ title: "Remove this question?", message: q.prompt, confirmLabel: "Remove", tone: "danger" }))) return;
  try {
    await removeQuestion.mutateAsync({ versionId: versionId.value, id: q.id });
  } catch (e) {
    toast.error("Question not removed", e instanceof Error ? e.message : undefined);
  }
}

// ── publish ────────────────────────────────────────────────────────────────────────────────────
const blockers = computed(() => (version.value ? publishBlockers(version.value) : []));
const live = computed(() => props.film?.versions.find((v) => v.state === "published") ?? null);
const publish = usePublishVersion();
const withdraw = useWithdrawVersion();
async function doPublish() {
  const v = version.value;
  if (!v || blockers.value.length) return;
  const replacing = live.value && live.value.id !== v.id;
  const ok = await ask({
    title: `Publish version ${v.versionNo}?`,
    message: replacing
      ? `Drivers sent this video from now on watch version ${v.versionNo}. Version ${live.value!.versionNo} is withdrawn; anyone who passed it keeps that record. It cannot be changed once published.`
      : "Drivers sent this course can watch it from now on. It cannot be changed once published: a change is a new upload.",
    confirmLabel: "Publish",
  });
  if (!ok) return;
  try {
    await publish.mutateAsync(v.id);
    toast.success("Video published");
  } catch (e) {
    toast.error("Video not published", e instanceof Error ? e.message : undefined);
  }
}
async function doWithdraw() {
  const v = live.value;
  if (!v) return;
  const ok = await ask({ title: "Withdraw this video?", message: "Drivers stop seeing it. Records of who watched and passed it are kept.", confirmLabel: "Withdraw", tone: "danger" });
  if (!ok) return;
  try {
    await withdraw.mutateAsync(v.id);
    toast.success("Video withdrawn");
  } catch (e) {
    toast.error("Video not withdrawn", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <SlideOver :open="film !== null" size="xl" :title="film?.title ?? ''" :description="courseTitle" @close="emit('close')">
    <div v-if="film" class="space-y-8">
      <section class="space-y-3" aria-labelledby="film-video">
        <div class="flex items-center justify-between gap-3">
          <h3 id="film-video" class="text-sm font-semibold text-ink">1. The video</h3>
          <AppBadge v-if="version" :tone="VERSION_STATE[version.state].tone" data-test="film-state">v{{ version.versionNo }} · {{ VERSION_STATE[version.state].label }}</AppBadge>
        </div>
        <AppCallout v-if="version?.state === 'failed'" tone="danger">{{ version.processError ?? "The video could not be prepared for phones." }} Upload it again, exported as an MP4.</AppCallout>
        <p v-if="version?.state === 'processing'" class="text-sm text-ink-secondary">Making the small, normal and sharp versions for phones, and the picture for the list. This page updates by itself.</p>
        <!-- A workaround, labelled: no film has captions yet (plan §8.6 step 6; captions_path is never filled), and
             this player exists only so the office can find where chapters start. The caption track goes in when the
             preview API returns a captions URL, and this exception comes out with it. -->
        <!-- eslint-disable-next-line vuejs-accessibility/media-has-caption -->
        <video v-if="preview.data.value" ref="player" :src="preview.data.value.url" :poster="version?.posterUrl ?? undefined" controls preload="metadata" class="w-full rounded-surface bg-surface-inverse" data-test="film-preview" />
        <FileDropzone
          v-if="canManage"
          accept="video/mp4,.mp4"
          :busy="upload.isPending.value"
          busy-label="Uploading…"
          :label="version ? 'Upload a new version (MP4)' : 'Upload the finished film (MP4)'"
          hint="Up to 100 MB. It goes to our own storage, never public. A new upload becomes the next version; the published one stays until you publish the new one."
          @files="onFiles"
        />
      </section>

      <section v-if="version" class="space-y-3" aria-labelledby="film-chapters">
        <h3 id="film-chapters" class="text-sm font-semibold text-ink">2. Chapters</h3>
        <p class="text-xs text-ink-tertiary">A driver who misses a question watches its chapter again. Play the video, pause where a chapter starts, then mark it.</p>
        <ol class="divide-y divide-edge-subtle rounded-surface ring-1 ring-inset ring-edge" data-test="film-chapter-list">
          <li v-if="!chapters.length" class="px-3 py-2 text-sm text-ink-tertiary">No chapters yet: the whole video is one.</li>
          <li v-for="(c, i) in chapters" :key="c.startMs" class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <AppButton size="sm" variant="ghost" :disabled="!preview.data.value" @click="seek(c.startMs)">{{ i + 1 }}. {{ c.title }}</AppButton>
            <span class="flex items-center gap-2">
              <span class="tabular-nums text-ink-secondary">{{ clock(c.startMs) }}</span>
              <AppButton v-if="editable" size="sm" variant="ghost" @click="chapters = chapters.filter((x) => x !== c)">Remove</AppButton>
            </span>
          </li>
        </ol>
        <div v-if="editable" class="flex flex-wrap items-end gap-2">
          <AppInput v-model="markTitle" aria-label="Chapter title" placeholder="Chapter title" maxlength="80" class="min-w-48 flex-1" data-test="chapter-title" />
          <AppInput v-model="markAt" aria-label="Starts at (m:ss)" placeholder="0:00" class="w-20" data-test="chapter-at" />
          <AppButton :disabled="!preview.data.value" @click="markHere">Here</AppButton>
          <AppButton :disabled="markMs === null || !markTitle.trim()" data-test="chapter-add" @click="addMark">Add chapter</AppButton>
          <AppButton v-if="dirty" variant="primary" :disabled="updateVersion.isPending.value" data-test="chapters-save" @click="saveChapters">Save chapters</AppButton>
        </div>
      </section>

      <section v-if="version" class="space-y-3" aria-labelledby="film-questions">
        <div class="flex items-center justify-between gap-3">
          <h3 id="film-questions" class="text-sm font-semibold text-ink">3. Quiz questions</h3>
          <AppButton v-if="editable" size="sm" data-test="question-new" @click="editing = { question: null }">Add a question</AppButton>
        </div>
        <p class="text-xs text-ink-tertiary">Each driver gets {{ version.serveCount }} drawn from this list and passes with {{ version.passCount }} right. Write more than {{ version.serveCount }}, so a driver who takes it again gets different ones.</p>
        <ul class="divide-y divide-edge-subtle rounded-surface ring-1 ring-inset ring-edge" data-test="film-question-list">
          <li v-if="!(questions.data.value ?? []).length" class="px-3 py-2 text-sm text-ink-tertiary">No questions yet.</li>
          <li v-for="q in questions.data.value ?? []" :key="q.id" class="flex items-start justify-between gap-3 px-3 py-2 text-sm">
            <span class="min-w-0">
              <span class="block text-ink">{{ q.prompt }}</span>
              <span class="block text-xs text-ink-tertiary">Right: {{ q.choices[q.answerIndex] }} · Chapter {{ q.chapter + 1 }}, {{ chapterTitle(q.chapter) }}</span>
            </span>
            <span v-if="editable" class="flex shrink-0 gap-1">
              <AppButton size="sm" variant="ghost" @click="editing = { question: q }">Edit</AppButton>
              <AppButton size="sm" variant="ghost" @click="remove(q)">Remove</AppButton>
            </span>
          </li>
        </ul>
      </section>

      <section v-if="version && canManage" class="space-y-3" aria-labelledby="film-publish">
        <h3 id="film-publish" class="text-sm font-semibold text-ink">4. Publish</h3>
        <ul v-if="blockers.length && version.state !== 'published'" class="list-disc space-y-1 pl-5 text-sm text-ink-secondary" data-test="publish-blockers">
          <li v-for="b in blockers" :key="b">{{ b }}</li>
        </ul>
        <p v-if="version.state === 'published'" class="text-sm text-ink-secondary">Version {{ version.versionNo }} is what drivers watch. To change it, upload a new version.</p>
      </section>
    </div>
    <template #footer>
      <AppButton v-if="canManage && live" data-test="film-withdraw" @click="doWithdraw">Withdraw</AppButton>
      <AppButton v-if="canManage && version && version.state !== 'published'" variant="primary" :disabled="blockers.length > 0 || publish.isPending.value" data-test="film-publish" @click="doPublish">Publish version {{ version.versionNo }}</AppButton>
    </template>
  </SlideOver>

  <TrainingQuestionDialog v-if="versionId" :open="editing !== null" :version-id="versionId" :chapters="version?.chapters ?? []" :question="editing?.question ?? null" @close="editing = null" />
</template>
