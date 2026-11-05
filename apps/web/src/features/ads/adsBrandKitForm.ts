import { AD_FORMATS, AD_OVERLAY_START, adBrandKitSaveSchema, type AdAssetRef, type AdBrandKit, type AdBrandKitSave, type AdFormat } from "@silvicom/shared";

/**
 * The brand kit editor's form (E2; plan D-AD10), kept apart from the screen so what a save sends can be tested.
 * `adBrandKitSaveSchema` judges it, here as at the API, so its own sentence is what a person reads.
 *
 * ── A NEW KIT STARTS WITH AN OVERLAY FOR EVERY FORMAT ─────────────────────────────────────────────
 * The contract lets `overlays` be empty, but `renderOverlay` refuses a format with no overlay (`no_template`), so
 * such a kit would save and then stop every campaign at compose. White on a dark plate is a starting point the
 * person can change, and the render check still measures its contrast over each real image.
 *
 * A format's `zone` is not edited here: it is carried through untouched, so a save never loses one.
 */
export interface OverlayRow {
  zone: NonNullable<AdBrandKit["overlays"][AdFormat]>["zone"];
  text_color: string;
  /** Empty = no plate: the text sits straight on the image. */
  plate_color: string;
}

export interface BrandKitForm {
  /** A new kit's name; a later version keeps its kit's. */
  name: string;
  company_name: string;
  phone: string;
  colors: Array<{ name: string; hex: string }>;
  logo: AdAssetRef | null;
  equipment_photos: Array<{ label: string; asset: AdAssetRef }>;
  overlays: Record<AdFormat, OverlayRow>;
  people_policy: AdBrandKit["people_policy"];
  /** One name per line. */
  forbidden_marks: string;
}

const startingOverlay = (): OverlayRow => ({ zone: null, ...AD_OVERLAY_START });

export function blankKitForm(): BrandKitForm {
  return {
    name: "", company_name: "", phone: "", colors: [{ name: "", hex: "" }], logo: null, equipment_photos: [],
    overlays: Object.fromEntries(AD_FORMATS.map((f) => [f, startingOverlay()])) as Record<AdFormat, OverlayRow>,
    people_policy: "none", forbidden_marks: "",
  };
}

/** The form for the next version of a saved kit. A format the kit lacks gets the starting overlay. */
export function kitFormFrom(name: string, kit: AdBrandKit): BrandKitForm {
  return {
    name, company_name: kit.company_name, phone: kit.phone ?? "", colors: kit.colors.map((c) => ({ ...c })), logo: kit.logo,
    equipment_photos: kit.equipment_photos.map((p) => ({ ...p })),
    overlays: Object.fromEntries(AD_FORMATS.map((f) => {
      const o = kit.overlays[f];
      return [f, o ? { zone: o.zone, text_color: o.text_color, plate_color: o.plate_color ?? "" } : startingOverlay()];
    })) as Record<AdFormat, OverlayRow>,
    people_policy: kit.people_policy, forbidden_marks: kit.forbidden_marks.join("\n"),
  };
}

export type KitSaveAsk = { ok: true; save: AdBrandKitSave } | { ok: false; message: string };

/** What the door is sent, or the contract's sentence. `kitId` null makes a new kit, under the form's name. */
export function kitSaveFrom(form: BrandKitForm, kitId: string | null): KitSaveAsk {
  const parsed = adBrandKitSaveSchema.safeParse({
    kit_id: kitId,
    ...(kitId === null ? { name: form.name } : {}),
    kit: {
      company_name: form.company_name,
      phone: form.phone.trim() === "" ? null : form.phone,
      colors: form.colors,
      logo: form.logo,
      equipment_photos: form.equipment_photos,
      overlays: Object.fromEntries(AD_FORMATS.map((f) => {
        const o = form.overlays[f];
        return [f, { zone: o.zone, text_color: o.text_color, plate_color: o.plate_color.trim() === "" ? null : o.plate_color }];
      })),
      people_policy: form.people_policy,
      forbidden_marks: form.forbidden_marks.split("\n").map((m) => m.trim()).filter(Boolean),
    },
  });
  return parsed.success ? { ok: true, save: parsed.data } : { ok: false, message: parsed.error.issues[0]!.message };
}
