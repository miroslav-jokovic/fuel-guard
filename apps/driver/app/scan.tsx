import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Button, IconButton } from '@/components';
import { roleColors } from '@/theme/colors';
import { getCaptureConfig } from '@/capture/engine';
import { scanHeadline } from '@/capture/scanHints';
import { cancelScanSession, currentScanRequest, finishScanSession } from '@/capture/scanSession';
import {
  getLiveEdgeCameraView,
  type LiveEdgeCameraState,
  type LiveEdgeDetection,
} from '../modules/capture-native/LiveEdgeCameraView';

/**
 * The scanner (D-LED6, owner 2026-11-23) — every document in the app is scanned here, on both phones: a
 * stop's BOL slot and the hazmat Capture BOL alike. Point the camera at the page; nothing is drawn until
 * the page is placed well enough to straighten and the phone is still; then the outline traces itself
 * around the page, and the trace's end takes the shot. Each page lands in the count at the bottom; the
 * next page is taken the same way once this one leaves the frame.
 *
 * Opened by a capture provider through `scanSession` (`liveEdgePageSource.ts`), which awaits the pages;
 * this screen only collects them. Every page then goes through the same processing, measurement and
 * quality gate as an OS-scanner page — this screen decides nothing about quality.
 *
 * Colours are the dark theme's roles because the ground is always a camera feed, whatever the phone's
 * appearance setting: the accent cyan reads against paper and table alike, as the outline must.
 */
const CAMERA_STYLE = { flex: 1 } as const;
const CAMERA_FILL = roleColors.dark.accent.replace('rgb(', 'rgba(').replace(')', ', 0.12)');

export default function Scanner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const request = useRef(currentScanRequest()).current;
  const maxPages = request?.maxPages ?? 1;
  // Detection events arrive ~10 a second. The screen shows ONE thing that depends on them — the
  // headline — so the events are kept in refs and the screen re-renders only when the headline's words
  // change (a few times per scan), not on every event. Measured on the Tab A9 2026-11-27 (S2.3,
  // scripts/mem-soak.mjs): a re-render per event let PSS climb ~8.6 MB/min on this screen.
  const detectionRef = useRef<LiveEdgeDetection | null>(null);
  const cameraRef = useRef<LiveEdgeCameraState | null>(null);
  const [headline, setHeadline] = useState(() => scanHeadline(null, null));
  const refreshHeadline = useCallback(() => {
    const next = scanHeadline(cameraRef.current, detectionRef.current);
    setHeadline((prev) => (prev === next ? prev : next));
  }, []);
  const onDetection = useCallback(
    (e: { nativeEvent: LiveEdgeDetection }) => {
      detectionRef.current = e.nativeEvent;
      refreshHeadline();
    },
    [refreshHeadline],
  );
  const onCameraState = useCallback(
    (e: { nativeEvent: LiveEdgeCameraState }) => {
      cameraRef.current = e.nativeEvent;
      refreshHeadline();
    },
    [refreshHeadline],
  );
  const [pages, setPages] = useState<string[]>([]);
  const [minPageLongEdgePx, setMinPageLongEdgePx] = useState<number | null>(null);
  const finished = useRef(false);

  // The resolution floor is the quality gate's own, from the loaded (signed) capture config, so the
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

  // Leaving by any way other than Done (a swipe, the system back, a replaced screen) is a close, so the
  // provider waiting on the session is never left hanging.
  useEffect(
    () => () => {
      if (!finished.current) cancelScanSession();
    },
    [],
  );

  const done = (taken: string[]) => {
    finished.current = true;
    finishScanSession(taken);
    router.back();
  };

  const close = () => {
    finished.current = true;
    cancelScanSession();
    router.back();
  };

  // The native view's callbacks stay the same function for the screen's life; the latest `onPage` is
  // read through a ref, so a new page never re-sends every prop to the camera.
  const onPageRef = useRef<(uri: string) => void>(() => undefined);
  const onCapture = useCallback((e: { nativeEvent: { pageUri: string } }) => onPageRef.current(e.nativeEvent.pageUri), []);
  const onPage = (uri: string) => {
    const next = [...pages, uri];
    setPages(next);
    // The last page the document may have ends the scan by itself — one tap fewer for a one-page slot.
    if (next.length >= maxPages) done(next);
  };
  onPageRef.current = onPage;

  const Camera = getLiveEdgeCameraView();
  const colors = roleColors.dark;
  const last = pages[pages.length - 1];

  return (
    <View className="flex-1 bg-hero">
      {!request ? (
        <View className="flex-1 items-center justify-center gap-4 p-6">
          <AppText tone="onHero" className="text-center">
            Open the scanner from the document you are sending.
          </AppText>
          <Button label="Close" variant="secondary" onPress={() => router.back()} />
        </View>
      ) : Camera && minPageLongEdgePx !== null ? (
        <Camera
          style={CAMERA_STYLE}
          strokeColor={colors.accent}
          fillColor={CAMERA_FILL}
          successColor={colors.success}
          minPageLongEdgePx={minPageLongEdgePx}
          onDetection={onDetection}
          onCameraState={onCameraState}
          onCapture={onCapture}
        />
      ) : (
        <View className="flex-1" />
      )}

      {request ? (
        <>
          <View className="absolute left-0 right-0 flex-row items-center justify-between gap-3 px-4" style={{ top: insets.top + 8 }}>
            <View className="shrink rounded-lg bg-hero/80 px-3 py-2">
              <AppText variant="label" tone="onHeroLive" weight="semibold" accessibilityLiveRegion="polite">
                {headline}
              </AppText>
            </View>
            <IconButton name="close" label="Close the scanner" variant="glass" onPress={close} />
          </View>

          <View
            className="absolute bottom-0 left-0 right-0 flex-row items-center justify-between gap-3 bg-hero/80 px-4 pt-3"
            style={{ paddingBottom: insets.bottom + 12 }}
          >
            <View className="flex-row items-center gap-3">
              {last ? <Image source={{ uri: last }} style={{ width: 40, height: 52, borderRadius: 4 }} resizeMode="cover" /> : null}
              <AppText tone="onHero" tabular>
                {pages.length === 0
                  ? maxPages === 1
                    ? 'One page'
                    : `Up to ${maxPages} pages`
                  : `${pages.length} of ${maxPages} ${maxPages === 1 ? 'page' : 'pages'}`}
              </AppText>
            </View>
            <Button label="Done" variant="primary" disabled={pages.length === 0} onPress={() => done(pages)} />
          </View>
        </>
      ) : null}
    </View>
  );
}
