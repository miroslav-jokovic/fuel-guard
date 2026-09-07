import { describe, expect, it } from 'vitest';
import { heroTopPadding, screenBottomPadding, screenTopPadding } from '@/theme/safeArea';
import { layout } from '@/theme/tokens';

/**
 * FR1 — the first real device install found every header except the tabs drawing under the Android
 * status bar.
 *
 * Cause: `padTop` gated BOTH the visual gutter and the safe-area inset, and nine screens pass
 * `padTop={false}` because each renders its own `ScreenHeader` and means "my header owns the top
 * spacing". With `edgeToEdgeEnabled` the app draws behind the system bars, so those nine lost the
 * status-bar clearance along with the gutter.
 *
 * The property worth pinning is not the arithmetic — it is that a safe area is never a style choice.
 */
describe('screenTopPadding', () => {
  it('always clears the safe area, gutter or no gutter', () => {
    expect(screenTopPadding(48, false)).toBeGreaterThanOrEqual(48);
    expect(screenTopPadding(48, true)).toBeGreaterThanOrEqual(48);
  });

  it('padTop adds the gutter and nothing else', () => {
    expect(screenTopPadding(48, true) - screenTopPadding(48, false)).toBe(layout.screenInset);
  });

  it('a screen owning its own header still clears the status bar — the FR1 regression', () => {
    // Before the fix this returned `layout.screenInset` (16), which is less than any real Android
    // status bar, so the header sat under the clock.
    expect(screenTopPadding(48, false)).toBe(48);
  });

  it('is stable on a device that reports no inset', () => {
    expect(screenTopPadding(0, false)).toBe(0);
    expect(screenTopPadding(0, true)).toBe(layout.screenInset);
  });

  it('starts the navy hero under the status bar with a breath, not a gutter', () => {
    // The hero is the top of the screen rather than content placed on it, so it takes no 20pt
    // gutter — but it must not butt against the clock either.
    expect(heroTopPadding(48)).toBe(48 + 8);
    expect(heroTopPadding(0)).toBe(8);
    expect(heroTopPadding(48) - screenTopPadding(48, false)).toBe(8);
    // A hero always starts higher than a gutter screen, on every real inset.
    expect(heroTopPadding(48)).toBeLessThan(screenTopPadding(48, true));
  });

  it('ends scroll content with one section, not a decorative tab-sized void', () => {
    expect(screenBottomPadding(34, false)).toBe(34 + layout.sectionGap);
    expect(screenBottomPadding(34, true)).toBe(layout.screenInset);
    expect(screenBottomPadding(34, false, true)).toBe(layout.sectionGap);
  });
});
