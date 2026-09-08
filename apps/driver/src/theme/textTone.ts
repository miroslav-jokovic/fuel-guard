/**
 * The text-colour vocabulary, as data.
 *
 * It lives in `theme/` rather than inside `AppText` so a test can import it without pulling in React
 * Native, which is the whole reason the bug it now guards went unseen: the contrast suite could only
 * reach `theme.roles.json`, so it asserted the pairings the design INTENDED and never the pairings
 * the components actually asked for. Those two sets had drifted apart in seven components.
 *
 * A tone names a role. Nothing else in the app may name a text colour: see TEXT_TONE_CLASS.
 */
export type TextTone =
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'subtle'
  | 'disabled'
  | 'inverse'
  | 'brand'
  | 'danger'
  | 'warning'
  | 'caution'
  | 'success'
  | 'info'
  | 'action'
  | 'accent'
  | 'onHero'
  | 'onHeroSecondary'
  | 'onHeroMuted'
  /**
   * The foreground for a SOLID amber or lavender fill — a badge count, a filled chip, the active
   * segment. It is `action-fg`, a fixed near-black held identical in all four appearances, because
   * both fills are light in every theme: a theme-relative `ink` lands on lavender at 1.30:1 in dark
   * and 1.34:1 in high-contrast dark. Five components asked for that colour through `className` and
   * none of them got it, which is why it is a tone now.
   */
  | 'onAction'
  /**
   * The same idea for the solid BRAND fill — the navy itinerary node, a filled brand chip. Split
   * from `onAction` because the two fills are not the same colour and their foregrounds are pinned
   * against different grounds by 'every solid fill and its foreground clear 4.5:1 in all four
   * appearances'.
   */
  | 'onBrand';

/**
 * Tone → colour class. This is the ONLY place a text colour is chosen; anything that needs the class
 * rather than the tone (an `Icon`, which parses `className` itself) derives it from here.
 *
 * Why a caller may not simply pass `className="text-danger"` to `AppText`: NativeWind resolves two
 * classes that set the same property by the CSS cascade, and its last tiebreaker is position in the
 * compiled stylesheet (`react-native-css-interop`'s specificityCompare → SpecificityIndex.Order).
 * Tailwind emits colour utilities ALPHABETICALLY, so `text-ink` — the class AppText always renders
 * for its default `primary` tone — is emitted after `text-accent*`, `text-action*`, `text-brand*`,
 * `text-caution`, `text-danger`, `text-hero*` and `text-info`, and silently beats every one of them.
 * Order inside the className STRING has no bearing on it whatsoever.
 *
 * That is measured, not theoretical. On 2026-09-07 `Avatar`, both unread-count badges, `Badge`,
 * `SegmentedControl`, `Banner` and `Itinerary` were each passing a colour this way. Five of the nine
 * soft tones lost their colour and four kept it, purely on where Tailwind happened to sort the name;
 * the unread counts rendered `ink` on amber, and the avatar initial rendered at 1.40:1 on its own
 * disc. The colour a component asks for is now the colour it gets, because exactly one class is in
 * play, and `lint:design` rejects the className form outright.
 */
export const TEXT_TONE_CLASS: Record<TextTone, string> = {
  primary: 'text-ink',
  secondary: 'text-ink-secondary',
  muted: 'text-ink-muted',
  subtle: 'text-ink-subtle',
  disabled: 'text-ink-disabled',
  inverse: 'text-ink-inverse',
  brand: 'text-brand',
  danger: 'text-danger',
  warning: 'text-warning',
  caution: 'text-caution',
  success: 'text-success',
  info: 'text-info',
  action: 'text-action-ink',
  accent: 'text-accent-ink',
  onHero: 'text-on-hero',
  onHeroSecondary: 'text-on-hero-secondary',
  onHeroMuted: 'text-on-hero-muted',
  onAction: 'text-action-fg',
  onBrand: 'text-brand-fg',
};

/** `text-ink-secondary` → `ink-secondary`. The class IS the role, prefixed; nothing is restated. */
export function roleOfTextTone(tone: TextTone): string {
  return TEXT_TONE_CLASS[tone].replace(/^text-/, '');
}
