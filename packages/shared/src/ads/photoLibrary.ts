import { AD_PHOTO_TAGS, type AdBrandKit, type AdPhotoTag } from "./brandKitContract.js";

/**
 * What a brand kit's photo library holds, and what a person should be told about it before ads are made from it
 * (ADS-PLATFORM-V2-PLAN V3 "photo library"; audit F-AG5). Pure, so the kit editor and the kit's row on the settings
 * page say the same thing, and a later reader (the Art director choosing where a picture starts) counts the same way.
 *
 * ── WHY ONE PHOTO IS WORTH A SENTENCE ──────────────────────────────────────────────────────────────
 * A scene that shows equipment is drawn image-to-image FROM a kit photo and checked against it (D-AD9), so the
 * photo fixes the truck, its colour and most of its angle. A kit with one photo therefore gives every equipment ad
 * the same truck from the same side whatever the campaign's plan says — the audit's "five ads, one picture"
 * (F-AG5). Nothing refuses such a kit (one honest photo is better than none); the person is told, in words, what it
 * will cost them, and what to add.
 */
export const PHOTO_TAG_LABEL: Record<AdPhotoTag, string> = {
  truck: "Truck", trailer: "Trailer", driver: "Driver", yard: "Yard", road: "Road",
};

export interface PhotoLibrary {
  photos: number;
  /** How many photos carry each tag, in `AD_PHOTO_TAGS` order. */
  byTag: Record<AdPhotoTag, number>;
  /** Photos with no tag at all: saved before tags existed, or not yet looked at. */
  untagged: number;
}

export function photoLibrary(kit: Pick<AdBrandKit, "equipment_photos">): PhotoLibrary {
  const byTag = Object.fromEntries(AD_PHOTO_TAGS.map((t) => [t, 0])) as Record<AdPhotoTag, number>;
  let untagged = 0;
  for (const p of kit.equipment_photos) {
    const tags = p.tags ?? [];
    if (tags.length === 0) untagged += 1;
    for (const t of new Set(tags)) byTag[t] += 1;
  }
  return { photos: kit.equipment_photos.length, byTag, untagged };
}

/**
 * The sentences a person reads about their library, most important first; empty when there is nothing to say.
 * No photo is the Art director's own refusal for an equipment scene (`no_reference_photo`), said here before a
 * campaign meets it.
 */
export function photoLibraryAdvice(kit: Pick<AdBrandKit, "equipment_photos">): string[] {
  const lib = photoLibrary(kit);
  const out: string[] = [];
  if (lib.photos === 0) out.push("No photo yet: an ad that shows equipment cannot be made until the kit has one.");
  else if (lib.photos === 1) out.push("One photo: every ad that shows equipment starts from it, so they will all show the same truck from the same side. Add two or three more, from other angles.");
  if (lib.untagged > 0 && lib.photos > 0) out.push(lib.untagged === lib.photos && lib.photos > 1
    ? "No photo says what it shows yet. Tick what is in each one."
    : lib.untagged === 1 ? (lib.photos === 1 ? "Tick what the photo shows." : "1 photo does not say what it shows yet.") : `${lib.untagged} photos do not say what they show yet.`);
  return out;
}

/** "3 photos · 2 truck, 1 yard" — the library in one line for the kit's row. */
export function photoLibraryLine(kit: Pick<AdBrandKit, "equipment_photos">): string {
  const lib = photoLibrary(kit);
  const count = lib.photos === 1 ? "1 photo" : `${lib.photos} photos`;
  const kinds = AD_PHOTO_TAGS.filter((t) => lib.byTag[t] > 0).map((t) => `${lib.byTag[t]} ${PHOTO_TAG_LABEL[t].toLowerCase()}`);
  return kinds.length > 0 ? `${count} · ${kinds.join(", ")}` : count;
}
