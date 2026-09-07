import { useRef, useState } from 'react';
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
import { discardScannerTempFiles, stageFile } from '@/data/fileStaging';
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
  const attemptRef = useRef(0);

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
    // Which attempt this is (Step 5.1). A ref, not state: it must not re-render the screen, and it
    // must survive the re-renders that setReasons causes between attempts. It counts attempts at THIS
    // document within one visit to this screen — a driver who backs out and returns starts again,
    // which is the honest reading, because the second visit is a new decision to photograph the page.
    attemptRef.current += 1;
    try {
      const result = await scanBol();
      const decision = decideCapture(result, MAX_PAGES);
      if (!decision.accepted) {
        // The scanner already wrote these to the OS cache and nothing else will ever delete them —
        // a driver re-shooting a glaring page five times would otherwise leave five orphans (F9).
        discardScannerTempFiles(decision.discardUris);
        setReasons(decision.reasons);
        return;
      }
      const loadId = newClientId();
      const documentIds = decision.pages.map(() => newClientId());
      const { payload, uploads } = buildCapturePayloads({ loadId, documentIds, pages: decision.pages, attempt: attemptRef.current });

      // Every file is copied into the sandbox BEFORE anything is queued, and the record is enqueued
      // only once all of them are there. The staging rule exists so that work a driver believes is
      // saved cannot evaporate (plan §13.8 / D12); a record referencing four files where only three
      // were copied would satisfy the letter of that and break its point.
      //
      // TWO files per page since Phase 4b on the native path — the untouched ORIGINAL and the
      // derivative that uploads for reading — and one on the JS fallback, which has a single image.
      // `stageFile`'s index disambiguates them within a page (0 = archive, 1 = original); the record
      // id part of the name is the page's own document id, so nothing collides across pages.
      // `stagedUris` is EVERY staged file, because that list is what the orphan sweep keeps and what
      // a confirmed delivery deletes — a staged file missing from it is a file swept away while the
      // record that needs it is still queued.
      const stagedUris: string[] = [];
      const stagedUploads = [];
      for (const [index, upload] of uploads.entries()) {
        const documentId = documentIds[index]!;
        const archiveUri = await stageFile(upload.archiveUri, documentId, 0);
        stagedUris.push(archiveUri);
        if (upload.originalUri === undefined) {
          stagedUploads.push({ archiveUri });
          continue;
        }
        const originalUri = await stageFile(upload.originalUri, documentId, 1);
        stagedUris.push(originalUri);
        stagedUploads.push({ archiveUri, originalUri });
      }
      payload.uploads = stagedUploads;

      // The record id is the FIRST page's document id rather than a fresh one: the outbox is keyed by
      // it, and reusing an id that already means something keeps a replay idempotent without a second
      // identifier nobody else can resolve.
      await enqueue({ id: documentIds[0]!, kind: HAZMAT_CAPTURE_KIND, payload, fileUris: stagedUris });

      // Only now: until the record exists, the scanner's temporaries were still the only copy of a
      // page. After it, the staged files are what the outbox uploads and these are redundant. Both
      // artifacts are named, not just the one that uploads first — the original is the larger file of
      // the two, and leaving it behind would be a multi-megabyte leak per page (F9).
      discardScannerTempFiles(uploads.flatMap((u) => (u.originalUri ? [u.archiveUri, u.originalUri] : [u.archiveUri])));

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
