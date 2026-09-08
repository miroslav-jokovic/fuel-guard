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
  });

  it('clears the floating tab shell, because the scene now passes under it', () => {
    /**
     * The shell used to be an opaque `bg-canvas` band the scene ended above, so a tab screen needed
     * no bottom allowance at all — this asserted exactly `sectionGap` for that case. It is now
     * transparent and floats over the scene (owner ruling 2026-09-08), so the same 24pt would leave
     * the last row of every list sitting under a 60pt capsule, unreadable and untappable.
     */
    const shellHeight = 106; // what BottomTabBarHeightContext reports on a 34pt-inset device
    expect(screenBottomPadding(34, false, shellHeight)).toBe(shellHeight + layout.sectionGap);
    // The safe-area inset is NOT added on top: the shell already sits on it, and adding both was
    // the 34pt of dead space this padding was written to avoid in the first place.
    expect(screenBottomPadding(34, false, shellHeight)).toBeLessThan(shellHeight + 34 + layout.sectionGap);
    // A footer still owns its own spacing, tab bar or not.
    expect(screenBottomPadding(34, true, shellHeight)).toBe(layout.screenInset);
  });
});
