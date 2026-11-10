<script setup lang="ts">
import { ref } from "vue";
import type { UnlockCodeChannel } from "@silvicom/shared";
import ApplyDate from "@/features/apply/ApplyDate.vue";
import {
  AppButton as BaseButton,
  AppCard as BaseCard,
  AppFormField as FormField,
  AppInput as BaseInput,
} from "@silvicom/ui";
import { unlockApplicationDraft, type ApplyDraft, type Released } from "./useApplication";
import { requestUnlockCode, unlockWithCode } from "./unlockCode";
import { applyLanguage } from "./language";
import { APPLY_COPY } from "./strings";

/**
 * One question, before a saved application is read back to whoever is holding the link (A2, D-APP16).
 *
 * ⚠ The link alone is not enough once the draft contains a date of birth. An application link arrives
 * by email — forwarded, scanned by a mail gateway, opened on a phone somebody else is holding — and
 * the answers behind it are a date of birth, a licence number and an employment history. So the
 * server withholds the body and this asks for the one thing the applicant knows and a stranger with
 * the link does not.
 *
 * A wrong answer costs nothing but another try: there is no lockout, because the failure mode of a
 * lockout here is a driver who cannot reach their own application at 5am in a truck stop.
 *
 * ⚠ Except on a link the office SENT for signing (D-AW14, C3s3a): the driver is in the office, the link
 * travelled by text, and the date of birth is on the CDL they photographed — so the server counts, this
 * says how many tries are left, and the fifth wrong answer stops the link (410 `sign_link_locked`), after
 * which there is nothing to type and the screen says to ask for it again.
 *
 * ⚠ **And when the date on file is wrong, a code (F0b, APPLICATION-FIX-PLAN).** A typo or a misread
 * barcode in Part 1 means the driver's own right answer never matches; once one answer has failed, the
 * screen offers a code sent to the invitation's email, or by text when they agreed to texts. The page
 * names a channel and never an address — the server sends it where the link went — and a right code
 * releases what the date of birth would. The office is told the date did not match.
 *
 * Split out of `ApplyPage.vue` on 2026-09-11 (the 500-line budget), and it owns its own flags rather
 * than reporting them upward — the page needs the payload, not the attempt.
 */
const props = defineProps<{ token: string; carrier: string }>();
const emit = defineEmits<{ unlocked: [released: Released] }>();

const dateOfBirth = ref("");
const failed = ref(false);
const working = ref(false);
/** Tries left on a sent sign link; null on every other link, which says nothing about tries. */
const attemptsLeft = ref<number | null>(null);
const stopped = ref(false);

// ── F0b: the code ──
const code = ref("");
/** What the last "send me a code" said, in the driver's words, or null before one was asked for. */
const codeNote = ref<string | null>(null);
const codeSent = ref(false);
const codeRefused = ref(false);
const codeWorking = ref(false);

function released(draft: ApplyDraft): void {
  emit("unlocked", { payload: draft.payload ?? {}, partOne: draft.partOne ?? null, revision: draft.revision });
}

async function sendCode(channel: UnlockCodeChannel): Promise<void> {
  const copy = APPLY_COPY.unlock;
  codeWorking.value = true;
  codeRefused.value = false;
  try {
    const answer = await requestUnlockCode(props.token, channel, applyLanguage.value);
    if (answer.outcome === "sent") {
      codeSent.value = true;
      codeNote.value = copy.codeSent(answer.to, answer.expiresInMinutes);
    } else codeNote.value = copy.codeHeld[answer.held];
  } catch (e) {
    const status = (e as { code?: string }).code;
    if (status === "sign_link_locked") stopped.value = true;
    else codeNote.value = status === "too_many_requests" ? copy.codeTooMany : copy.codeFailed;
  } finally {
    codeWorking.value = false;
  }
}

async function useCode(): Promise<void> {
  if (!code.value.trim()) return;
  codeWorking.value = true;
  codeRefused.value = false;
  try {
    released((await unlockWithCode(props.token, code.value)).draft);
  } catch (e) {
    if ((e as { code?: string }).code === "sign_link_locked") stopped.value = true;
    else codeRefused.value = true;
  } finally {
    codeWorking.value = false;
  }
}

async function unlock(): Promise<void> {
  if (!dateOfBirth.value) return;
  working.value = true;
  failed.value = false;
  try {
    const res = await unlockApplicationDraft(props.token, dateOfBirth.value);
    if (res.draft.locked) {
      failed.value = true;
      attemptsLeft.value = res.draft.attemptsLeft ?? null;
    } else released(res.draft);
  } catch (e) {
    if ((e as { code?: string }).code === "sign_link_locked") stopped.value = true;
    else failed.value = true;
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <BaseCard v-if="stopped">
    <h1 class="text-lg font-semibold text-ink">{{ APPLY_COPY.unlock.heading }}</h1>
    <p class="mt-2 text-sm text-ink-muted" role="alert">{{ APPLY_COPY.unlock.lockedOut(carrier) }}</p>
  </BaseCard>
  <BaseCard v-else>
    <h1 class="text-lg font-semibold text-ink">{{ APPLY_COPY.unlock.heading }}</h1>
    <p class="mt-2 text-sm text-ink-muted">{{ APPLY_COPY.unlock.body(carrier) }}</p>
    <div class="mt-4 max-w-xs">
      <FormField v-slot="{ id }" :label="APPLY_COPY.unlock.label">
        <ApplyDate :id="id" v-model="dateOfBirth" kind="dob" autocomplete="bday" />
      </FormField>
    </div>
    <p v-if="failed" class="mt-2 text-sm text-ink-secondary" role="alert">
      {{ attemptsLeft === null ? APPLY_COPY.unlock.failed : APPLY_COPY.unlock.attemptsLeft(attemptsLeft) }}
    </p>
    <div class="mt-6 flex justify-end">
      <BaseButton variant="primary" :disabled="working || !dateOfBirth" @click="unlock">
        {{ working ? APPLY_COPY.unlock.checking : APPLY_COPY.unlock.action }}
      </BaseButton>
    </div>

    <!-- F0b: offered once a date of birth has failed — before that the date is the way in. -->
    <section v-if="failed" class="mt-6 border-t border-edge pt-4" data-unlock-code>
      <p class="text-sm text-ink-muted">{{ APPLY_COPY.unlock.codeOffer }}</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <BaseButton size="touch" :disabled="codeWorking" @click="sendCode('email')">{{ APPLY_COPY.unlock.codeByEmail }}</BaseButton>
        <BaseButton size="touch" variant="ghost" :disabled="codeWorking" @click="sendCode('sms')">{{ APPLY_COPY.unlock.codeByText }}</BaseButton>
      </div>
      <p v-if="codeNote" class="mt-2 text-sm text-ink-secondary" role="status">{{ codeNote }}</p>
      <div v-if="codeSent" class="mt-4 max-w-xs">
        <FormField v-slot="{ id }" :label="APPLY_COPY.unlock.codeLabel">
          <BaseInput :id="id" v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="9" />
        </FormField>
        <p v-if="codeRefused" class="mt-2 text-sm text-ink-secondary" role="alert">{{ APPLY_COPY.unlock.codeRefused }}</p>
        <div class="mt-4 flex justify-end">
          <BaseButton variant="primary" :disabled="codeWorking || !code.trim()" @click="useCode">
            {{ codeWorking ? APPLY_COPY.unlock.checking : APPLY_COPY.unlock.codeAction }}
          </BaseButton>
        </div>
      </div>
    </section>
  </BaseCard>
</template>
