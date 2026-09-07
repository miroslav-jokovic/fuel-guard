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

/** Soft fill + strong foreground: the pairing used by every disc and every non-solid chip. */
export const TONE_SOFT: Record<Tone, { bg: string; text: string }> = {
  neutral: { bg: 'bg-surface-muted', text: 'text-ink-secondary' },
  brand: { bg: 'bg-accent-soft', text: 'text-accent-ink' },
  action: { bg: 'bg-action-soft', text: 'text-action-ink' },
  info: { bg: 'bg-accent-soft', text: 'text-accent-ink' },
  success: { bg: 'bg-success-soft', text: 'text-success' },
  danger: { bg: 'bg-danger-soft', text: 'text-danger' },
  warning: { bg: 'bg-warning/12', text: 'text-warning' },
  caution: { bg: 'bg-caution/12', text: 'text-caution' },
  ghost: { bg: 'bg-on-hero/10', text: 'text-on-hero' },
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

export function severityTone(sev: 'critical' | 'high' | 'medium' | 'low'): Tone {
  return sev === 'critical' ? 'danger' : sev === 'high' ? 'caution' : sev === 'medium' ? 'warning' : 'neutral';
}
