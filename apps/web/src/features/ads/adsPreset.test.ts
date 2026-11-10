import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { AppSwitch } from "@silvicom/ui";
import { adPresetRecipeSchema, type AdPresetRecipe, type AdPresetSave, type AdPresetView } from "@silvicom/shared";

/**
 * The preset editor (E2): a saved preset can reach compose and the publisher, a version keeps what the form does
 * not edit, and the buttons follow `requireAdminOnly("ads.brand-kit")`.
 */
const who = vi.hoisted(() => ({ admin: true }));
const state = vi.hoisted(() => ({ saves: [] as AdPresetSave[], presets: [] as unknown[], refreshed: [] as unknown[], failed: null as Error | null }));
vi.mock("@/lib/api", () => ({ apiFetch: async () => ({ ok: true }) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ admin: who.admin }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@tanstack/vue-query", () => ({
  useQuery: () => ({ data: ref(state.presets), isLoading: ref(false), isFetching: ref(false), error: ref(state.failed), refetch: vi.fn() }),
  useMutation: (o: { mutationFn: (v: AdPresetSave) => Promise<void>; onSuccess?: () => unknown }) => ({
    isPending: ref(false),
    mutateAsync: async (v: AdPresetSave) => { state.saves.push(v); await o.mutationFn(v); await o.onSuccess?.(); },
  }),
  useQueryClient: () => ({ invalidateQueries: (q: unknown) => state.refreshed.push(q) }),
}));

import AdsPresetCard from "./AdsPresetCard.vue";
import AdsPresetDrawer from "./AdsPresetDrawer.vue";
import { blankPresetForm, presetFormFrom, presetSaveFrom, type PresetForm } from "./adsPresetForm";

const RECIPE: AdPresetRecipe = adPresetRecipeSchema.parse({
  name: "The number", hook_formula: "Lead with the pay.",
  copy_slots: [{ name: "headline", max_chars: 40 }, { name: "cta", max_chars: 20 }, { name: "body", max_chars: 200 }, { name: "title", max_chars: 40 }],
  image_prompt_template: "Our tractor at {time_of_day}, no text, no logos",
  image_slots: ["time_of_day"], starts_from: "equipment_photo", shows_equipment: true, shows_people: false,
  motion_template: "A slow push-in on the tractor", formats: ["1:1", "4:5"],
  overlay_slots: { headline: "headline", cta: "cta" }, platform_slots: { primary_text: "body", headline: "title" },
});
const VIEW: AdPresetView = { id: "p", key: "P2", archived_at: null, current: { id: "v", parent_id: "p", version: 2, body: RECIPE, enabled: false, saved_at: "2026-11-05T12:00:00Z", saved_by_name: "Ana" } };
const filled = (over: Partial<PresetForm> = {}): PresetForm => ({ ...presetFormFrom("P2", true, RECIPE), ...over });

beforeEach(() => {
  state.saves = [];
  state.presets = [];
  state.refreshed = [];
  state.failed = null;
  who.admin = true;
  setActivePinia(createPinia());
});

describe("presetSaveFrom — what a save sends", () => {
  it("a preset without overlay slots is refused here, not at compose", () => {
    expect(presetSaveFrom(filled({ overlay_cta: null }))).toMatchObject({ ok: false, message: expect.stringContaining("on the image") });
  });

  it("a preset without platform slots is refused here, not at the publisher", () => {
    expect(presetSaveFrom(filled({ platform_headline: null }))).toMatchObject({ ok: false, message: expect.stringContaining("beside the image") });
  });

  it("reads the image slots from the template, so they cannot disagree", () => {
    const ask = presetSaveFrom(filled({ image_prompt_template: "A {road} at {time_of_day}, no text" }));
    expect(ask.ok && ask.save.recipe.image_slots).toEqual(["road", "time_of_day"]);
  });

  it("shows the contract's own sentence when one slot is both on the image and beside it", () => {
    expect(presetSaveFrom(filled({ platform_headline: "headline" }))).toEqual({ ok: false, message: "headline is drawn on the image; the platform's text is another slot" });
  });

  it("shows the contract's own sentence for a bad key", () => {
    expect(presetSaveFrom(filled({ key: "p2" }))).toEqual({ ok: false, message: "a preset's key is capitals, digits and underscores, like P2" });
  });

  it("a blank form starts with nothing that would pass", () => {
    expect(presetSaveFrom(blankPresetForm()).ok).toBe(false);
  });
});

