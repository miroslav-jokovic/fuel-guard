import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";

/**
 * The faces an ad's words are drawn in (ADS-AD-LOOK-PLAN D-ADL2, D-ADL18). Until 2026-11-10 an ad used the PDF
 * face, Liberation Sans (`pdfFonts.ts`); from then until 2026-11-12, Barlow Condensed and Anton. The owner's
 * verdict on that second set ("font weights are not really appropriate", and a generic look overall) and the
 * same day's research put the ads in ONE family at two weights: Big Shoulders, drawn for the City of Chicago,
 * where Silvicom is based (`.claude/skills/silvicom-brand/SKILL.md`).
 *
 * Both files are SIL Open Font License 1.1 (`fonts/LICENSE_BIG_SHOULDERS`), cut from the upstream variable fonts
 * at github.com/google/fonts (`ofl/bigshouldersdisplay`, `ofl/bigshoulderstext`) with `fonttools varLib.instancer`
 * at one weight each, otherwise unmodified:
 *   · `display` — Big Shoulders Display, wght 900. Every headline and the Number look's figure.
 *   · `text`    — Big Shoulders Text, wght 500. The supporting line, the phone and the legal line.
 * Static instances rather than the variable files because the canvas draws a variable font at its default
 * instance; a named weight is only certain in a file that holds one. They are read here from their bytes and
 * registered by the overlay, so a host with no fonts installed draws the same pixels.
 *
 * `canDrawAd` is the two files' OWN character maps intersected, as `pdfFonts.canDraw` is and for its reason: a
 * word must not print in one face and fall to an empty box in the other. Both hold Spanish (¡ ¿ ñ and the
 * accented vowels in both cases) and ¢. Against the faces they replace, they lose only ten characters no ad
 * writes (ĳ ǥ ǩ ǯ ȟ Ȩ ȩ ʒ Δ Ω), measured 2026-11-12.
 */

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "fonts");

export const AD_FACES = {
  display: "BigShouldersDisplay-Black.ttf",
  text: "BigShouldersText-Medium.ttf",
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
