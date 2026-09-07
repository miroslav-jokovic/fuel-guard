/**
 * Expo config plugin — opt in to Android's predictive back gesture (DIRECTION-B-PLAN §6 P1.3).
 *
 * WHY THIS IS NOT OPTIONAL. `android:enableOnBackInvokedCallback` defaults to false, and on
 * Android 13+ that means the system routes the back gesture through the LEGACY `onBackPressed`
 * path: the driver gets no back-preview animation, and — the part that matters — the gesture is
 * handled by whatever last called `onBackPressed`, not by the predictive-back dispatcher React
 * Navigation registers with. Google has said the flag becomes a no-op (predictive back always on)
 * in a future release, so a build that has never run WITH it is a build whose back button has
 * never been tested in the mode it will eventually ship in.
 *
 * Set here rather than in `android.enableOnBackInvokedCallback`, because there is no such Expo
 * config key: the attribute lives on `<application>` in the manifest and nothing in @expo/config
 * writes it. This is the smallest honest way to get one attribute onto one element.
 *
 * VERIFIED BY: ci.yml's native-android job greps the MERGED release manifest for the attribute —
 * a plugin that silently stopped applying would otherwise look exactly like one that worked. The
 * BEHAVIOUR (ConfirmSheet closes, a modal route pops, a tab does not exit the app) is on P8's
 * device checklist; no machine here can see it.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const ATTRIBUTE = 'android:enableOnBackInvokedCallback';

/**
 * Exported for tests: takes the parsed manifest's `manifest` node and returns it with the
 * attribute set. Pure — the plugin wrapper is the only part that touches Expo.
 *
 * The JSDoc is load-bearing rather than decorative: apps/driver's eslint is type-aware, and an
 * untyped export reaches a `.ts` test as `any`, where every read of it is an error.
 *
 * @param {{ application?: { $?: Record<string, string> }[] }} manifest
 * @returns {{ application: { $: Record<string, string> }[] }}
 */
function setEnableOnBackInvokedCallback(manifest) {
  const application = manifest?.application?.[0];
  if (!application) {
    throw new Error(
      'AndroidManifest.xml has no <application> element — withPredictiveBack cannot apply.',
    );
  }
  application.$ = { ...application.$, [ATTRIBUTE]: 'true' };
  return manifest;
}

module.exports = function withPredictiveBack(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults.manifest = setEnableOnBackInvokedCallback(cfg.modResults.manifest);
    return cfg;
  });
};

module.exports.setEnableOnBackInvokedCallback = setEnableOnBackInvokedCallback;
module.exports.ATTRIBUTE = ATTRIBUTE;