describe("presetFormFrom — the next version starts from the last", () => {
  it("keeps every field, the motion template it has no input for included, through a save with no edit", () => {
    const ask = presetSaveFrom(presetFormFrom("P2", false, RECIPE));
    expect(ask.ok && ask.save).toEqual({ key: "P2", enabled: false, recipe: RECIPE });
  });
});

describe("AdsPresetCard", () => {
  const stubs = { AdsPresetDrawer: true };
  it("says plainly when there is no preset", () => {
    expect(mount(AdsPresetCard, { global: { stubs } }).find("[data-test=no-presets]").exists()).toBe(true);
  });

  it("an admin may make and edit a preset, and the row says whether it is in use", () => {
    state.presets = [VIEW];
    const w = mount(AdsPresetCard, { global: { stubs } });
    expect(w.find("[data-test=new-preset]").exists()).toBe(true);
    expect(w.find("[data-test=edit-preset]").exists()).toBe(true);
    expect(w.find("[data-test=preset-row]").text()).toContain("Not in use");
  });

  it("anyone else reads the preset and is offered nothing the API would refuse", () => {
    who.admin = false;
    state.presets = [VIEW];
    const w = mount(AdsPresetCard, { global: { stubs } });
    expect(w.find("[data-test=preset-row]").exists()).toBe(true);
    expect(w.find("[data-test=new-preset]").exists()).toBe(false);
    expect(w.find("[data-test=edit-preset]").exists()).toBe(false);
  });

  it("offers no new preset while the list has failed to load", () => {
    state.failed = new Error("down");
    expect(mount(AdsPresetCard, { global: { stubs } }).find("[data-test=new-preset]").exists()).toBe(false);
  });

  it("an archived preset is not listed", () => {
    state.presets = [{ ...VIEW, archived_at: "2026-11-01T00:00:00Z" }];
    expect(mount(AdsPresetCard, { global: { stubs } }).find("[data-test=preset-row]").exists()).toBe(false);
  });
});

describe("AdsPresetDrawer", () => {
  const slide = { template: "<div><slot /><slot name='footer' /></div>" };
  const drawer = (preset: AdPresetView | null) => mount(AdsPresetDrawer, { props: { open: true, preset }, global: { stubs: { SlideOver: slide } } });

  it("a form the contract refuses is not sent, and says why", async () => {
    const w = drawer(null);
    await w.find("[data-test=preset-form]").trigger("submit");
    expect(state.saves).toEqual([]);
    expect(w.find("[data-test=preset-refusal]").exists()).toBe(true);
  });

  it("saving an edited preset sends the next version under its key and closes", async () => {
    const w = drawer(VIEW);
    expect(w.find("[data-test=save-preset]").text()).toBe("Save as version 3");
    await w.find("[data-test=preset-form]").trigger("submit");
    await flushPromises();
    expect(state.saves[0]).toMatchObject({ key: "P2", enabled: false });
    expect(w.emitted("close")).toHaveLength(1);
    // The list is read again, so the card shows the version just saved.
    expect(state.refreshed).toEqual([{ queryKey: ["ads", "presets"] }]);
  });

  it("a format switched off is left out of the next version, and the others keep their order", async () => {
    const w = drawer(VIEW);
    const square = w.findAllComponents(AppSwitch).find((s) => s.props("label") === "1:1")!;
    square.vm.$emit("update:modelValue", false);
    await w.find("[data-test=preset-form]").trigger("submit");
    await flushPromises();
    expect(state.saves[0]?.recipe.formats).toEqual(["4:5"]);
  });

  it("a preset left with 9:16 alone is not sent: no ad is shown in that format yet, and the drawer says which formats are", async () => {
    const w = drawer(VIEW);
    for (const label of ["1:1", "4:5"]) w.findAllComponents(AppSwitch).find((s) => s.props("label") === label)!.vm.$emit("update:modelValue", false);
    w.findAllComponents(AppSwitch).find((s) => s.props("label") === "9:16")!.vm.$emit("update:modelValue", true);
    await w.find("[data-test=preset-form]").trigger("submit");
    await flushPromises();
    expect(state.saves).toEqual([]);
    expect(w.find("[data-test=preset-refusal]").text()).toBe("Choose 4:5 or 1:1 as well: those are the formats an ad is shown in today, and 9:16 alone cannot be published.");
  });

  it("only the format no ad is shown in carries the note that it is not made yet", () => {
    const notes = drawer(VIEW).findAll("[data-test=preset-format-not-made]");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.element.parentElement!.textContent).toContain("9:16");
  });
});
