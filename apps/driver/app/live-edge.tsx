import { useState } from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, IconButton } from '@/components';
import { roleColors } from '@/theme/colors';
import {
  getLiveEdgeCameraView,
  type LiveEdgeCameraState,
  type LiveEdgeDetection,
} from '../modules/capture-native/LiveEdgeCameraView';

/**
 * Live edge prototype (LIVE-EDGE-DETECTION-PLAN.md step L0) — development builds only, reached from
 * More → "Live edge prototype". A viewfinder and nothing else: point it at a page and the outline
 * draws itself around it. It takes no photo and nothing here is used by a real capture.
 *
 * The readout is what L0 is for: detections per second and the time from a frame's capture to its
 * answer, read off a real phone, beside the VisionKit scanner the Documents tab opens today. Those two
 * numbers and the owner's eye decide what L1 builds next.
 *
 * Colours are the dark theme's roles because the ground is always a camera feed, whatever the phone's
 * appearance setting: the accent cyan reads against paper and table alike, as the outline must.
 */
export default function LiveEdgePrototype() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [detection, setDetection] = useState<LiveEdgeDetection | null>(null);
  const [camera, setCamera] = useState<LiveEdgeCameraState | null>(null);

  if (!__DEV__) return <Redirect href="/home" />;

  const Camera = getLiveEdgeCameraView();
  const colors = roleColors.dark;

  return (
    <View className="flex-1 bg-hero">
      {Camera ? (
        <Camera
          style={{ flex: 1 }}
          strokeColor={colors.accent}
          fillColor={colors.accent.replace('rgb(', 'rgba(').replace(')', ', 0.12)')}
          onDetection={(e) => setDetection(e.nativeEvent)}
          onCameraState={(e) => setCamera(e.nativeEvent)}
        />
      ) : (
        <View className="flex-1 items-center justify-center p-6">
          <AppText tone="onHero" className="text-center">
            The live edge camera is iPhone-only until step L4, and needs a build made after it was added.
          </AppText>
        </View>
      )}

      <View className="absolute left-0 right-0 flex-row items-start justify-between px-4" style={{ top: insets.top + 8 }}>
        <View className="gap-1 rounded-lg bg-hero/80 px-3 py-2">
          <AppText variant="label" tone="onHeroLive" weight="semibold">
            {camera?.status === 'denied'
              ? 'Camera access is off'
              : camera?.status === 'failed'
                ? `Camera failed: ${camera.detail ?? 'unknown'}`
                : detection?.state === 'tracking'
                  ? 'Page found'
                  : 'Looking for a page'}
          </AppText>
          <AppText variant="caption" tone="onHeroSecondary" tabular>
            {detection
              ? `${detection.detectFps} detections/s · ${detection.latencyMs.toFixed(1)} ms · confidence ${detection.confidence.toFixed(2)}`
              : 'Starting the camera'}
          </AppText>
        </View>
        <IconButton name="close" label="Close prototype" variant="glass" onPress={() => router.back()} />
      </View>
    </View>
  );
}
