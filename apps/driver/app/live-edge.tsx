import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Button, IconButton } from '@/components';
import { roleColors } from '@/theme/colors';
import { getCaptureConfig } from '@/capture/engine';
import { scanHeadline } from '@/capture/scanHints';
import {
  getLiveEdgeCameraView,
  type LiveEdgeCameraState,
  type LiveEdgeCapture,
  type LiveEdgeDetection,
} from '../modules/capture-native/LiveEdgeCameraView';

/**
 * Live edge camera (LIVE-EDGE-DETECTION-PLAN.md) — development builds only, reached from More → "Live
 * edge prototype". Point it at a page and it takes the photo itself, under the owner's capture gate
 * (D-LED6, 2026-11-23): no outline is drawn until the page is placed well enough to straighten and the
 * phone is still; then the outline traces itself around the page, and the trace's end takes the photo.
 * While the gate waits, the one line at the top says what to fix.
 *
 * The result card shows the straightened page so the owner can judge the gate on a phone. It is NOT
 * the product's capture: nothing is uploaded, and the page a driver sends is made by the capture
 * pipeline once L5 puts this camera behind the provider seam.
 *
 * Colours are the dark theme's roles because the ground is always a camera feed, whatever the phone's
 * appearance setting: the accent cyan reads against paper and table alike, as the outline must.
 */

export default function LiveEdgePrototype() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The prototype shows live stats, so it does re-render on detections — but at most twice a second,
  // never per event (S2.3, the same reason as app/scan.tsx).
  const [detection, setDetection] = useState<LiveEdgeDetection | null>(null);
  const lastShown = useRef(0);
  const onDetection = useCallback((e: { nativeEvent: LiveEdgeDetection }) => {
    const now = Date.now();
    if (now - lastShown.current < 500 && e.nativeEvent.gate !== 'captured') return;
    lastShown.current = now;
    setDetection(e.nativeEvent);
  }, []);
  const [camera, setCamera] = useState<LiveEdgeCameraState | null>(null);
  const [capture, setCapture] = useState<LiveEdgeCapture | null>(null);
  const [minPageLongEdgePx, setMinPageLongEdgePx] = useState<number | null>(null);

  // The resolution floor is the quality gate's own, read from the loaded (signed) capture config, so the
  // camera never shoots a page the gate would then refuse for size.
  useEffect(() => {
    let live = true;
    void getCaptureConfig().then((config) => {
      if (live) setMinPageLongEdgePx(config.gates.resolutionMinLongEdgePx);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!__DEV__) return <Redirect href="/home" />;

  const Camera = getLiveEdgeCameraView();
  const colors = roleColors.dark;

  return (
    <View className="flex-1 bg-hero">
      {Camera && minPageLongEdgePx !== null ? (
        <Camera
          style={{ flex: 1 }}
          strokeColor={colors.accent}
          fillColor={colors.accent.replace('rgb(', 'rgba(').replace(')', ', 0.12)')}
          successColor={colors.success}
          minPageLongEdgePx={minPageLongEdgePx}
          onDetection={onDetection}
          onCameraState={(e) => setCamera(e.nativeEvent)}
          onCapture={(e) => setCapture(e.nativeEvent)}
        />
      ) : Camera ? (
        <View className="flex-1" />
      ) : (
        <View className="flex-1 items-center justify-center p-6">
          <AppText tone="onHero" className="text-center">
            The live edge camera needs a build made after it was added (iPhone runtime 1.5.0, Android 1.6.0).
          </AppText>
        </View>
      )}

      <View className="absolute left-0 right-0 flex-row items-start justify-between px-4" style={{ top: insets.top + 8 }}>
        <View className="shrink gap-1 rounded-lg bg-hero/80 px-3 py-2">
          <AppText variant="label" tone="onHeroLive" weight="semibold">
            {scanHeadline(camera, detection)}
          </AppText>
          {detection ? (
            <AppText variant="caption" tone="onHeroSecondary" tabular>
              {`${detection.detectFps} detections/s · ${detection.latencyMs.toFixed(1)} ms · confidence ${detection.confidence.toFixed(2)}`}
            </AppText>
          ) : null}
        </View>
        <IconButton name="close" label="Close prototype" variant="glass" onPress={() => router.back()} />
      </View>

      {capture ? (
        <View className="absolute bottom-0 left-0 right-0 gap-3 rounded-t-2xl bg-hero px-4 pt-4" style={{ paddingBottom: insets.bottom + 12 }}>
          <View className="flex-row gap-3">
            <Image
              source={{ uri: capture.pageUri }}
              style={{ width: 120, height: Math.min(200, 120 * (capture.pageHeight / Math.max(1, capture.pageWidth))) }}
              resizeMode="contain"
            />
            <View className="shrink gap-1">
              <AppText tone="onHero" weight="semibold">
                Page straightened
              </AppText>
              <AppText variant="caption" tone="onHeroSecondary" tabular>
                {`Page ${Math.round(capture.pageWidth)} × ${Math.round(capture.pageHeight)} px`}
              </AppText>
              <AppText variant="caption" tone="onHeroSecondary" tabular>
                {`Photo ${Math.round(capture.photoWidth)} × ${Math.round(capture.photoHeight)} px`}
              </AppText>
            </View>
          </View>
          <Button label="Done" variant="secondary" onPress={() => setCapture(null)} />
        </View>
      ) : null}
    </View>
  );
}
