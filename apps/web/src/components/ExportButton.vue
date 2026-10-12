<script lang="ts">
import type { Icon } from "@silvicom/ui/icons";

export type ExportRun = () => void | Promise<void>;
export type ExportRetry = () => Promise<void>;
export type ExportErrorHandler = (
  error: unknown,
  retry: ExportRetry,
) => boolean | void | Promise<boolean | void>;

interface ExportItemPresentation {
  key: string;
  label: string;
  description?: string;
  icon?: Icon;
  busyLabel?: string;
  errorTitle?: string;
  onError?: ExportErrorHandler;
}

export type ExportItem = ExportItemPresentation &
  (
    | { href: string; filename: string; run?: never }
    | { run: ExportRun; href?: never; filename?: never }
  );

interface SharedExportProps {
  /** The scope sentence shown beside the control, e.g. "Aug 1 – Aug 31 · 2 trucks". */
  scope: string;
  label?: string;
  busyLabel?: string;
  disabled?: boolean;
  errorTitle?: string;
  onError?: ExportErrorHandler;
}

export type ExportButtonProps = SharedExportProps &
  (
    | { href: string; filename: string; run?: never; items?: never }
    | { run: ExportRun; href?: never; filename?: never; items?: never }
    | { items: readonly ExportItem[]; href?: never; filename?: never; run?: never }
  );
</script>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/vue";
import { AppButton as BaseButton, AppIcon } from "@silvicom/ui";
import { ArrowDownTrayIcon, ChevronDownIcon } from "@silvicom/ui/icons";
import { apiDownload } from "@/lib/api";
import { useToastStore } from "@/stores/toast";

/**
 * "This filter bar, as a file." The one presentation and execution contract for an export action.
 *
 * ── WHY IT NAMES ITS OWN SCOPE ──────────────────────────────────────────────────────────────────
 * `ReportExportButton` learnt this on the spend page and the sentence is worth keeping: the filter bar
 * already controls the period and the trucks and the export has always followed it, but nothing SAID
 * so, so a 90-day default read as "the report is stuck on three months" rather than as "the filter is
 * set to three months". Stating the range and the truck count turns an invisible coupling into an
 * obvious one — and the server prints the same sentence ON the artefact (D-FUI15), because a file
 * outlives the screen it came from. That is why `scope` is required.
 *
 * ── WHY THERE IS ONE OF THESE AND NOT SIX ───────────────────────────────────────────────────────
 * FUEL-P2 put an export on five list surfaces, and by the 2026-10-10 UI audit the Fleet overview,
 * the driver file, the access review and the spend tabs had each grown a button of their own besides —
 * each with its own busy flag, its own toast and its own look. That is how a section ends up with
 * controls that look almost but not quite alike, the thing `apps/web/CLAUDE.md`'s "one primitive per
 * job" exists to prevent. So a caller supplies exactly one source — an API download (`href`), an
 * arbitrary action (`run`: client-built CSVs, step-up-guarded exports) or a list of formats (`items`:
 * the Fleet overview's menu) — and all three travel through `execute`, so duplicate prevention, retry
 * handling and failure feedback cannot drift between them. Wrappers such as `ReportExportButton` keep
 * only the knowledge of their address.
 *
 * The failure path is a toast, not an inline banner, and it carries the SERVER's sentence: the one
 * refusal a list export produces is "that selection is 84,000 rows", which is only useful if the
 * number survives to the reader.
 */
const props = defineProps<ExportButtonProps>();
const toast = useToastStore();
const activeKey = ref<string | null>(null);
const menuTriggerRef = ref<{ $el: HTMLButtonElement } | null>(null);

type Executable = Pick<
  ExportItem,
  "href" | "filename" | "run" | "busyLabel" | "errorTitle" | "onError"
>;

interface Execution {
  key: string;
  task: Promise<void>;
}

let activeExecution: Execution | null = null;

const items = computed<readonly ExportItem[]>(() => props.items ?? []);
const isMenu = computed(() => props.items !== undefined);
const busy = computed(() => activeKey.value !== null);
const singleLabel = computed(() => props.label ?? "Export CSV");
const menuLabel = computed(() => props.label ?? "Export");
const currentItem = computed(() => items.value.find((item) => item.key === activeKey.value));
const displayedBusyLabel = computed(
  () =>
    currentItem.value?.busyLabel ?? props.busyLabel ?? (isMenu.value ? "Exporting…" : "Building…"),
);

async function invoke(source: Executable): Promise<void> {
  if (source.run) {
    await source.run();
    return;
  }
  if (source.href && source.filename) await apiDownload(source.href, source.filename);
}

function reportFailure(source: Executable, error: unknown) {
  toast.error(
    source.errorTitle ?? props.errorTitle ?? "Could not build the file",
    error instanceof Error ? error.message : undefined,
  );
}

