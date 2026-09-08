import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Card, ListRow, Screen, ScreenHeader, Section, Skeleton, AppText } from '@/components';
import { getCaptureConfig } from '@/capture/engine';
import { describeScanner, type ScannerFacts, type SettingsRow } from '@/features/scanner/scannerSettingsModel';
import { useSyncState } from '@/data/sync';
import { useFeatures } from '@/session/useFeatures';
import { getCaptureNativeModule } from '../modules/capture-native';

/**
 * Scanner settings (D-DB14, 2026-09-07) — what this phone will do when a driver captures a
 * document, stated rather than offered. There are no switches here on purpose: every capture rule
 * is signed fleet configuration (SCANNER-UPGRADE-PLAN.md), and a toggle the server ignores is a
 * lie in a settings screen. What a driver CAN learn here is which scanner they have, why the
 * original waits for Wi-Fi, and what the phone reports about itself.
 *
 * The facts come from the same probe the capture engine runs at bootstrap, so this screen and the
 * scanner cannot disagree; every sentence is `scannerSettingsModel`, which is tested.
 */
export default function ScannerSettings() {
  const router = useRouter();
  const features = useFeatures();
  const { pending } = useSyncState();
  const [facts, setFacts] = useState<Omit<ScannerFacts, 'pendingUploads'> | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const native = getCaptureNativeModule();
      const support = native ? await native.isSupported().catch(() => null) : null;
      const config = await getCaptureConfig().catch(() => null);
      if (!active) return;
      const platform: ScannerFacts['platform'] =
        Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other';
      setFacts({ platform, support, config });
    })();
    return () => {
      active = false;
    };
  }, []);

  if (features.isLoaded && !features.enabled('hazmat.capture')) return <Redirect href="/more" />;

  const view = facts ? describeScanner({ ...facts, pendingUploads: pending }) : null;

  return (
    <Screen padTop={false} flow="sections">
      <ScreenHeader title="Scanner settings" subtitle="How documents are captured on this phone" onClose={() => router.back()} />

      <Section title="Scanner">
        {view ? <Rows rows={view.scanner} /> : <Skeleton className="w-full rounded-xl" style={{ height: 128 }} />}
      </Section>

      <Section title="Capture rules">
        {view ? <Rows rows={view.rules} /> : <Skeleton className="w-full rounded-xl" style={{ height: 192 }} />}
        <AppText variant="caption" tone="subtle" className="pb-2 text-center">
          Rules are set by your fleet and apply on every phone; there is nothing to switch here.
        </AppText>
      </Section>

      <Section title="This phone">
        {view ? <Rows rows={view.device} /> : <Skeleton className="w-full rounded-xl" style={{ height: 128 }} />}
      </Section>
    </Screen>
  );
}

function Rows({ rows }: { rows: readonly SettingsRow[] }) {
  return (
    <Card padded={false}>
      {rows.map((row, index) => (
        <View key={row.key}>
          <ListRow icon={row.icon} disc={row.tone} title={row.title} subtitle={row.subtitle} />
          {index < rows.length - 1 ? <View className="ml-18 h-px bg-edge-subtle" /> : null}
        </View>
      ))}
    </Card>
  );
}
