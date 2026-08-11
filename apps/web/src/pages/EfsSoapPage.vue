<script setup lang="ts">
import { AppIcon } from "@fuelguard/ui";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@fuelguard/ui/icons";
import { computed, reactive, ref, watch } from "vue";
import {
  useDisableEfsSoap,
  useEfsSoapStatus,
  useEnableEfsSoap,
  useTestEfsSoapConnection,
  type EfsSoapEnvironment,
  type EfsSoapFeedStatus,
  type TestConnectionResult,
} from "@/features/settings/useEfsSoap";
import { useToastStore } from "@/stores/toast";
import { AppButton as BaseButton } from "@fuelguard/ui";
import { AppCard as BaseCard } from "@fuelguard/ui";
import { AppInput as BaseInput } from "@fuelguard/ui";
import { AppFormField as FormField } from "@fuelguard/ui";
import PageHeader from "@/components/ui/PageHeader.vue";
import { AppSelect, type SelectOption } from "@fuelguard/ui";
import JobActionCard from "@/features/jobs/JobActionCard.vue";
import EfsClientCertCard from "@/features/settings/EfsClientCertCard.vue";

/**
 * EFS SOAP integration — admin settings page.
 *
 * The Vue side of the phase-10 SOAP integration: view configuration, upsert/rotate credentials,
 * enable/disable polling, probe the connection, and trigger a manual sync per feed. All server
 * writes go through /api/integrations/efs-soap/* endpoints (which are admin-only + audited).
 *
 * State handling:
 *   1. Loading — spinner.
 *   2. Not configured — show the setup form, hide the feed cards. The credentials must exist
 *      before test-connection or sync-now do anything useful.
 *   3. Configured but disabled — show a "Not enabled" banner + the form (as "Rotate credentials")
 *      + an "Enable polling" flow. Feed cards are hidden.
 *   4. Configured + enabled but the SOAP client is pre-WSDL — the test-connection button surfaces
 *      "Waiting on EFS WSDL" instead of a red error; feed sync buttons still work (they gracefully
 *      no-op with status=not_implemented).
 *   5. Fully live — everything works. Feed cards show freshness via useJob under the hood.
 */

const status = useEfsSoapStatus();
const enable = useEnableEfsSoap();
const disable = useDisableEfsSoap();
const testConn = useTestEfsSoapConnection();
const toast = useToastStore();

const envOptions: SelectOption[] = [
  { value: "sandbox", label: "Sandbox" },
  { value: "production", label: "Production" },
];

// Local form state. Kept separate from the config query so the user can edit without losing input
// on refetch. Password is intentionally NEVER prefilled from the server (the server does not return
// it, ever) — the field is empty on load, and empty on rotate means "keep the current password".
const form = reactive({
  environment: "sandbox" as EfsSoapEnvironment,
  endpointUrl: "",
  soapUsername: "",
  soapPassword: "",
  accountId: "",
});

const fieldErr = ref<Record<string, string>>({});
const testResult = ref<TestConnectionResult | null>(null);
const lastTestAt = ref<string | null>(null);

// Prefill non-secret fields from the config once it loads (endpoint, environment, account, username
// prefix). Password stays blank — the server never sends it back.
watch(
  () => status.data.value,
  (cfg) => {
    if (!cfg) return;
    if (cfg.environment) form.environment = cfg.environment;
    if (cfg.endpointUrl) form.endpointUrl = cfg.endpointUrl;
    if (cfg.accountId) form.accountId = cfg.accountId;
  },
  { immediate: true },
);

const isConfigured = computed(() => status.data.value?.configured === true);
const isEnabled = computed(() => status.data.value?.enabled === true);

/** State that drives which card/banner is shown at the top of the page. */
const overallState = computed<"loading" | "not_configured" | "disabled" | "enabled">(() => {
  if (status.isLoading.value && !status.data.value) return "loading";
  if (!isConfigured.value) return "not_configured";
  if (!isEnabled.value) return "disabled";
  return "enabled";
});

