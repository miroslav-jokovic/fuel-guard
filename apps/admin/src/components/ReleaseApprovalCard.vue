<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { AppBadge, AppButton, AppCallout, AppCard, AppInput } from "@silvicom/ui";
import { apiGet, apiPost, ApiRequestError, type ReleaseApproval, type ReleaseState } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";

/**
 * Tonight's release, approved from here instead of GitHub (RELEASE-TRAIN-PLAN D-REL14, 0440).
 *
 * The release PR is still GitHub's; this card reads it through admin-api and records the owner's
 * yes, which release.yml reads at 01:07 CT. Approving asks for the authenticator code on the spot:
 * the API wants a second factor from the last five minutes, and "sign out and sign in again" is
 * not something anyone does at bedtime.
 */
const session = useSessionStore();
const state = ref<ReleaseState | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const code = ref("");
const busy = ref(false);

const candidate = computed(() => state.value?.candidate ?? null);
/** The approval that ships tonight: the newest live one, if it is for the commit the notes describe. */
const current = computed<ReleaseApproval | null>(() => {
  const a = state.value?.approvals[0];
  return a && a.commitSha === candidate.value?.shipsSha ? a : null;
});
/** A live approval of an OLDER commit: the 18:00 refresh moved the notes on since it was given. */
const outdated = computed(() => !current.value && (state.value?.approvals.length ?? 0) > 0);
const short = (sha: string) => sha.slice(0, 7);

/** The PR body is markdown; the notes use three shapes of line, so they are drawn as three, never as HTML. */
const noteLines = computed(() =>
  (candidate.value?.notes ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const text = l.replace(/^- /, "").replace(/\*\*/g, "").replace(/`/g, "");
      return { kind: l.startsWith("- ") ? "item" : /^\*\*[^*]+\*\*/.test(l) ? "heading" : "text", text };
    }),
);

function explain(e: unknown, fallback: string): string {
  if (e instanceof ApiRequestError) {
    if (e.code === "step_up_required") return "The authenticator code was not accepted in time. Enter a new one and retry.";
    if (e.code === "stale") return "Tonight's release changed since this page loaded. Read it again below, then approve.";
    if (e.status === 403) return "Only the platform owner can approve a release.";
    if (e.detail) return e.detail;
  }
  return e instanceof Error && e.message ? e.message : fallback;
}

async function load() {
  try {
    state.value = await apiGet<ReleaseState>("/admin/release");
    error.value = null;
  } catch {
    // apiGet's error carries only a status; GitHub not answering (502) is the usual cause.
    error.value = "Could not load tonight's release. GitHub or the console's API did not answer; try again shortly.";
  } finally {
    loading.value = false;
  }
}
onMounted(load);

/** A fresh second factor, proved here: the token's amr gains a new TOTP time, which the API checks. */
async function proveSecondFactor() {
  const { data, error: listErr } = await supabase.auth.mfa.listFactors();
  if (listErr) throw listErr;
  const factor = (data?.totp ?? []).find((f) => f.status === "verified");
  if (!factor) throw new Error("No authenticator is set up on this account");
  const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.value.trim() });
  if (vErr) throw new Error("That code is not right — check the authenticator and try again");
  await session.refresh();
}

async function act(path: "approve" | "revoke") {
  const c = candidate.value;
  if (!c) return;
  busy.value = true;
  error.value = null;
  try {
    await proveSecondFactor();
    const body = path === "approve" ? { prNumber: c.number, commitSha: c.shipsSha } : { prNumber: c.number };
    await apiPost(`/admin/release/${path}`, body);
    code.value = "";
  } catch (e) {
    error.value = explain(e, path === "approve" ? "Could not approve the release" : "Could not withdraw the approval");
  } finally {
    busy.value = false;
    await load();
  }
}
</script>

<template>
  <AppCard>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-base font-semibold text-ink">Tonight's release</h2>
      <AppBadge v-if="current" tone="success">Approved — ships at 01:07 CT</AppBadge>
      <AppBadge v-else-if="candidate" tone="warning">Waiting for approval</AppBadge>
    </div>
    <p class="mt-1 text-sm text-ink-secondary">
      Production updates once a night, Sunday to Thursday at 01:07 CT, with the release approved here or on GitHub.
      Without an approval nothing ships and the work waits for the next night.
    </p>

    <div v-if="loading" class="mt-4 text-sm text-ink-muted">Loading…</div>
    <p v-else-if="!candidate && !error" class="mt-4 text-sm text-ink-secondary">
      Nothing is waiting: production already runs everything that has been merged.
    </p>

    <template v-else-if="candidate">
      <p class="mt-4 text-sm text-ink">
        <a :href="candidate.url" target="_blank" rel="noopener" class="font-medium text-brand-700 underline">
          Release #{{ candidate.number }}
        </a>
        · ships commit <span class="font-mono tabular-nums">{{ short(candidate.shipsSha) }}</span>
        · notes updated {{ fmtDateTime(candidate.updatedAt) }}
      </p>

      <AppCallout v-if="!candidate.pinnedByNotes" tone="caution" class="mt-3">
        These notes were written before the console could approve. Approving ships main as it is now, which can
        include changes merged after the notes. Tonight's 18:00 refresh fixes this.
      </AppCallout>
      <AppCallout v-if="!state?.canApprove" tone="info" class="mt-3">
        This is the staging console. Approve in the production console; an approval here would not reach the release.
      </AppCallout>
      <AppCallout v-if="outdated" tone="caution" class="mt-3">
        You approved {{ short(state!.approvals[0]!.commitSha) }}, but the notes have moved on to
        {{ short(candidate.shipsSha) }}. Tonight ships {{ short(state!.approvals[0]!.commitSha) }} unless you approve again.
      </AppCallout>

      <div class="mt-4 max-h-80 overflow-y-auto rounded-md border border-edge-subtle p-3 text-sm">
        <template v-for="(l, i) in noteLines" :key="i">
          <p v-if="l.kind === 'heading'" class="mt-2 font-semibold text-ink first:mt-0">{{ l.text }}</p>
          <p v-else-if="l.kind === 'item'" class="ml-4 text-ink-secondary">• {{ l.text }}</p>
          <p v-else class="mt-2 text-ink-secondary first:mt-0">{{ l.text }}</p>
        </template>
      </div>

      <p v-if="current" class="mt-4 text-sm text-ink">
        Approved by {{ current.approvedBy ?? "a former owner" }} at {{ fmtDateTime(current.approvedAt) }}.
      </p>

      <form v-if="state?.canApprove" class="mt-4 flex flex-wrap items-end gap-3" @submit.prevent="act(current ? 'revoke' : 'approve')">
        <label class="w-44 text-sm">
          <span class="mb-1 block text-xs font-medium text-ink-secondary">Authenticator code</span>
          <AppInput v-model="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" />
        </label>
        <AppButton type="submit" :variant="current ? 'secondary' : 'primary'" :disabled="busy || code.trim().length < 6">
          {{ busy ? "Working…" : current ? "Withdraw approval" : "Approve tonight's release" }}
        </AppButton>
      </form>
    </template>

    <p v-if="error" class="mt-3 text-sm text-danger-600" role="alert">{{ error }}</p>
  </AppCard>
</template>
