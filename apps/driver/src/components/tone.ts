import type { TextTone } from '@/theme/textTone';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

/**
 * The one tone vocabulary shared by chips, row discs, banners, toasts, progress bars and confirm
 * sheets (D-DB6). It lives here rather than inside `Badge` because a disc and a chip for the same
 * meaning must be the same two colours, and that only holds if there is one table.
 *
 * `ghost` is hero-only: a translucent white fill that exists because a `neutral` chip is invisible
 * on navy. `action` is the safety amber; `brand` is the lavender.
 */
export type Tone =
  | 'neutral'
  | 'brand'
  | 'action'
  | 'danger'
  | 'caution'
  | 'warning'
  | 'success'
  | 'info'
  | 'ghost';

/**
 * Soft fill + strong foreground: the pairing used by every disc and every non-solid chip.
 *
 * The foreground is a `TextTone`, not a colour class, and the field is named `textTone` rather than
 * `text` for a reason worth the rename: while it held a class, every consumer passed it to
 * `<AppText className={…}>`, where NativeWind's cascade discarded it in favour of AppText's own
 * default `text-ink` (see TEXT_TONE_CLASS). Five of the nine tones lost their colour that way and
 * four kept it, purely on where Tailwind happened to sort the class name. A tone cannot lose that
 * argument, and anything needing the class — `Icon`, which parses `className` itself — derives it.
 */
export const TONE_SOFT: Record<Tone, { bg: string; textTone: TextTone }> = {
  neutral: { bg: 'bg-surface-muted', textTone: 'secondary' },
  brand: { bg: 'bg-accent-soft', textTone: 'accent' },
  action: { bg: 'bg-action-soft', textTone: 'action' },
  info: { bg: 'bg-accent-soft', textTone: 'accent' },
  success: { bg: 'bg-success-soft', textTone: 'success' },
  danger: { bg: 'bg-danger-soft', textTone: 'danger' },
  warning: { bg: 'bg-warning/12', textTone: 'warning' },
  caution: { bg: 'bg-caution/12', textTone: 'caution' },
  ghost: { bg: 'bg-on-hero/10', textTone: 'onHero' },
};

/** Solid fills, for a progress bar or a filled node — never for text behind it. */
export const TONE_SOLID: Record<Tone, string> = {
  neutral: 'bg-ink-muted',
  brand: 'bg-brand',
  action: 'bg-action',
  info: 'bg-info',
  success: 'bg-success',
  danger: 'bg-danger',
  warning: 'bg-warning',
  caution: 'bg-caution',
  ghost: 'bg-on-hero',
};

/** The default glyph a tone carries when a caller does not name one. */
export const TONE_ICON: Record<Tone, MaterialSymbolName> = {
  neutral: 'info',
  brand: 'info',
  action: 'bolt',
  info: 'info',
  success: 'check_circle',
  danger: 'error',
  warning: 'warning',
  caution: 'warning',
  ghost: 'info',
};

/**
 * Chip appearance (D-DB2/D-DB6): the soft pairings, with the two SOLID fills overriding them.
 * `brand` is the lavender fill and `action` the amber one, and both carry `onAction` — a fixed
 * near-black — because a theme-relative ink lands on lavender at 1.30:1 in the dark appearances.
 *
 * It lived inside `Badge.tsx` until 2026-09-07, where nothing could test it: the file imports React
 * Native, so the contrast suite could not reach the pairing and the comment above it asserted a
 * protection that the cascade had already thrown away. Here,
 * 'every solid fill and its foreground clear 4.5:1 in all four appearances' reads it directly.
 */
export const TONE_CHIP: Record<Tone, { bg: string; textTone: TextTone }> = {
  ...TONE_SOFT,
  brand: { bg: 'bg-accent', textTone: 'onAction' },
  action: { bg: 'bg-action', textTone: 'onAction' },
};

export function severityTone(sev: 'critical' | 'high' | 'medium' | 'low'): Tone {
  return sev === 'critical' ? 'danger' : sev === 'high' ? 'caution' : sev === 'medium' ? 'warning' : 'neutral';
}
