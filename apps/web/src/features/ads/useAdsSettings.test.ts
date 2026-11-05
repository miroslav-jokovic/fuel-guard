import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { ADS_SETTINGS_UNSET } from "@silvicom/shared";

/**
 * A settings save moves what "spend so far" is measured against (E1c): the caps and budgets. So it refreshes
 * the spend read as well as the settings, or the page shows a forecast against yesterday's cap.
 */
vi.mock("@/lib/api", () => ({ apiFetch: async () => ({ ok: true, status: 200, data: { version: 5 } }) }));
import { ADS_SETTINGS_KEY, ADS_SPEND_KEY, useSaveAdsSettings } from "./useAdsSettings";

describe("useSaveAdsSettings", () => {
  it("a save refreshes the settings and the spend so far", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    let save!: ReturnType<typeof useSaveAdsSettings>;
    mount(defineComponent({ setup: () => ((save = useSaveAdsSettings()), () => h("div")) }), { global: { plugins: [[VueQueryPlugin, { queryClient: qc }]] } });
    await save.mutateAsync(ADS_SETTINGS_UNSET);
    await flushPromises();
    expect(spy.mock.calls.map((c) => (c[0] as { queryKey?: unknown } | undefined)?.queryKey)).toEqual([ADS_SETTINGS_KEY, ADS_SPEND_KEY]);
  });
});