async function attempt(source: Executable, execution: Execution): Promise<void> {
  try {
    await invoke(source);
  } catch (error) {
    const handler = source.onError ?? props.onError;
    if (!handler) {
      reportFailure(source, error);
      return;
    }

    // An immediate retry remains inside this execution and therefore keeps its busy lock. A retry
    // saved for a later confirmation starts a new serialized execution. Either way, repeated calls
    // receive one promise and a failed retry returns here through the same error contract.
    let retryTask: Promise<void> | null = null;
    const retry: ExportRetry = () => {
      retryTask ??=
        activeExecution === execution
          ? attempt(source, execution)
          : enqueueRetry(source, execution.key);
      return retryTask;
    };

    let handled: boolean | void = undefined;
    let handlerFailed = false;
    try {
      handled = await handler(error, retry);
    } catch (handlerError) {
      handlerFailed = true;
      reportFailure(source, handlerError);
    }

    // The handler may intentionally fire-and-forget retry while it dismisses a confirmation UI.
    // The executor still owns that promise, including when the rest of the handler throws.
    if (retryTask) await retryTask;
    else if (!handlerFailed && handled !== true) reportFailure(source, error);
  }
}

async function enqueueRetry(source: Executable, key: string): Promise<void> {
  // A delayed retry can be confirmed while another export is already running. Wait for that work
  // instead of dropping the retry or overlapping two downloads.
  while (activeExecution) await activeExecution.task;
  await execute(source, key);
}

function execute(source: Executable, key: string): Promise<void> {
  if (activeExecution) return activeExecution.task;

  const execution: Execution = { key, task: Promise.resolve() };
  activeExecution = execution;
  activeKey.value = key;
  execution.task = attempt(source, execution).finally(() => {
    if (activeExecution === execution) {
      activeExecution = null;
      activeKey.value = null;
    }
  });
  return execution.task;
}

function runSingle() {
  if (props.items !== undefined) return;
  return execute(props, "single");
}

async function runMenuItem(item: ExportItem) {
  await execute(item, item.key);
  // Headless UI uses aria-activedescendant focus on the menu container. Once selecting an item
  // removes that container, put keyboard focus back on the control that opened it — but only after
  // execution releases the busy lock, because a disabled element cannot receive focus.
  await nextTick();
  await nextTick();
  if (!props.disabled && items.value.length > 0) menuTriggerRef.value?.$el.focus();
}
</script>

<template>
  <div class="flex items-center gap-2">
    <span v-if="scope" class="hidden text-2xs text-ink-tertiary sm:inline">{{ scope }}</span>

    <Menu v-if="isMenu" as="div" class="relative">
      <MenuButton as="template" :disabled="disabled || busy || items.length === 0">
        <BaseButton
          ref="menuTriggerRef"
          variant="secondary"
          :disabled="disabled || busy || items.length === 0"
          :aria-busy="busy || undefined"
        >
          <AppIcon :icon="ArrowDownTrayIcon" class="size-4" aria-hidden="true" />
          {{ busy ? displayedBusyLabel : menuLabel }}
          <AppIcon :icon="ChevronDownIcon" class="size-4 text-ink-tertiary" aria-hidden="true" />
        </BaseButton>
      </MenuButton>

      <transition
        enter-active-class="transition duration-100 ease-out"
        enter-from-class="scale-95 opacity-0"
        enter-to-class="scale-100 opacity-100"
        leave-active-class="transition duration-75 ease-in"
        leave-from-class="scale-100 opacity-100"
        leave-to-class="scale-95 opacity-0"
      >
        <MenuItems
          class="absolute right-0 z-sticky-lead mt-2 w-64 origin-top-right overflow-hidden rounded-control bg-surface py-1 text-sm shadow-overlay focus:outline-none"
          aria-label="Export options"
        >
          <MenuItem v-for="item in items" :key="item.key" v-slot="{ active }" :disabled="busy">
            <BaseButton
              type="button"
              variant="ghost"
              size="row"
              block
              :disabled="busy"
              :class="[active ? 'bg-surface-subtle' : '', 'gap-3 rounded-none']"
              @click="runMenuItem(item)"
            >
              <AppIcon
                v-if="item.icon"
                :icon="item.icon"
                class="size-5 shrink-0 text-ink-tertiary"
                aria-hidden="true"
              />
              <span class="min-w-0">
                <span class="block font-medium text-ink">
                  {{
                    activeKey === item.key
                      ? (item.busyLabel ?? props.busyLabel ?? "Building…")
                      : item.label
                  }}
                </span>
                <span v-if="item.description" class="mt-0.5 block text-xs leading-4 text-ink-muted">
                  {{ item.description }}
                </span>
              </span>
            </BaseButton>
          </MenuItem>
        </MenuItems>
      </transition>
    </Menu>

    <BaseButton
      v-else
      variant="secondary"
      :disabled="disabled || busy"
      :aria-busy="busy || undefined"
      @click="runSingle"
    >
      <AppIcon :icon="ArrowDownTrayIcon" class="size-4" aria-hidden="true" />
      {{ busy ? displayedBusyLabel : singleLabel }}
    </BaseButton>
  </div>
</template>
