<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { APPLY_TURNSTILE_ACTION } from "@silvicom/shared";
import { CAREERS_COPY } from "./careersCopy";

/**
 * Cloudflare Turnstile on the careers form (APPLY-PAGE-PLAN D-AP5/D-AP6), rendered explicitly
 * (developers.cloudflare.com/turnstile/get-started/client-side-rendering, read 2026-11-20).
 *
 * ── WHAT IT DOES AND DOES NOT DECIDE ────────────────────────────────────────────────────────────
 * It hands the form a token, or null. The server verifies the token, checking hostname and action too, and a missing
 * or failed one FLAGS the application and never refuses it. So nothing here blocks sending: a driver whose browser
 * blocks Cloudflare's script still applies, and the recruiter sees why the lead is quiet (D-AP5).
 *
 * ── THE SCRIPT ──────────────────────────────────────────────────────────────────────────────────
 * Loaded from Cloudflare's own origin, never proxied or bundled: Cloudflare warns that a copy breaks with their next
 * update. The CSP admits exactly that origin (`appHttp.ts` TURNSTILE_ORIGIN). It loads once per page load, and only
 * on a job page whose server holds keys (`turnstileSiteKey` not null).
 *
 * Managed mode and `refresh-expired: auto` are Cloudflare's defaults and stay so. A token lives 300 s, and the widget
 * renews it, so a slow typist is never timed out (D-AP7, "no time limit").
 */
const props = defineProps<{ siteKey: string }>();
const emit = defineEmits<{ token: [value: string | null] }>();

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    script.onerror = () => {
      loading = null;
      reject(new Error("turnstile blocked"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

const box = ref<HTMLElement | null>(null);
const failed = ref(false);
let api: TurnstileApi | null = null;
let widget: string | null = null;

onMounted(async () => {
  try {
    api = await loadTurnstile();
  } catch {
    failed.value = true;
    emit("token", null);
    return;
  }
  if (!box.value) return;
  widget = api.render(box.value, {
    sitekey: props.siteKey,
    action: APPLY_TURNSTILE_ACTION,
    callback: (token: string) => {
      failed.value = false;
      emit("token", token);
    },
    "expired-callback": () => emit("token", null),
    "timeout-callback": () => emit("token", null),
    "error-callback": () => {
      failed.value = true;
      emit("token", null);
      // Handled here: the form still sends, and the server records the check as missing (D-AP5).
      return true;
    },
  });
});

onBeforeUnmount(() => {
  if (api && widget !== null) api.remove(widget);
});

/** A token is spent once the server has seen it; the form asks for a fresh one after any send that did not land. */
function reset(): void {
  emit("token", null);
  if (api && widget !== null) api.reset(widget);
}
defineExpose({ reset });
</script>

<template>
  <div role="group" :aria-label="CAREERS_COPY.form.robotCheck" data-turnstile>
    <p class="text-sm text-ink-muted">{{ CAREERS_COPY.form.robotCheckHint }}</p>
    <div ref="box" class="mt-2 min-h-[65px]" />
    <p v-if="failed" class="mt-2 text-sm text-ink-muted" role="status">{{ CAREERS_COPY.form.robotCheckFailed }}</p>
  </div>
</template>
