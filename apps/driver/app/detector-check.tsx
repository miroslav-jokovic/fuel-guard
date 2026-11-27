import { useEffect, useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { AppText } from '@/components';
import { getCaptureNativeModule } from '../modules/capture-native';

/**
 * Development builds only: the on-device half of the live-edge model check (LIVE-EDGE-DETECTION-PLAN
 * §8 "Open check", 2026-11-27). `scripts/check-device-detector.mjs` pushes SmartDoc frames into the
 * app's files folder and opens `fuelguard://detector-check?dir=…&files=…`; this screen runs the shipped
 * detector on each and logs one `DETECTOR_CHECK` line per frame, which the script holds to the ONNX
 * fixture. The fixture never enters the app.
 */
export default function DetectorCheck() {
  const { dir, files } = useLocalSearchParams<{ dir?: string; files?: string }>();
  const [status, setStatus] = useState('Running…');

  useEffect(() => {
    if (!__DEV__) return;
    const mod = getCaptureNativeModule();
    if (!mod?.detectImageForTest || !dir || !files) {
      setStatus('Nothing to check (needs an Android debug build, dir and files).');
      return;
    }
    void (async () => {
      for (const name of files.split(',')) {
        try {
          const r = await mod.detectImageForTest!(`${dir}/${name}`);
          console.log(`DETECTOR_CHECK ${JSON.stringify({ name, ...r })}`);
        } catch (e) {
          console.log(`DETECTOR_CHECK ${JSON.stringify({ name, error: e instanceof Error ? e.message : String(e) })}`);
        }
      }
      console.log('DETECTOR_CHECK_DONE');
      setStatus('Done.');
    })();
  }, [dir, files]);

  if (!__DEV__) return <Redirect href="/home" />;
  return (
    <View className="flex-1 items-center justify-center bg-hero p-6">
      <AppText tone="onHero">{status}</AppText>
    </View>
  );
}
