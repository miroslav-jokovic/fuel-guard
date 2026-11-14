<script setup lang="ts">
import { onMounted, ref } from "vue";
import { AppButton as BaseButton } from "@silvicom/ui";
import { IOS_INSTALL_STEPS, dismissInstall, installApp, installStripShown, installWay, installedOnThisKindOfDevice } from "@/lib/installApp";
import { listPushDevices } from "@/lib/webPush";

/**
 * "Install Silvicom 360" — the offer no phone makes on its own (CHAT-WEB-PUSH-PLAN.md WP6, D-WP15;
 * `lib/installApp.ts` has the per-browser facts).
 *
 * A strip in its own row above the layout, like `ScannerRelayBar` and unlike `UpdateBanner`: on a phone an
 * overlay would sit on the page's own bottom bar or its header, and this has to stay readable while the
 * person finds Share in Safari's chrome. It closes for good on "Not now"; the account menu brings it back.
 *
 *   · Android (Chrome, Edge, Samsung Internet): one button that opens the browser's own install dialog.
 *   · iPhone / iPad: the steps, because Safari gives a page nothing to press.
 */
const busy = ref(false);

/**
 * An iPhone tab is asked once per load whether the person already has the app (`installedOnThisKindOfDevice`)
 * and shows nothing until it knows — a strip that appears and then leaves is worse than one a moment late.
 * Android and a PC need no question: the browser stops offering an install the moment there is one.
 */
const asking = ref(installWay.value === "ios-steps" && installStripShown.value);
onMounted(async () => {
  if (!asking.value) return;
  const devices = await listPushDevices();
  if (devices && installedOnThisKindOfDevice(devices.map((d) => d.device_label))) dismissInstall();
  asking.value = false;
});

async function install() {
  if (busy.value) return;
  busy.value = true;
  await installApp();
  busy.value = false;
}
</script>

<template>
  <div
    v-if="installStripShown && !asking"
    class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-info-50 px-4 py-1.5 text-xs text-info-800 ring-1 ring-info-200 ring-inset"
    role="status"
    data-testid="install-app-bar"
  >
    <template v-if="installWay === 'prompt'">
      <span>Install Silvicom 360 on this device to open it like an app and get chat notifications.</span>
      <BaseButton size="sm" variant="primary" :disabled="busy" @click="install">Install</BaseButton>
    </template>
    <template v-else>
      <span class="font-semibold">Add Silvicom 360 to your Home Screen:</span>
      <ol class="list-decimal pl-4 text-left">
        <li v-for="step in IOS_INSTALL_STEPS" :key="step">{{ step }}</li>
      </ol>
    </template>
    <!-- On an iPhone the strip cannot always tell the steps were followed, so the way out says both. -->
    <BaseButton size="sm" variant="ghost" @click="dismissInstall">{{ installWay === "prompt" ? "Not now" : "Close" }}</BaseButton>
  </div>
</template>
