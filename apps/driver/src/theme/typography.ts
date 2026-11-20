import type { TextStyle } from 'react-native';

/**
 * The driver app's type SYSTEM (Visual 2026 plan D-DV8, D-DV9, D-DV15; owner-approved 2026-11-20 on
 * the V1 mock). Every piece of text in the app takes its face, size, weight and figure style from
 * `textStyle()` — `AppText` for text, and any `TextInput` that shows a value — so a new screen cannot
 * set type any other way, and `lint:design` refuses font classes, `fontFamily` and `fontWeight`
 * outside `src/theme/`.
 *
 * TWO FACES, each with one job:
 *
 *   • The PLATFORM face (SF Pro on iOS, Roboto on Android) for everything a driver reads as words or
 *     compares as figures. It is the face the OS tunes for Dynamic Type and for each pixel density,
 *     and — the measured reason — it is the only face we have with TABULAR digits: fontTools reads no
 *     `tnum` feature in either Lexend or Big Shoulders (D-DV15, 2026-11-20). So a time in a list, a
 *     score in a column or a rank beside a name is set here, with `tabular-nums`.
 *
 *   • BIG SHOULDERS DISPLAY ExtraBold, the carrier's own ad face (silvicom-brand skill), for the two
 *     places the brand speaks: a screen title, and the ONE figure a screen is about (the appointment
 *     window on Today, a count on Documents). A lone figure never has to align with another, which is
 *     why the missing `tnum` does not matter there and would matter everywhere else.
 *
 * Lexend, Direction B's single face (D-DB3), retires: "one font family for everything" is on the
 * carrier brand's banned list, and its `tabular` promise was never kept by the font.
 */
export type TextVariant =
  | 'caption'
  | 'label'
  | 'supporting'
  | 'body'
  | 'rowTitle'
  | 'action'
  | 'navigationTitle'
  | 'screenTitle'
  | 'numericInline'
  | 'numericCompact'
  | 'numericHero';

/** A text variant's weight may be raised for emphasis inside its role; it never changes face. */
export type TextWeight = 'regular' | 'medium' | 'semibold' | 'bold';

/**
 * The display face's two loaded cuts; `app/_layout.tsx` loads exactly these. The files in
 * `assets/fonts/` are static instances (wght 800 and 900) of google/fonts
 * `ofl/bigshouldersdisplay/BigShouldersDisplay[wght].ttf` at commit 94ee6b8b (sha256 60e208dc…),
 * made with fontTools' `instancer` on 2026-11-20. Bundled rather than installed because the npm
 * package `@expo-google-fonts/big-shoulders-display` is deprecated, and its successor
 * `@expo-google-fonts/big-shoulders` ships the TEXT optical size (measured: "H" is 1015 units wide at
 * 800 against Display's 910), which is not the carrier's condensed ad face. OFL 1.1, no Reserved Font
 * Name; the licence is beside the files.
 */
export const DISPLAY_FACE = 'BigShouldersDisplay_800ExtraBold';
export const DISPLAY_FACE_BOLD = 'BigShouldersDisplay_900Black';

type Face = 'platform' | 'display';

interface VariantSpec {
  face: Face;
  fontSize: number;
  lineHeight: number;
  weight: TextWeight;
  tabular: boolean;
  uppercase?: boolean;
  letterSpacing?: number;
}

/**
 * Sizes follow the platform's own scale (iOS body is 17) so the app sits beside the system's text
 * rather than below it, and every one scales with the driver's text-size setting (D-DV9). Captions
 * start at 13, not 12: the smallest text in the app is read in a cab in daylight.
 *
 * `label` is the section heading in the V1 mock — sentence case, semibold, muted by tone. Its old
 * uppercase tracking is gone: a tracked small-caps kicker is on the banned list (D-DV14).
 */
export const TYPE: Record<TextVariant, VariantSpec> = {
  caption: { face: 'platform', fontSize: 13, lineHeight: 18, weight: 'regular', tabular: false },
  label: { face: 'platform', fontSize: 13, lineHeight: 18, weight: 'semibold', tabular: false },
  supporting: { face: 'platform', fontSize: 15, lineHeight: 20, weight: 'regular', tabular: false },
  body: { face: 'platform', fontSize: 17, lineHeight: 24, weight: 'regular', tabular: false },
  rowTitle: { face: 'platform', fontSize: 17, lineHeight: 22, weight: 'semibold', tabular: false },
  action: { face: 'platform', fontSize: 17, lineHeight: 22, weight: 'semibold', tabular: false },
  navigationTitle: { face: 'platform', fontSize: 17, lineHeight: 22, weight: 'semibold', tabular: false },
  screenTitle: { face: 'display', fontSize: 38, lineHeight: 38, weight: 'bold', tabular: false, uppercase: true, letterSpacing: 0.4 },
  numericInline: { face: 'platform', fontSize: 22, lineHeight: 28, weight: 'semibold', tabular: true },
  numericCompact: { face: 'platform', fontSize: 26, lineHeight: 32, weight: 'semibold', tabular: true },
  numericHero: { face: 'display', fontSize: 64, lineHeight: 60, weight: 'bold', tabular: false },
};

const WEIGHT: Record<TextWeight, TextStyle['fontWeight']> = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
};

/** Bold Text (the OS accessibility setting) steps every weight one up; bold has nowhere to go. */
const BOLDER: Record<TextWeight, TextWeight> = {
  regular: 'medium',
  medium: 'semibold',
  semibold: 'bold',
  bold: 'bold',
};

export interface TextStyleOptions {
  /** The OS Bold Text setting, from `useTheme()`. */
  boldText?: boolean;
  /** Raise the variant's weight for emphasis. Ignored by the display face, which has one cut. */
  weight?: TextWeight;
  /** Force tabular figures on a variant that is not tabular by definition. */
  tabular?: boolean;
}

/** The ONE way to get a text style. Pure, so it is unit-tested without a renderer. */
export function textStyle(variant: TextVariant, options: TextStyleOptions = {}): TextStyle {
  const spec = TYPE[variant];
  const style: TextStyle = { fontSize: spec.fontSize, lineHeight: spec.lineHeight };

  if (spec.face === 'display') {
    // Weight IS the family for a loaded custom face; Bold Text swaps to the Black cut.
    style.fontFamily = options.boldText ? DISPLAY_FACE_BOLD : DISPLAY_FACE;
  } else {
    const weight = options.weight ?? spec.weight;
    style.fontWeight = WEIGHT[options.boldText ? BOLDER[weight] : weight];
  }

  if (spec.uppercase) style.textTransform = 'uppercase';
  if (spec.letterSpacing !== undefined) style.letterSpacing = spec.letterSpacing;
  // The display face has no `tnum` (D-DV15): asking for it would be a promise the font cannot keep.
  if (spec.face === 'platform' && (spec.tabular || options.tabular)) style.fontVariant = ['tabular-nums'];
  return style;
}
