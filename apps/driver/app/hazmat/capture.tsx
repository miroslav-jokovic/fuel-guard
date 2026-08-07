import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  ActionBar,
  AppText,
  Banner,
  Button,
  Icon,
  OfflineBanner,
  Screen,
  ScreenHeader,
  SectionLabel,
} from '@/components';
import { enqueue, newClientId } from '@/data/outbox';
import { stageFile } from '@/data/fileStaging';
import { HAZMAT_CAPTURE_KIND } from '@/data/handlers';
import { scanBol } from '@/capture/engine';
import { buildCapturePayload, decideCapture } from '@/features/hazmat/hazmatCaptureModel';

const CAPTURE_GUIDANCE = [
  ['image', 'Show all four document edges'],
  ['light_mode', 'Use even light and avoid glare'],
  ['check_circle', 'Keep printed text sharp and readable'],
] as const;

export default function HazmatCaptureScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);

  const onCapture = async (): Promise<void> => {
    setBusy(true);
    setReasons([]);
    try {
      const result = await scanBol();
      const decision = decideCapture(result);
      if (!decision.accepted || !decision.page) {
        setReasons(decision.reasons);
        return;
      }
      const loadId = newClientId();
      const documentId = newClientId();
      const { payload, localUri } = buildCapturePayload({ loadId, documentId, pageNumber: 1, page: decision.page });
      const stagedUri = await stageFile(localUri, documentId, 0);
      await enqueue({ id: documentId, kind: HAZMAT_CAPTURE_KIND, payload, fileUris: [stagedUri] });
      router.replace(`/hazmat/${loadId}` as never);
    } catch (error) {
      setReasons([error instanceof Error ? error.message : 'Capture failed. Retake the document.']);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      padTop={false}
      footer={
        <ActionBar>
          <Button
            label="Open document scanner"
            size="lg"
            icon="photo_camera"
            onPress={() => { void onCapture(); }}
            loading={busy}
            disabled={busy}
          />
          <AppText variant="caption" tone="subtle" className="pb-1 text-center">Saved locally before upload</AppText>
        </ActionBar>
      }
    >
      <ScreenHeader
        title="Capture BOL"
        subtitle="The image is checked for quality before it uploads"
        onBack={() => router.back()}
      />
      <OfflineBanner />
      {reasons.length > 0 ? <Banner tone="warning" message={reasons.join(' · ')} /> : null}

      <SectionLabel>Before you capture</SectionLabel>
      <View className="overflow-hidden rounded-xl border border-edge-subtle bg-surface">
        {CAPTURE_GUIDANCE.map(([icon, label], index) => (
          <View key={label}>
            <View className="min-h-[52px] flex-row items-center gap-3 px-4 py-2.5">
              <Icon name={icon} size={20} className="text-ink-secondary" />
              <AppText variant="body" className="flex-1">{label}</AppText>
            </View>
            {index < CAPTURE_GUIDANCE.length - 1 ? <View className="ml-4 h-px bg-edge-subtle" /> : null}
          </View>
        ))}
      </View>

      <Banner
        tone="info"
        icon="cloud_done"
        message="You can capture without signal. Analysis begins automatically after the document syncs."
      />
    </Screen>
  );
}
