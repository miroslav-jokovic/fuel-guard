import { useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import {
  ActionBar,
  AppText,
  Banner,
  Button,
  GroupedList,
  ListRow,
  OfflineBanner,
  Screen,
  ScreenHeader,
  SectionLabel,
  Skeleton,
} from '@/components';
import { enqueue, newClientId } from '@/data/outbox';
import { stageFile } from '@/data/fileStaging';
import { HAZMAT_CAPTURE_KIND } from '@/data/handlers';
import { scanBol } from '@/capture/engine';
import { buildCapturePayloads, decideCapture } from '@/features/hazmat/hazmatCaptureModel';
import { useFeatures } from '@/session/useFeatures';

/** Matches the server's MAX_BOL_PAGES (D19 spend cap): 10 pages x 2 models is the ceiling one load
 *  may cost. Passed to both the scanner and the decision so one number governs both — iOS cannot
 *  enforce it at the scanner, so the decision is where it actually binds. */
const MAX_PAGES = 10;

const CAPTURE_GUIDANCE = [
  ['image', 'Show all four document edges'],
  ['content_copy', 'Scan every page of the document'],
  ['light_mode', 'Use even light and avoid glare'],
  ['check_circle', 'Keep printed text sharp and readable'],
] as const;

export default function HazmatCaptureScreen() {
  const router = useRouter();
  const features = useFeatures();
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);

  if (features.isLoaded && !features.enabled('hazmat.capture')) return <Redirect href="/home" />;
  if (!features.isLoaded) {
    return (
      <Screen padTop={false}>
        <ScreenHeader title="Capture BOL" onBack={() => router.back()} />
        <Skeleton className="h-28 w-full rounded-xl" />
      </Screen>
    );
  }

  const onCapture = async (): Promise<void> => {
    setBusy(true);
    setReasons([]);
    try {
      const result = await scanBol();
      const decision = decideCapture(result, MAX_PAGES);
      if (!decision.accepted) {
        setReasons(decision.reasons);
        return;
      }
      const loadId = newClientId();
      const documentIds = decision.pages.map(() => newClientId());
      const { payload, localUris } = buildCapturePayloads({ loadId, documentIds, pages: decision.pages });

      // Every page is copied into the sandbox BEFORE anything is queued, and the record is enqueued
      // only once all of them are there. The staging rule exists so that work a driver believes is
      // saved cannot evaporate (plan §13.8 / D12); a record referencing four files where only three
      // were copied would satisfy the letter of that and break its point.
      const stagedUris: string[] = [];
      for (const [index, uri] of localUris.entries()) {
        stagedUris.push(await stageFile(uri, documentIds[index]!, index));
      }

      // The record id is the FIRST page's document id rather than a fresh one: the outbox is keyed by
      // it, and reusing an id that already means something keeps a replay idempotent without a second
      // identifier nobody else can resolve.
      await enqueue({ id: documentIds[0]!, kind: HAZMAT_CAPTURE_KIND, payload, fileUris: stagedUris });
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
        subtitle="Scan every page. Each one is checked for quality before it uploads"
        onBack={() => router.back()}
      />
      <OfflineBanner />
      {reasons.length > 0 ? <Banner tone="warning" message={reasons.join(' · ')} /> : null}

      <SectionLabel>Before you capture</SectionLabel>
      <GroupedList>
        {CAPTURE_GUIDANCE.map(([icon, label]) => (
          <ListRow key={label} icon={icon} title={label} />
        ))}
      </GroupedList>

      <Banner
        tone="info"
        icon="cloud_done"
        message="You can capture without signal. Analysis begins automatically after the document syncs."
      />
    </Screen>
  );
}
