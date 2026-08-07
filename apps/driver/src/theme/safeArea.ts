import { layout } from './tokens';

/**
 * Screen padding decisions that depend on the device's safe area (FR1).
 *
 * Lives in `theme/` rather than inside `Screen.tsx` for one practical reason: the driver app's test
 * config is pure-logic only (no React Native renderer), and a helper that sits next to a `react-native`
 * import cannot be tested at all. The rule below is exactly the kind of thing that should have a test,
 * because getting it wrong is invisible on a simulator and obvious on a phone.
 */

/**
 * Top padding for a screen.
 *
 * The safe-area inset is NOT optional and never was — `padTop` controls the 16pt visual gutter, and
 * nothing else. It used to control both, which is how nine screens ended up drawing under the Android
 * status bar: each renders its own `ScreenHeader` and passes `padTop={false}` to mean "my header owns
 * the top spacing", and the inset went out with the gutter. Under `edgeToEdgeEnabled` the app draws
 * behind the system bars, so the header landed under the clock on settings, gallery, stop capture,
 * hazmat, both message screens, notifications, check-in and end-shift — every screen but the tabs.
 *
 * The inset belongs to the SHELL, not to `ScreenHeader`: six screens (three of them tabs) render that
 * header inside a default-`padTop` screen, so adding the inset there would double-pad them. A header
 * component cannot know whether it is the first thing on a screen. The shell can.
 */
export function screenTopPadding(insetTop: number, padTop: boolean): number {
  return insetTop + (padTop ? layout.screenInset : 0);
}
