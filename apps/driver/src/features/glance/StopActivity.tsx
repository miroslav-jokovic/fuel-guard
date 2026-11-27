import type { LiveActivityFactory } from 'expo-widgets';
import type { GlanceProps } from './glanceModel';

/**
 * Live Activities are iOS's (`StopActivity.ios.tsx`). Android has no equivalent in `expo-widgets`; its
 * glance is the home-screen widget (Q-DV5 ruling: Android 16 Live Updates later, in the feature plan).
 *
 * `.tsx`, not `.ts`, on purpose: Metro tries every platform for one extension before the next
 * extension, so a `StopActivity.ts` beside `StopActivity.ios.tsx` won on iOS too and the Live
 * Activity never started (V9, measured).
 */
const StopActivity: LiveActivityFactory<GlanceProps> | null = null;
export default StopActivity;
