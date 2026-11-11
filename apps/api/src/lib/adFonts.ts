import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";

/**
 * The faces an ad's words are drawn in (ADS-AD-LOOK-PLAN D-ADL2). Until 2026-11-10 an ad used the PDF face,
 * Liberation Sans (`pdfFonts.ts`): chosen for documents because it is metric-compatible with Helvetica, and
 * exactly that — an office sans at three sizes — is what the owner's verdict on the finished ads named
 * ("they don't look really good, professional and enterprise grade"; audit F-AG9, "one bundled face").
 *
 * Two families, both SIL Open Font License 1.1, each shipped beside its licence as Liberation is:
 *   · Barlow Condensed (Medium, SemiBold, Bold, ExtraBold) — `fonts/LICENSE_BARLOW_CONDENSED`. Every line
 *     that is not a headline, and the `rail` look's headline (ExtraBold).
 *   · Anton (Regular) — `fonts/LICENSE_ANTON`. The `ribbon` look's headline.
 * The files are the upstream `.ttf` builds from github.com/google/fonts (`ofl/barlowcondensed`, `ofl/anton`),
 * unmodified. They are read here from their bytes and registered by the overlay, so a host with no fonts
 * installed draws the same pixels — the reason Liberation is bundled, unchanged.
 *
 * `canDrawAd` is the fonts' OWN character maps intersected, as `pdfFonts.canDraw` is and for its reason: a word
 * must not print in one face and fall to an empty box in another. Both families hold Spanish (¡ ¿ ñ and the
 * accented vowels, upper and lower case — the overlay draws capitals).
 */

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "fonts");

export const AD_FACES = {
  medium: "BarlowCondensed-Medium.ttf",
  semibold: "BarlowCondensed-SemiBold.ttf",
  bold: "BarlowCondensed-Bold.ttf",
  extrabold: "BarlowCondensed-ExtraBold.ttf",
  anton: "Anton-Regular.ttf",
} as const;
export type AdFace = keyof typeof AD_FACES;

const BYTES = Object.fromEntries(
  (Object.keys(AD_FACES) as AdFace[]).map((f) => [f, readFileSync(join(FONT_DIR, AD_FACES[f]))]),
) as Record<AdFace, Buffer>;

const DRAWABLE: ReadonlySet<number> = (() => {
  const [first, ...rest] = (Object.keys(BYTES) as AdFace[]).map((f) => new Set<number>(fontkit.create(BYTES[f]).characterSet));
  return new Set([...first!].filter((c) => rest.every((s) => s.has(c))));
})();

export const adFontBytes = (face: AdFace): Buffer => BYTES[face];

export const canDrawAd = (ch: string): boolean => DRAWABLE.has(ch.codePointAt(0)!);
