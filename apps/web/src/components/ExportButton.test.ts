import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { AppButton, AppIcon } from "@silvicom/ui";
import { ArrowDownTrayIcon, ChevronDownIcon, DocumentTextIcon } from "@silvicom/ui/icons";
import ExportButton, {
  type ExportButtonProps,
  type ExportItem,
} from "@/components/ExportButton.vue";

const apiDownload = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("@/lib/api", () => ({ apiDownload }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => toast }));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function mountExport(props: ExportButtonProps): VueWrapper {
  // Vue Test Utils selects one member instead of distributing this component's exclusive prop
  // union. The helper's argument still type-checks every fixture against the public contract.
  return mount(ExportButton, { props: props as never, attachTo: document.body });
}

function buttonWithText(wrapper: VueWrapper, text: string) {
  return wrapper.findAll("button").find((button) => button.text().includes(text));
}

async function openMenu(wrapper: VueWrapper) {
  await wrapper.get("button").trigger("click");
  await nextTick();
}

describe("ExportButton", () => {
  beforeEach(() => {
    apiDownload.mockReset();
    apiDownload.mockResolvedValue(undefined);
    toast.error.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses the fixed secondary download treatment and names the exported scope", () => {
    const wrapper = mountExport({
      href: "/api/fuel.csv",
      filename: "fuel.csv",
      scope: "August · 2 trucks",
    });
    const trigger = wrapper.get("button");
    const button = wrapper.getComponent(AppButton);

    expect(wrapper.text()).toContain("August · 2 trucks");
    expect(trigger.text()).toContain("Export CSV");
    expect(button.props("variant")).toBe("secondary");
    expect(wrapper.props()).not.toHaveProperty("variant");
    expect(wrapper.findAllComponents(AppIcon)[0]?.props("icon")).toEqual(ArrowDownTrayIcon);
  });

  it("downloads href exports with their filename", async () => {
    const wrapper = mountExport({
      href: "/api/fuel.csv?range=month",
      filename: "fuel-august.csv",
      scope: "August",
      label: "Export fuel",
    });

    await wrapper.get("button").trigger("click");
    await flushPromises();

    expect(apiDownload).toHaveBeenCalledOnce();
    expect(apiDownload).toHaveBeenCalledWith("/api/fuel.csv?range=month", "fuel-august.csv");
  });

  it("runs synchronous and asynchronous actions through the same busy lock", async () => {
    const pending = deferred();
    const run = vi.fn(() => pending.promise);
    const wrapper = mountExport({ run, scope: "All visible rows", busyLabel: "Preparing…" });
    const trigger = wrapper.get("button");

    await trigger.trigger("click");
    await trigger.trigger("click");

    expect(run).toHaveBeenCalledOnce();
    expect(trigger.attributes("disabled")).toBeDefined();
    expect(trigger.attributes("aria-busy")).toBe("true");
    expect(trigger.text()).toContain("Preparing…");

    pending.resolve();
    await flushPromises();
    expect(trigger.attributes("disabled")).toBeUndefined();
    expect(trigger.attributes("aria-busy")).toBeUndefined();

    const synchronous = vi.fn();
    const syncWrapper = mountExport({ run: synchronous, scope: "One row" });
    await syncWrapper.get("button").trigger("click");
    expect(synchronous).toHaveBeenCalledOnce();
  });

  it("shows the standard fallback toast with the server error", async () => {
    apiDownload.mockRejectedValueOnce(new Error("Selection is too large"));
    const wrapper = mountExport({
      href: "/api/large.csv",
      filename: "large.csv",
      scope: "84,000 rows",
    });

    await wrapper.get("button").trigger("click");
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith("Could not build the file", "Selection is too large");
  });

  it("lets a handled error suppress fallback feedback", async () => {
    const error = new Error("Known refusal");
    const onError = vi.fn(() => true as const);
    const wrapper = mountExport({
      run: () => Promise.reject(error),
      scope: "Filtered rows",
      onError,
    });

    await wrapper.get("button").trigger("click");
    await flushPromises();

    expect(onError).toHaveBeenCalledWith(error, expect.any(Function));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps retry inside the busy lock and executes it only once", async () => {
    const firstError = new Error("Temporary failure");
    const run = vi.fn().mockRejectedValueOnce(firstError).mockResolvedValueOnce(undefined);
    const onError = vi.fn((_error: unknown, retry: () => Promise<void>) => {
      void retry();
      void retry();
    });
    const wrapper = mountExport({ run, scope: "Filtered rows", onError });

    await wrapper.get("button").trigger("click");
    await flushPromises();

    expect(onError).toHaveBeenCalledWith(firstError, expect.any(Function));
    expect(run).toHaveBeenCalledTimes(2);
    expect(toast.error).not.toHaveBeenCalled();
    expect(wrapper.get("button").attributes("disabled")).toBeUndefined();
  });

  it("falls back once when a retry fails", async () => {
    const retryError = new Error("Still unavailable");
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("Temporary failure"))
      .mockRejectedValueOnce(retryError);
    const wrapper = mountExport({
      run,
      scope: "Filtered rows",
      errorTitle: "Could not export fuel",
      onError: vi
        .fn()
        .mockImplementationOnce((_error: unknown, retry: () => Promise<void>) => retry())
        .mockReturnValueOnce(false),
    });

    await wrapper.get("button").trigger("click");
    await flushPromises();

    expect(run).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith("Could not export fuel", "Still unavailable");
  });

  it("runs a delayed retry as a new locked execution and handles its rejection", async () => {
    const firstError = new Error("Step-up required");
    const retryError = new Error("Confirmation expired");
    const retryAttempt = deferred();
    const run = vi
      .fn()
      .mockRejectedValueOnce(firstError)
      .mockImplementationOnce(() => retryAttempt.promise);
    let confirmRetry: (() => Promise<void>) | undefined;
    const onError = vi.fn((error: unknown, retry: () => Promise<void>) => {
      if (error === firstError) {
        confirmRetry = retry;
        return true;
      }
      return false;
    });
    const wrapper = mountExport({ run, scope: "Filtered rows", onError });
    const trigger = wrapper.get("button");

    await trigger.trigger("click");
    await flushPromises();
    expect(trigger.attributes("disabled")).toBeUndefined();
    expect(confirmRetry).toBeTypeOf("function");

    const retryTask = confirmRetry!();
    const duplicateTask = confirmRetry!();
    await nextTick();
    expect(run).toHaveBeenCalledTimes(2);
    expect(trigger.attributes("disabled")).toBeDefined();
    expect(trigger.attributes("aria-busy")).toBe("true");

    retryAttempt.reject(retryError);
    await Promise.all([retryTask, duplicateTask]);
    await flushPromises();

    expect(run).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenLastCalledWith(retryError, expect.any(Function));
    expect(toast.error).toHaveBeenCalledWith("Could not build the file", "Confirmation expired");
    expect(trigger.attributes("disabled")).toBeUndefined();
    expect(trigger.attributes("aria-busy")).toBeUndefined();
  });

  it("renders menu descriptions and icons as ghost row buttons", async () => {
    const items: ExportItem[] = [
      {
        key: "pdf",
        label: "PDF statement",
        description: "Ready for a driver packet",
        icon: DocumentTextIcon,
        run: vi.fn(),
      },
      { key: "csv", label: "CSV data", href: "/api/export.csv", filename: "export.csv" },
    ];
    const wrapper = mountExport({ items, scope: "August · 2 trucks" });

    expect(wrapper.findAllComponents(AppIcon).map((icon) => icon.props("icon"))).toEqual([
      ArrowDownTrayIcon,
      ChevronDownIcon,
    ]);
    await openMenu(wrapper);

    expect(wrapper.text()).toContain("Ready for a driver packet");
    expect(
      wrapper.findAllComponents(AppIcon).some((icon) => {
        return JSON.stringify(icon.props("icon")) === JSON.stringify(DocumentTextIcon);
      }),
    ).toBe(true);
    const row = wrapper
      .findAllComponents(AppButton)
      .find((button) => button.text().includes("PDF statement"));
    expect(row?.props()).toMatchObject({ variant: "ghost", size: "row", block: true });
    expect(wrapper.get('[role="menu"]').attributes("aria-label")).toBe("Export options");
  });

  it("executes either menu source and locks the control while an item is running", async () => {
    const pending = deferred();
    const buildPdf = vi.fn(() => pending.promise);
    const items: ExportItem[] = [
      { key: "pdf", label: "PDF statement", busyLabel: "Building PDF…", run: buildPdf },
      { key: "csv", label: "CSV data", href: "/api/export.csv", filename: "export.csv" },
    ];
    const wrapper = mountExport({ items, scope: "August" });

    await openMenu(wrapper);
    await buttonWithText(wrapper, "PDF statement")!.trigger("click");

    expect(buildPdf).toHaveBeenCalledOnce();
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    expect(wrapper.get("button").text()).toContain("Building PDF…");

    pending.resolve();
    await flushPromises();
    await openMenu(wrapper);
    await buttonWithText(wrapper, "CSV data")!.trigger("click");
    await flushPromises();
    expect(apiDownload).toHaveBeenCalledWith("/api/export.csv", "export.csv");
  });

  it("opens, executes, and restores trigger focus with the keyboard", async () => {
    const pending = deferred();
    const run = vi.fn(() => pending.promise);
    const wrapper = mountExport({
      items: [{ key: "csv", label: "CSV data", run }],
      scope: "Current filters",
    });
    const trigger = wrapper.get("button");
    trigger.element.focus();

    await trigger.trigger("keydown", { key: "ArrowDown" });
    await nextTick();
    const item = buttonWithText(wrapper, "CSV data")!;
    const menu = wrapper.get('[role="menu"]');
    expect(document.activeElement).toBe(menu.element);
    expect(menu.attributes("aria-activedescendant")).toBe(item.attributes("id"));

    await menu.trigger("keydown", { key: "Enter" });
    await nextTick();
    expect(run).toHaveBeenCalledOnce();
    expect(trigger.attributes("disabled")).toBeDefined();
    expect(document.activeElement).not.toBe(trigger.element);

    pending.resolve();
    await flushPromises();
    expect(trigger.attributes("disabled")).toBeUndefined();
    expect(document.activeElement).toBe(trigger.element);
  });

  it("disables an empty menu instead of opening an inaccessible panel", async () => {
    const wrapper = mountExport({ items: [], scope: "No rows" });
    const trigger = wrapper.get("button");

    expect(trigger.attributes("disabled")).toBeDefined();
    await trigger.trigger("click");
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });
});
