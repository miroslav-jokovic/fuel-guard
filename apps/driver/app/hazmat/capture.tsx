import { useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Banner, Button, Card, Screen, ScreenHeader, SectionLabel } from "@/components";
import { enqueue, newClientId } from "@/data/outbox";
import { stageFile } from "@/data/fileStaging";
import { HAZMAT_CAPTURE_KIND } from "@/data/handlers";
import { scanBol } from "@/capture/engine";
import { buildCapturePayload, decideCapture } from "@/features/hazmat/hazmatCaptureModel";

/**
 * M6 driver capture screen. Scan → §5 gate (on-device) → on reject show the reason + re-shoot; on accept
 * stage the file, enqueue the replay-safe capture, and open the verdict view. Works offline — the outbox
 * drains on reconnect (M6.2).
 */
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
    } catch (e) {
      setReasons([e instanceof Error ? e.message : "Capture failed — retake."]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScreenHeader title="Capture BOL" subtitle="Photograph the bill of lading for a hazmat check" onBack={() => router.back()} />
      <View style={{ gap: 16 }}>
        <Card>
          <SectionLabel>How it works</SectionLabel>
          <Text>
            Line up the whole bill of lading in good light. We check the photo is readable before uploading,
            then run the compliance verdict. You can capture offline — it syncs when you reconnect.
          </Text>
        </Card>
        {reasons.length > 0 ? <Banner tone="warning" message={reasons.join("\n")} /> : null}
        <Button
          label={busy ? "Working…" : "Capture BOL"}
          onPress={() => {
            void onCapture();
          }}
          loading={busy}
          disabled={busy}
          block
        />
      </View>
    </Screen>
  );
}
