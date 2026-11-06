import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";
import { AD_FORMATS, AD_OVERLAY_START, adBrandKitSchema, type AdAssetRef, type AdBrandKit, type AdBrandKitSave, type AdBrandKitView } from "@silvicom/shared";

/**
 * The brand kit editor (E2): what a save sends is what the contract accepts and the overlay can draw, a saved
 * version is added to and not rewritten, and the buttons follow `requireAdminOnly("ads.brand-kit")`.
 */
const api = vi.hoisted(() => ({ calls: [] as Array<{ path: string; body: unknown }>, answers: [] as unknown[] }));
const who = vi.hoisted(() => ({ admin: true }));
const sent = vi.hoisted(() => ({ saves: [] as AdBrandKitSave[], kits: [] as unknown[], failed: null as Error | null, refreshed: [] as unknown[] }));
vi.mock("@/lib/api", () => ({ apiFetch: async (path: string, o: { body?: unknown } = {}) => (api.calls.push({ path, body: o.body }), api.answers.shift()) }));
vi.mock("@/stores/session", () => ({ useSessionStore: () => ({ admin: who.admin }) }));
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@tanstack/vue-query", () => ({
  useQuery: () => ({ data: ref(sent.kits), isLoading: ref(false), isFetching: ref(false), error: ref(sent.failed), refetch: vi.fn() }),
  useMutation: (o: { mutationFn: (v: AdBrandKitSave) => Promise<void>; onSuccess?: () => unknown }) => ({
    isPending: ref(false),
    mutateAsync: async (v: AdBrandKitSave) => { sent.saves.push(v); await o.mutationFn(v); await o.onSuccess?.(); },
  }),
  useQueryClient: () => ({ invalidateQueries: (q: unknown) => sent.refreshed.push(q) }),
}));

import AdsBrandKitCard from "./AdsBrandKitCard.vue";
import AdsBrandKitDrawer from "./AdsBrandKitDrawer.vue";
import { blankKitForm, kitFormFrom, kitSaveFrom } from "./adsBrandKitForm";
import { uploadKitAsset } from "./useAdsBrandKits";

