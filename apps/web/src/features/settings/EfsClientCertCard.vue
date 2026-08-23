<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { AppIcon } from "@fuelguard/ui";
import { CheckCircleIcon, ExclamationTriangleIcon, InformationCircleIcon } from "@fuelguard/ui/icons";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { AppInput as BaseInput } from "@fuelguard/ui";
import { AppTextarea } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import { useToastStore } from "@/stores/toast";
import {
  expiryTone,
  useActivateClientCert,
  useClientCerts,
  useRollbackClientCert,
  useTestClientCert,
  useUploadClientCert,
  useWithdrawClientCert,
  type CertTestResult,
  type ClientCertSummary,
} from "./useEfsClientCert";

/**
 * EFS client certificate (mutual TLS) — admin card.
 *
 * The UI mirrors the safety model of the API rather than hiding it, because the safe sequence is the
 * whole point: upload stages a certificate, Test proves it against the live EFS endpoint, Activate
 * switches over, Roll back undoes it. An operator who follows the buttons in order cannot take the
 * fuel feed down, and one who has already done so is one click from recovery.
 *
 * The private key field is write-only. It is never populated from the server (the server has no
 * endpoint that would return it) and is cleared from local state the moment the upload succeeds.
 */

const certs = useClientCerts();
const upload = useUploadClientCert();
const test = useTestClientCert();
const activate = useActivateClientCert();
const rollback = useRollbackClientCert();
const withdraw = useWithdrawClientCert();
const toast = useToastStore();

const form = reactive({ certPem: "", keyPem: "", passphrase: "", caPem: "" });
const showForm = ref(false);
const warnings = ref<string[]>([]);
const testResult = ref<CertTestResult | null>(null);

const active = computed(() => certs.data.value?.active ?? null);
const pending = computed(() => certs.data.value?.pending ?? null);
const history = computed(() => certs.data.value?.history ?? []);
const canRollback = computed(() => history.value.some((c) => c.activatedAt));

function clearForm(): void {
  form.certPem = "";
  form.keyPem = "";
  form.passphrase = "";
  form.caPem = "";
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
}

function expiryLabel(cert: ClientCertSummary): string {
  if (cert.expiryState === "expired") return `Expired ${fmtDate(cert.notAfter)}`;
  if (cert.expiryState === "not_yet_valid") return `Not valid until ${fmtDate(cert.notBefore)}`;
  return `Expires ${fmtDate(cert.notAfter)} (${cert.daysUntilExpiry} days)`;
}

const toneClass = (cert: ClientCertSummary): string =>
  ({ ok: "text-success-600", warn: "text-caution-700", bad: "text-danger-600" })[expiryTone(cert)];

async function onUpload(): Promise<void> {
  warnings.value = [];
  testResult.value = null;
  if (!form.certPem.trim() || !form.keyPem.trim()) {
    toast.error("Missing input", "Paste both the certificate and its private key.");
    return;
  }
  try {
    const result = await upload.mutateAsync({
      certPem: form.certPem,
      keyPem: form.keyPem,
      ...(form.passphrase ? { passphrase: form.passphrase } : {}),
      ...(form.caPem.trim() ? { caPem: form.caPem } : {}),
    });
    warnings.value = result.warnings;
    clearForm(); // the key must not linger in browser memory a moment longer than needed
    showForm.value = false;
    toast.success("Certificate staged", "It is not presenting yet — test it against EFS, then activate.");
  } catch (e) {
    toast.error("Certificate rejected", e instanceof Error ? e.message : undefined);
  }
}

async function onTest(): Promise<void> {
  testResult.value = await test.mutateAsync();
  if (testResult.value.kind === "success") {
    toast.success("EFS accepted the staged certificate", `Roundtrip ${testResult.value.roundtripMs} ms`);
  } else {
    toast.error("EFS rejected the staged certificate", testResult.value.message);
  }
}

async function onActivate(): Promise<void> {
  try {
    await activate.mutateAsync();
    testResult.value = null;
    toast.success("Certificate activated", "It is presented from the next EFS call onward.");
  } catch (e) {
    toast.error("Activation failed", e instanceof Error ? e.message : undefined);
  }
}

