import type { CaptureConfig } from '@silvicom/capture-engine';
import type { NativeSupport } from '../../../modules/capture-native';
import type { Tone } from '@/components/tone';
import type { MaterialSymbolName } from '@/theme/materialSymbols.generated';

/**
 * What the Scanner settings screen says, decided here so `apps/driver/tests/scanner-settings-model.test.ts`
 * can pin every sentence. Nothing on that screen is a switch: the scanner programme's rules are
 * signed fleet configuration (SCANNER-UPGRADE-PLAN.md D-SCAN1, D-SCAN10, D-SCAN11), so the screen
 * TELLS a driver what this phone will do and never offers a toggle the server would ignore.
 *
 * The inputs are exactly what the capture engine already probes at bootstrap — the native
 * support answer and the delivered config — so this screen and the scanner cannot disagree.
 */
export type ScannerPlatform = 'ios' | 'android' | 'other';

export interface ScannerFacts {
  platform: ScannerPlatform;
  /** `null` when this binary has no native module or the probe threw. */
  support: NativeSupport | null;
  /** `null` when the config could not be loaded (offline first run). */
  config: Pick<CaptureConfig, 'configVersion' | 'analysis' | 'gates'> | null;
  /** Outbox records still to send, which includes originals waiting for Wi-Fi (D-SCAN11). */
  pendingUploads: number;
}

export interface SettingsRow {
  key: string;
  title: string;
  subtitle: string;
  icon: MaterialSymbolName;
  tone: Tone;
}

export interface ScannerSettingsView {
  scanner: SettingsRow[];
  rules: SettingsRow[];
  device: SettingsRow[];
}

const SYSTEM_SCANNER: Record<ScannerPlatform, string> = {
  ios: 'Apple’s document scanner finds the page edges and captures several pages in one go.',
  android: 'Google’s document scanner finds the page edges and captures several pages in one go.',
  other: 'The system document scanner finds the page edges and captures several pages in one go.',
};

export function describeScanner(facts: ScannerFacts): ScannerSettingsView {
  const { support, config, platform } = facts;
  const scanner: SettingsRow[] = [];

  if (!support) {
    scanner.push({
      key: 'scanner',
      title: 'Built-in camera',
      subtitle: 'This build has no system scanner, so pages are photographed one at a time.',
      icon: 'photo_camera',
      tone: 'neutral',
    });
  } else if (support.camera && support.docScanner) {
    const pending = platform === 'android' && support.scannerModule === 'pending_download';
    scanner.push({
      key: 'scanner',
      title: 'System document scanner',
      subtitle: pending
        ? 'Google’s scanner module downloads the first time you capture — about 300 KB, once.'
        : SYSTEM_SCANNER[platform],
      icon: 'qr_code_scanner',
      tone: 'success',
    });
  } else {
    scanner.push({
      key: 'scanner',
      title: 'Built-in camera',
      subtitle: !support.camera
        ? 'No camera is available to this app. Check the camera permission in your phone’s settings.'
        : platform === 'android' && support.scannerModule === 'unavailable'
          ? 'Google Play services is not available on this phone, so pages are photographed one at a time.'
          : 'The system scanner is not supported on this phone, so pages are photographed one at a time.',
      icon: 'photo_camera',
      tone: 'warning',
    });
  }

  scanner.push({
    key: 'ocr',
    title: 'Text recognition',
    subtitle: support?.ocr
      ? 'Printed text is read on this phone before the page is sent, so a blurred page is caught before it leaves.'
      : 'Not available on this phone. Pages are checked on the server after they upload.',
    icon: 'visibility',
    tone: support?.ocr ? 'success' : 'neutral',
  });

  const rules: SettingsRow[] = [
    {
      key: 'wifi',
      title: 'Full-resolution originals wait for Wi-Fi',
      subtitle:
        facts.pendingUploads > 0
          ? `${facts.pendingUploads} ${facts.pendingUploads === 1 ? 'item' : 'items'} waiting to send. The compliance check runs on the smaller copy right away.`
          : 'The compliance check runs on a smaller copy right away; the original uploads when you reach Wi-Fi.',
      icon: 'wifi',
      tone: facts.pendingUploads > 0 ? 'action' : 'neutral',
    },
  ];
  if (config) {
    rules.push({
      key: 'resolution',
      title: 'Minimum page sharpness',
      subtitle: `A page needs at least ${config.gates.resolutionMinLongEdgePx.toLocaleString()} pixels on its long edge; anything smaller is asked to be retaken.`,
      icon: 'image',
      tone: 'neutral',
    });
    rules.push({
      key: 'version',
      title: 'Capture rules',
      subtitle: `Version ${config.configVersion}, set by your fleet.`,
      icon: 'verified_user',
      tone: 'neutral',
    });
  } else {
    rules.push({
      key: 'version',
      title: 'Capture rules',
      subtitle: 'Not loaded yet. They arrive with the first capture on a connection.',
      icon: 'verified_user',
      tone: 'neutral',
    });
  }

  const device: SettingsRow[] = [
    {
      key: 'model',
      title: 'Phone',
      subtitle: support?.deviceModel && support.deviceModel.length > 0 ? support.deviceModel : 'Not reported by this build',
      icon: 'badge',
      tone: 'neutral',
    },
    {
      key: 'os',
      title: 'System',
      subtitle: support?.osVersion && support.osVersion.length > 0 ? support.osVersion : 'Not reported by this build',
      icon: 'info',
      tone: 'neutral',
    },
  ];

  return { scanner, rules, device };
}
