<script setup lang="ts">
import { computed, reactive } from "vue";
import { orientationVideoCreateSchema, type OrientationVideo } from "@silvicom/shared";
import {
  AppButton as BaseButton,
  AppCheckbox,
  AppFormField as FormField,
  AppInput as BaseInput,
  QueryState,
  useConfirm,
} from "@silvicom/ui";
import { useSessionStore } from "@/stores/session";
import { useToastStore } from "@/stores/toast";
import {
  useAddOrientationVideo,
  useOrientationVideos,
  useUpdateOrientationVideo,
} from "@/features/recruitment/useOrientationVideos";

/**
 * Settings → Recruiting's orientation videos (HW8a, 0538; HIRING-WORKFLOW-AUDIT-2026-10-31 §4.8).
 *
 * A list of LINKS — the carrier's own videos wherever they live (YouTube, Vimeo, a drive) — not files:
 * §8.2's first version is "a link list and an attestation tick". Each is required unless the office says
 * otherwise; the applicant's step is done when every required one is ticked as watched.
 *
 * ⚠ No "edit the link". 0538 refuses it (OV011): the applicant's tick names the videos, and a link that
 * moved would move what they said they watched. A new link is removed and added again — the copy says so.
 * Removing RETIRES the video (OV010): it leaves the list and every tick that named it still reads true.
 *
 * Q-WF8 (which videos exist) is the owner's, so the list ships empty and says what to do.
 *
 * Writes on `session.can("recruitment")`, what the api's POST and PATCH ask.
 */
const session = useSessionStore();
const toast = useToastStore();
const ask = useConfirm();
const canManage = computed(() => session.can("recruitment"));
const videosQ = useOrientationVideos();
const add = useAddOrientationVideo();
const update = useUpdateOrientationVideo();

const form = reactive({ title: "", url: "", minutes: "", required: true });
const candidate = computed(() => ({
  title: form.title,
  url: form.url,
  minutes: form.minutes.trim() === "" ? null : Number(form.minutes),
  required: form.required,
}));
const parsed = computed(() => orientationVideoCreateSchema.safeParse(candidate.value));
const touched = computed(() => form.title.trim() !== "" || form.url.trim() !== "");
const errorFor = (field: string) =>
  touched.value && !parsed.value.success
    ? parsed.value.error.issues.find((i) => i.path[0] === field)?.message
    : undefined;

async function submit(): Promise<void> {
  if (!parsed.value.success) return;
  try {
    await add.mutateAsync(parsed.value.data);
    Object.assign(form, { title: "", url: "", minutes: "", required: true });
    toast.success("Video added");
  } catch (e) {
    toast.error("Could not add the video", e instanceof Error ? e.message : undefined);
  }
}

async function setRequired(video: OrientationVideo, required: boolean): Promise<void> {
  try {
    await update.mutateAsync({ id: video.id, patch: { required } });
  } catch (e) {
    toast.error("Could not change the video", e instanceof Error ? e.message : undefined);
  }
}

async function remove(video: OrientationVideo): Promise<void> {
  const yes = await ask({
    title: `Remove “${video.title}”?`,
    message: "It leaves the list. Drivers who already said they watched it keep that on their record.",
    confirmLabel: "Remove",
    tone: "danger",
  });
  if (!yes) return;
  try {
    await update.mutateAsync({ id: video.id, patch: { retire: true } });
    toast.success("Video removed");
  } catch (e) {
    toast.error("Could not remove the video", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <div class="space-y-4" data-testid="orientation-videos-editor">
    <QueryState
      :loading="videosQ.isLoading.value"
      :error="videosQ.isError.value ? videosQ.error.value : null"
      error-text="Could not load the orientation videos."
      :retrying="videosQ.isFetching.value"
      loading-text="Loading the orientation videos…"
      compact
      @retry="videosQ.refetch()"
    >
      <p v-if="(videosQ.data.value ?? []).length === 0" class="text-xs text-ink-secondary" data-testid="no-videos">
        No videos yet. Add a link to each orientation video your drivers should watch before they come in.
      </p>
      <ul v-else class="divide-y divide-edge">
        <li v-for="video in videosQ.data.value" :key="video.id" class="flex items-start justify-between gap-4 py-2">
          <div class="min-w-0">
            <a :href="video.url" target="_blank" rel="noopener noreferrer" class="text-sm font-medium text-link hover:text-link-hover">
              {{ video.title }}
            </a>
            <p class="text-xs text-ink-muted">
              {{ video.minutes ? `${video.minutes} min · ` : "" }}{{ video.required ? "Required" : "Optional" }}
            </p>
          </div>
          <div v-if="canManage" class="flex shrink-0 items-center gap-3">
            <AppCheckbox
              :model-value="video.required"
              label="Required"
              :disabled="update.isPending.value"
              @update:model-value="(v: boolean) => setRequired(video, v)"
            />
            <BaseButton size="sm" variant="ghost" :disabled="update.isPending.value" @click="remove(video)">Remove</BaseButton>
          </div>
        </li>
      </ul>

      <div v-if="canManage" class="space-y-3 border-t border-edge pt-4" data-testid="add-video">
        <h3 class="text-sm font-semibold text-ink">Add a video</h3>
        <FormField v-slot="{ id }" label="Title" :error="errorFor('title')">
          <BaseInput :id="id" v-model="form.title" />
        </FormField>
        <FormField v-slot="{ id }" label="Link" hint="The video's full address, starting with https://. To change a link later, remove the video and add it again." :error="errorFor('url')">
          <BaseInput :id="id" v-model="form.url" type="url" inputmode="url" />
        </FormField>
        <FormField v-slot="{ id }" label="Minutes" hint="Optional. Shown to the driver beside the title.">
          <BaseInput :id="id" v-model="form.minutes" type="number" min="1" max="600" inputmode="numeric" class="max-w-32" />
        </FormField>
        <AppCheckbox v-model="form.required" label="Required — the step is done when every required video is watched" />
        <BaseButton variant="primary" size="sm" :disabled="!parsed.success || add.isPending.value" @click="submit">
          {{ add.isPending.value ? "Adding…" : "Add the video" }}
        </BaseButton>
      </div>
    </QueryState>
  </div>
</template>