async function onRollback(): Promise<void> {
  try {
    const r = await rollback.mutateAsync();
    toast.success("Rolled back", `Restored ${r.restored.subject}.`);
  } catch (e) {
    toast.error("Rollback failed", e instanceof Error ? e.message : undefined);
  }
}

async function onWithdraw(): Promise<void> {
  try {
    const r = await withdraw.mutateAsync();
    toast.info("Client certificate withdrawn", `Transport is now: ${r.tls}`);
  } catch (e) {
    toast.error("Withdrawal failed", e instanceof Error ? e.message : undefined);
  }
}
</script>

<template>
  <BaseCard as="section">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h3 class="text-base font-semibold text-ink">Client certificate (mutual TLS)</h3>
        <p class="mt-1 text-xs text-ink-muted">
          Only needed if EFS requires a client certificate on their endpoint. Without one, calls use
          ordinary TLS and everything works as before. The private key is encrypted before it is
          stored and is never returned to this page.
        </p>
      </div>
      <BaseButton v-if="!showForm" size="sm" @click="showForm = true">
        {{ active ? "Replace" : "Install" }}
      </BaseButton>
    </div>

    <!-- ── Currently presenting ─────────────────────────────────────────────── -->
    <div v-if="active" class="mt-4 rounded-control bg-surface-subtle p-3">
      <div class="flex items-start gap-2">
        <AppIcon :icon="CheckCircleIcon" class="size-5 shrink-0 text-success-500" />
        <div class="min-w-0 text-sm">
          <p class="font-medium text-ink">Presenting to EFS</p>
          <p class="mt-0.5 break-all text-ink-muted">{{ active.subject }}</p>
          <p class="text-xs text-ink-muted">Issued by {{ active.issuer }} · {{ active.keyType }}</p>
          <p class="mt-1 text-xs" :class="toneClass(active)">{{ expiryLabel(active) }}</p>
          <p class="mt-1 break-all font-mono text-xs text-ink-muted">
            SHA-256 {{ active.fingerprintSha256 }}
          </p>
          <p v-if="active.lastHandshakeAt" class="mt-1 text-xs" :class="active.lastHandshakeOk ? 'text-success-600' : 'text-danger-600'">
            Last handshake {{ active.lastHandshakeOk ? "succeeded" : "FAILED" }}
            {{ new Date(active.lastHandshakeAt).toLocaleString() }}
            <span v-if="active.lastHandshakeError"> — {{ active.lastHandshakeError }}</span>
          </p>
        </div>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <BaseButton v-if="canRollback" size="sm" :disabled="rollback.isPending.value" @click="onRollback">
          Roll back to previous
        </BaseButton>
        <BaseButton size="sm" variant="danger" :disabled="withdraw.isPending.value" @click="onWithdraw">
          Withdraw
        </BaseButton>
      </div>
    </div>
    <p v-else class="mt-4 text-sm text-ink-muted">
      No client certificate installed — EFS calls use ordinary TLS.
    </p>

    <!-- ── Staged, awaiting test + activation ───────────────────────────────── -->
    <div v-if="pending" class="mt-4 rounded-control border border-caution-300 bg-caution-50 p-3">
      <div class="flex items-start gap-2">
        <AppIcon :icon="InformationCircleIcon" class="size-5 shrink-0 text-caution-600" />
        <div class="min-w-0 text-sm">
          <p class="font-medium text-ink">Staged — not presenting yet</p>
          <p class="mt-0.5 break-all text-ink-muted">{{ pending.subject }}</p>
          <p class="mt-1 text-xs" :class="toneClass(pending)">{{ expiryLabel(pending) }}</p>
          <p class="mt-1 break-all font-mono text-xs text-ink-muted">
            SHA-256 {{ pending.fingerprintSha256 }}
          </p>
          <p class="mt-2 text-xs text-ink-muted">
            If EFS enrols certificates on their side, send them this fingerprint <em>before</em> activating —
            an unenrolled certificate is the usual cause of a rejected handshake.
          </p>
        </div>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <BaseButton size="sm" :disabled="test.isPending.value" @click="onTest">
          {{ test.isPending.value ? "Testing…" : "Test against EFS" }}
        </BaseButton>
        <BaseButton
          size="sm"
          variant="primary"
          :disabled="activate.isPending.value || testResult?.kind !== 'success'"
          @click="onActivate"
        >
          Activate
        </BaseButton>
        <span v-if="testResult" class="text-xs" :class="testResult.kind === 'success' ? 'text-success-600' : 'text-danger-600'">
          {{ testResult.kind === "success" ? `EFS accepted it (${testResult.roundtripMs} ms)` : testResult.message }}
        </span>
        <span v-else class="text-xs text-ink-muted">Test first — activation stays disabled until EFS accepts it.</span>
      </div>
    </div>

    <ul v-if="warnings.length" class="mt-3 space-y-1">
      <li v-for="w in warnings" :key="w" class="flex items-start gap-1.5 text-xs text-caution-700">
        <AppIcon :icon="ExclamationTriangleIcon" class="mt-0.5 size-3.5 shrink-0" />
        <span>{{ w }}</span>
      </li>
    </ul>

    <!-- ── Upload form ──────────────────────────────────────────────────────── -->
    <form v-if="showForm" class="mt-4 space-y-3 border-t border-edge pt-4" @submit.prevent="onUpload">
      <FormField v-slot="{ id }" label="Certificate (PEM)" hint="Leaf first, then any intermediates. Begins with -----BEGIN CERTIFICATE-----">
        <AppTextarea
          :id="id"
          v-model="form.certPem"
          rows="5"
          spellcheck="false"
          class="font-mono text-xs"
          placeholder="-----BEGIN CERTIFICATE-----&#10;…"
        />
      </FormField>
      <FormField v-slot="{ id }" label="Private key (PEM)" hint="Sent once, encrypted before storage, never shown again.">
        <AppTextarea
          :id="id"
          v-model="form.keyPem"
          rows="5"
          spellcheck="false"
          class="font-mono text-xs"
          placeholder="-----BEGIN PRIVATE KEY-----&#10;…"
        />
      </FormField>
      <FormField v-slot="{ id }" label="Key passphrase" hint="Only if the private key is encrypted.">
        <BaseInput :id="id" v-model="form.passphrase" type="password" autocomplete="off" />
      </FormField>
      <FormField
        v-slot="{ id }"
        label="CA bundle (optional)"
        hint="Only if EFS's own certificate is signed by a private root your server doesn't already trust."
      >
        <AppTextarea
          :id="id"
          v-model="form.caPem"
          rows="3"
          spellcheck="false"
          class="font-mono text-xs"
        />
      </FormField>
      <div class="flex gap-2">
        <BaseButton type="submit" variant="primary" size="sm" :disabled="upload.isPending.value">
          {{ upload.isPending.value ? "Validating…" : "Stage certificate" }}
        </BaseButton>
        <BaseButton size="sm" @click="showForm = false; clearForm()">Cancel</BaseButton>
      </div>
      <p class="text-xs text-ink-muted">
        Staging validates the pair locally — key matches certificate, not expired, permits client
        authentication — and stores it without switching over. Nothing changes until you activate.
      </p>
    </form>

    <!-- ── History ──────────────────────────────────────────────────────────── -->
    <details v-if="history.length" class="mt-4">
      <summary class="cursor-pointer text-xs text-ink-muted">Previous certificates ({{ history.length }})</summary>
      <ul class="mt-2 space-y-1.5">
        <li v-for="c in history" :key="c.id" class="text-xs text-ink-muted">
          <span class="break-all">{{ c.subject }}</span> ·
          {{ fmtDate(c.activatedAt) }} → {{ fmtDate(c.retiredAt) }}
          <span v-if="c.retiredReason"> ({{ c.retiredReason.replace(/_/g, " ") }})</span>
        </li>
      </ul>
    </details>
  </BaseCard>
</template>