const ASSET: AdAssetRef = { sha256: "a".repeat(64), format: "png", source_format: "png", width: 800, height: 600, byte_size: 900 };
const filled = () => ({ ...blankKitForm(), name: "Main", company_name: "Silvicom Trucking", colors: [{ name: "Green", hex: "#0B3D2E" }] });
const KIT: AdBrandKit = adBrandKitSchema.parse({
  company_name: "Silvicom Trucking", phone: null, colors: [{ name: "Green", hex: "#0B3D2E" }], logo: ASSET,
  equipment_photos: [{ label: "White Freightliner", asset: ASSET }],
  overlays: { "1:1": { zone: { x: 100, y: 100, width: 500, height: 300 }, text_color: "#000000", plate_color: null } },
  people_policy: "varied", forbidden_marks: ["ACME"],
});
const VIEW: AdBrandKitView = { id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", name: "Main", archived_at: null, current: { id: "v", parent_id: "k", version: 3, body: KIT, saved_at: "2026-11-05T12:00:00Z", saved_by_name: "Ana" } };

beforeEach(() => {
  api.calls = [];
  api.answers = [];
  sent.saves = [];
  sent.kits = [];
  sent.failed = null;
  sent.refreshed = [];
  who.admin = true;
  setActivePinia(createPinia());
});

describe("kitSaveFrom — what a save sends", () => {
  it("a new kit is sent with its name and an overlay for every format, or the overlay would refuse it", () => {
    const ask = kitSaveFrom(filled(), null);
    expect(ask).toMatchObject({ ok: true, save: { kit_id: null, name: "Main" } });
    if (ask.ok) expect(Object.keys(ask.save.kit.overlays).sort()).toEqual([...AD_FORMATS].sort());
  });

  it("a new version names its kit and sends no name, which the door would refuse", () => {
    const ask = kitSaveFrom(filled(), VIEW.id);
    expect(ask.ok && ask.save).toMatchObject({ kit_id: VIEW.id });
    expect(ask.ok && "name" in ask.save && ask.save.name !== undefined).toBe(false);
  });

  it("an empty phone and an empty plate are null, and marks are one per line", () => {
    const form = { ...filled(), phone: "  ", forbidden_marks: " ACME \n\nGlobex" };
    form.overlays["1:1"] = { zone: null, text_color: "#FFFFFF", plate_color: " " };
    const ask = kitSaveFrom(form, null);
    expect(ask.ok && ask.save.kit).toMatchObject({ phone: null, forbidden_marks: ["ACME", "Globex"], overlays: { "1:1": { plate_color: null } } });
  });

  it("shows the contract's own sentence for a bad colour", () => {
    expect(kitSaveFrom({ ...filled(), colors: [{ name: "Green", hex: "green" }] }, null)).toEqual({ ok: false, message: "a colour is six hex digits, like #0B3D2E" });
  });
});

describe("kitFormFrom — the next version starts from the last", () => {
  it("keeps every field, a format's text zone included, through a save with no edit", () => {
    const ask = kitSaveFrom(kitFormFrom("Main", KIT), VIEW.id);
    expect(ask.ok && ask.save.kit).toMatchObject({ ...KIT, overlays: { "1:1": KIT.overlays["1:1"] } });
  });

  it("carries a printed phone into the next version as it was saved", () => {
    const ask = kitSaveFrom(kitFormFrom("Main", { ...KIT, phone: "(555) 010-0199" }), VIEW.id);
    expect(ask.ok && ask.save.kit.phone).toBe("(555) 010-0199");
  });

  it("gives a format the kit lacks the starting overlay", () => {
    expect(kitFormFrom("Main", KIT).overlays["9:16"]).toEqual({ zone: null, ...AD_OVERLAY_START });
  });
});

describe("uploadKitAsset", () => {
  it("asks for a URL, puts the bytes there, and answers what the API accepted", async () => {
    api.answers = [{ ok: true, data: { upload_id: "u-1", signed_url: "https://store/u-1" } }, { ok: true, data: { asset: ASSET } }];
    const put = vi.fn(async () => undefined);
    const file = new File(["x"], "logo.png", { type: "image/png" });
    expect(await uploadKitAsset(file, put)).toEqual(ASSET);
    expect(put).toHaveBeenCalledWith("https://store/u-1", file);
    expect(api.calls[1]).toEqual({ path: "/api/ads/brand-kits/assets", body: { upload_id: "u-1" } });
  });

  it("a file the API refuses comes back as the API's sentence", async () => {
    api.answers = [{ ok: true, data: { upload_id: "u-1", signed_url: "https://store/u-1" } }, { ok: false, error: { message: "That file is a PDF, not an image." } }];
    await expect(uploadKitAsset(new File(["x"], "a.png"), async () => undefined)).rejects.toThrow("That file is a PDF, not an image.");
  });
});

describe("AdsBrandKitCard", () => {
  const stubs = { AdsBrandKitDrawer: true };
  it("says plainly when there is no kit", () => {
    expect(mount(AdsBrandKitCard, { global: { stubs } }).find("[data-test=no-kits]").exists()).toBe(true);
  });

  it("an admin may make and edit a kit", () => {
    sent.kits = [VIEW];
    const w = mount(AdsBrandKitCard, { global: { stubs } });
    expect(w.find("[data-test=new-kit]").exists()).toBe(true);
    expect(w.find("[data-test=edit-kit]").exists()).toBe(true);
    expect(w.find("[data-test=kit-row]").text()).toContain("Version 3");
  });

  it("anyone else reads the kit and is offered nothing the API would refuse", () => {
    who.admin = false;
    sent.kits = [VIEW];
    const w = mount(AdsBrandKitCard, { global: { stubs } });
    expect(w.find("[data-test=kit-row]").exists()).toBe(true);
    expect(w.find("[data-test=new-kit]").exists()).toBe(false);
    expect(w.find("[data-test=edit-kit]").exists()).toBe(false);
  });

  it("an archived kit is not listed", () => {
    sent.kits = [{ ...VIEW, archived_at: "2026-11-01T00:00:00Z" }];
    expect(mount(AdsBrandKitCard, { global: { stubs } }).find("[data-test=kit-row]").exists()).toBe(false);
  });
});

describe("AdsBrandKitDrawer", () => {
  const slide = { template: "<div><slot /><slot name='footer' /></div>" };
  const drawer = (kit: AdBrandKitView | null) => mount(AdsBrandKitDrawer, { props: { open: true, kit }, global: { stubs: { SlideOver: slide, FileDropzone: true } } });

  it("a form the contract refuses is not sent, and says why", async () => {
    const w = drawer(null);
    await w.find("[data-test=kit-form]").trigger("submit");
    expect(sent.saves).toEqual([]);
    expect(w.find("[data-test=kit-refusal]").exists()).toBe(true);
  });

  it("saving an edited kit sends the next version of that kit and closes", async () => {
    api.answers = [{ ok: true }];
    const w = drawer(VIEW);
    expect(w.find("[data-test=save-kit]").text()).toBe("Save as version 4");
    await w.find("[data-test=kit-form]").trigger("submit");
    await flushPromises();
    expect(sent.saves[0]).toMatchObject({ kit_id: VIEW.id });
    expect(w.emitted("close")).toHaveLength(1);
    // The list is read again, so the card shows the version just saved.
    expect(sent.refreshed).toEqual([{ queryKey: ["ads", "brand-kits"] }]);
  });
});
