/**
 * Registers a glance layout without letting a native failure reach the driver. The layouts register at
 * module scope, which runs while the app starts: one bad prop once made `createWidget` throw there and
 * the whole app showed a red screen instead of Sign in (V9, D-DV25). A glance that failed to register is
 * a missing widget, not a broken app, so this returns null and `glanceSync` skips it.
 */
export function guarded<T>(register: () => T): T | null {
  try {
    return register();
  } catch (error) {
    if (__DEV__) console.warn('[glance] a widget layout could not be registered:', error);
    return null;
  }
}