function validate(): boolean {
  const errs: Record<string, string> = {};
  const endpoint = form.endpointUrl.trim();
  if (!endpoint) errs.endpointUrl = "Endpoint URL is required";
  else if (!/^https?:\/\//i.test(endpoint)) errs.endpointUrl = "Must be an http(s) URL";
  // WEX hands out the WSDL URL — `…/CardManagementWS?wsdl` — because that is what you open in a
  // browser to read the contract. It is NOT the endpoint. The value saved here is used verbatim as
  // the POST target for every SOAP call (checkOutboundUrl normalises through `new URL().toString()`,
  // which keeps the query string), so a stored `?wsdl` makes every request ask Axis2 for the contract
  // document and get back XML that is not a response. It fails on the first call as a parse error,
  // which reads as "the vendor is broken" rather than "we typed the wrong URL".
  else if (/[?&]wsdl\b/i.test(endpoint)) {
    errs.endpointUrl = `Remove the "?wsdl" — that is the contract document, not the endpoint. Use ${endpoint.split("?")[0]}`;
  }
  if (!form.soapUsername.trim()) errs.soapUsername = "SOAP username is required";
  if (!form.soapPassword.trim()) errs.soapPassword = "SOAP password is required";
  fieldErr.value = errs;
  return Object.keys(errs).length === 0;
}

async function onSaveAndEnable() {
  if (!validate()) return;
  try {
    await enable.mutateAsync({
      environment: form.environment,
      endpointUrl: form.endpointUrl.trim(),
      soapUsername: form.soapUsername.trim(),
      soapPassword: form.soapPassword,
      accountId: form.accountId.trim() || null,
    });
    toast.success("EFS SOAP credentials saved", "Polling is enabled.");
    form.soapPassword = ""; // clear the field so it isn't left in the DOM
  } catch (e) {
    toast.error("Could not save credentials", e instanceof Error ? e.message : undefined);
  }
}

async function onDisable() {
  const ok = window.confirm(
    "Disable the EFS SOAP polling and wipe the stored password? You will need to re-enter the password to re-enable.",
  );
  if (!ok) return;
  try {
    await disable.mutateAsync();
    toast.info("EFS SOAP disabled", "Polling stopped and the stored password was cleared.");
  } catch (e) {
    toast.error("Could not disable", e instanceof Error ? e.message : undefined);
  }
}

async function onTestConnection() {
  testResult.value = null;
  try {
    const result = await testConn.mutateAsync();
    testResult.value = result;
    lastTestAt.value = new Date().toISOString();
    if (result.kind === "success") {
      toast.success("Connected", `Roundtrip ${result.roundtripMs} ms`);
    } else if (result.kind === "not_implemented") {
      toast.info("Waiting on EFS WSDL", "Client is ready; endpoint operations are stubbed until data release.");
    }
  } catch (e) {
    testResult.value = { kind: "failure", message: e instanceof Error ? e.message : "Test failed" };
    toast.error("Test connection failed", e instanceof Error ? e.message : undefined);
    lastTestAt.value = new Date().toISOString();
  }
}

/** Freshness label for a per-feed status card. */
function feedFreshness(f: EfsSoapFeedStatus): { label: string; warn: boolean } {
  if (!f.lastPolledAt) return { label: "Never polled yet.", warn: false };
  const mins = Math.round((Date.now() - new Date(f.lastPolledAt).getTime()) / 60_000);
  const ago = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)}h ago`;
  if (f.lastError) return { label: `Last poll ${ago} — error: ${f.lastError.slice(0, 200)}`, warn: true };
  const success = f.lastSuccessAt
    ? ` (last success ${Math.round((Date.now() - new Date(f.lastSuccessAt).getTime()) / 60_000)} min ago)`
    : "";
  const pending = f.processingPending
    ? ` ${f.processingPending} batch${f.processingPending === 1 ? "" : "es"} awaiting scoring/alerts.`
    : "";
  const processingError = f.processingLastError ? ` Processing error: ${f.processingLastError.slice(0, 160)}` : "";
  return { label: `Last polled ${ago}${success}.${pending}${processingError}`, warn: Boolean(f.processingLastError) };
}

const postedFreshness = computed(() =>
  status.data.value ? feedFreshness(status.data.value.posted) : null,
);
const rejectedFreshness = computed(() =>
  status.data.value ? feedFreshness(status.data.value.rejected) : null,
);

const testChipClass = computed(() => {
  if (!testResult.value) return "text-ink-muted";
  if (testResult.value.kind === "success") return "text-success-600";
  if (testResult.value.kind === "not_implemented") return "text-caution-700";
  return "text-danger-600";
});
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-6">
    <PageHeader>
      EFS SOAP integration — the direct webservice link that delivers posted transactions and
      rejected authorization attempts into FuelGuard. One credential set covers both feeds. See
      <code class="rounded-control bg-surface-muted px-1 py-0.5 text-xs">docs/plans/EFS-SOAP-INTEGRATION-PLAN.md</code>
      for the full plan and the list of items still awaiting EFS's data release.
    </PageHeader>

    <!-- ── Loading ────────────────────────────────────────────────────────────── -->
    <div v-if="overallState === 'loading'" class="text-sm text-ink-muted">Loading configuration…</div>

    <template v-else>
      <!-- ── Overall state banner ─────────────────────────────────────────────── -->
      <BaseCard>
        <div class="flex items-start gap-3">
          <template v-if="overallState === 'enabled'">
            <AppIcon :icon="CheckCircleIcon" class="size-6 shrink-0 text-success-500" />
            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-ink">Enabled</h3>
              <p class="mt-1 text-sm text-ink-muted">
                Polling both feeds. Environment: <span class="font-medium text-ink">{{ status.data.value?.environment }}</span> ·
                Endpoint: <span class="break-all font-mono text-xs text-ink">{{ status.data.value?.endpointUrl }}</span>
                <span v-if="status.data.value?.accountId"> · Account: {{ status.data.value.accountId }}</span>
              </p>
            </div>
          </template>
          <template v-else-if="overallState === 'disabled'">
            <AppIcon :icon="ExclamationTriangleIcon" class="size-6 shrink-0 text-caution-500" />
            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-ink">Configured but not enabled</h3>
              <p class="mt-1 text-sm text-ink-muted">
                Credentials are stored, but polling is off. Either the org's <code class="text-xs">enabled</code>
                flag is false OR the platform kill switch <code class="text-xs">EFS_SOAP_ENABLED</code> is not
                set to <code class="text-xs">true</code> in the deploy env. Both must be on for polling to run.
              </p>
            </div>
          </template>
          <template v-else>
            <AppIcon :icon="InformationCircleIcon" class="size-6 shrink-0 text-brand-500" />
            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-ink">Not configured</h3>
              <p class="mt-1 text-sm text-ink-muted">
                Enter the SOAP endpoint URL, username, and password provided by EFS at data release,
                then click <em>Save &amp; enable</em>. Nothing is stored — and no calls are made — until you do.
              </p>
            </div>
          </template>
        </div>
      </BaseCard>

      <!-- ── Credentials form ─────────────────────────────────────────────────── -->
      <BaseCard as="section">
        <h3 class="text-base font-semibold text-ink">
          {{ isConfigured ? "Rotate credentials" : "Enter credentials" }}
        </h3>
        <p class="mt-1 text-xs text-ink-muted">
          The password is stored encrypted at rest (service-role only) and is NEVER returned to the
          browser. To keep the existing password unchanged when rotating other fields, you must
          still re-enter it — an empty password field is treated as an invalid input.
        </p>

        <div class="mt-4 space-y-4">
          <FormField v-slot="{ id }" label="Environment">
            <div :id="id">
              <AppSelect v-model="form.environment" :options="envOptions" />
            </div>
          </FormField>

          <!--
            Labelled "(WSDL)" until 2026-08-11, which invited the one mistake this field cannot
            survive: WEX's onboarding email hands you `…/CardManagementWS?wsdl`, and pasting that
            verbatim makes every SOAP call ask for the contract document instead of sending a request.
          -->
          <FormField
            v-slot="{ id }"
            label="SOAP endpoint URL"
            hint="The service address, not the ?wsdl document WEX links in their email."
            :error="fieldErr.endpointUrl"
          >
            <BaseInput
              :id="id"
              v-model="form.endpointUrl"
              placeholder="https://ws.efsllc.com/axis2/services/CardManagementWS/"
              autocomplete="off"
              spellcheck="false"
              :invalid="Boolean(fieldErr.endpointUrl)"
            />
          </FormField>

          <FormField v-slot="{ id }" label="SOAP username" :error="fieldErr.soapUsername">
            <BaseInput
              :id="id"
              v-model="form.soapUsername"
              autocomplete="off"
              spellcheck="false"
              :invalid="Boolean(fieldErr.soapUsername)"
            />
          </FormField>

          <FormField
            v-slot="{ id }"
            label="SOAP password"
            hint="Never displayed after saving. Re-enter to rotate."
            :error="fieldErr.soapPassword"
          >
            <BaseInput
              :id="id"
              v-model="form.soapPassword"
              type="password"
              autocomplete="new-password"
              :invalid="Boolean(fieldErr.soapPassword)"
            />
          </FormField>

          <FormField
            v-slot="{ id }"
            label="EFS account ID (optional)"
            hint="Silvicom's EFS account number, if EFS scopes calls by it."
          >
            <BaseInput :id="id" v-model="form.accountId" autocomplete="off" spellcheck="false" />
          </FormField>
        </div>

        <div class="mt-6 flex flex-wrap items-center justify-end gap-2">
          <BaseButton
            v-if="isConfigured"
            variant="danger"
            :disabled="disable.isPending.value"
            @click="onDisable"
          >
            {{ disable.isPending.value ? "Disabling…" : "Disable &amp; wipe password" }}
          </BaseButton>
          <BaseButton
            variant="primary"
            :disabled="enable.isPending.value"
            @click="onSaveAndEnable"
          >
            {{ enable.isPending.value ? "Saving…" : isConfigured ? "Save &amp; enable" : "Save &amp; enable" }}
          </BaseButton>
        </div>
      </BaseCard>

      <!-- ── Client certificate (mutual TLS) ──────────────────────────────────── -->
      <!-- Its own component: the certificate lifecycle is a staged rotation (upload → test →
           activate → roll back), not a field on the credentials form, and inlining it here would
           push this page past the 500-line budget the file-size fitness function enforces. -->
      <EfsClientCertCard v-if="isConfigured" />

      <!-- ── Test connection ──────────────────────────────────────────────────── -->
      <BaseCard v-if="isConfigured" as="section">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="text-base font-semibold text-ink">Test connection</h3>
            <p class="mt-1 text-xs text-ink-muted">
              Fires ONE SOAP probe against EFS with the stored credentials. Roundtrip time is
              reported. Useful right after Save, and right after EFS confirms IP allowlisting.
            </p>
          </div>
          <BaseButton
            variant="secondary"
            :disabled="testConn.isPending.value"
            @click="onTestConnection"
          >
            {{ testConn.isPending.value ? "Testing…" : "Test now" }}
          </BaseButton>
        </div>

        <div v-if="testResult" class="mt-3 rounded-control bg-surface-subtle p-3 text-xs" :class="testChipClass">
          <template v-if="testResult.kind === 'success'">
            ✓ Connected — roundtrip {{ testResult.roundtripMs }} ms
          </template>
          <template v-else-if="testResult.kind === 'not_implemented'">
            ⏳ Waiting on EFS WSDL — the SOAP client is deployed and the credentials round-trip
            correctly, but the specific EFS operations are stubbed until we receive the WSDL from
            EFS's data release. This is the expected pre-launch state.
          </template>
          <template v-else>
            ✗ {{ testResult.message }}
          </template>
        </div>
      </BaseCard>

      <!-- ── Per-feed sync + status ───────────────────────────────────────────── -->
      <section v-if="isEnabled" class="space-y-3">
        <h3 class="text-sm font-semibold uppercase tracking-wider text-ink-muted">Feeds</h3>
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <JobActionCard
              title="Rejected feed"
              kind="efs_soap_rejected"
              endpoint="/api/integrations/efs-soap/sync-now/rejected"
              action-label="Sync now"
              description="Rejected authorization attempts (INACTIVE CARD, INVALID TRUCKSTOP, LIMIT EXCEEDED, etc.) — the fraud signal. Polled every EFS_SOAP_REJECTED_POLL_MINUTES (default 5 min)."
            />
            <p
              v-if="rejectedFreshness"
              class="mt-2 text-xs"
              :class="rejectedFreshness.warn ? 'text-caution-700' : 'text-ink-muted'"
            >
              {{ rejectedFreshness.label }}
            </p>
          </div>
          <div>
            <JobActionCard
              title="Posted feed"
              kind="efs_soap_posted"
              endpoint="/api/integrations/efs-soap/sync-now/posted"
              action-label="Sync now"
              description="Posted (completed + billed) fuel transactions. Polled every EFS_SOAP_POSTED_POLL_MINUTES (default 15 min). Also used for the initial 90-day backfill on first enable."
            />
            <p
              v-if="postedFreshness"
              class="mt-2 text-xs"
              :class="postedFreshness.warn ? 'text-caution-700' : 'text-ink-muted'"
            >
              {{ postedFreshness.label }}
            </p>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
