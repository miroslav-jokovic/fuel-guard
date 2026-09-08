import { describe, expect, it } from 'vitest';
import { describeScanner, type ScannerFacts } from '@/features/scanner/scannerSettingsModel';

const config = {
  configVersion: '2026.09.1',
  analysis: { longEdgePx: 1600 },
  gates: {
    blurLaplacianVarMin: null,
    glareClippedFractionMax: null,
    shadowRangeMax: null,
    coverageMinFraction: null,
    brightnessMeanRange: null,
    contrastRmsMin: null,
    resolutionMinLongEdgePx: 1200,
    overallAcceptScoreMin: 0.6,
  },
} as ScannerFacts['config'];

const base: ScannerFacts = {
  platform: 'ios',
  support: { camera: true, docScanner: true, ocr: true, deviceModel: 'iPhone14,3', osVersion: '26.3' },
  config,
  pendingUploads: 0,
};

describe('scanner settings — which scanner this phone uses', () => {
  it('names the system scanner when the native probe says it can scan', () => {
    const view = describeScanner(base);
    expect(view.scanner[0]!.title).toBe('System document scanner');
    expect(view.scanner[0]!.subtitle).toMatch(/Apple/);
    expect(view.scanner[0]!.tone).toBe('success');
  });

  it('falls back to the camera when there is no native module at all', () => {
    const view = describeScanner({ ...base, support: null });
    expect(view.scanner[0]!.title).toBe('Built-in camera');
    expect(view.scanner[0]!.subtitle).toMatch(/no system scanner/);
  });

  it('says why when the camera or the scanner is missing', () => {
    expect(describeScanner({ ...base, support: { camera: false, docScanner: false, ocr: false } }).scanner[0]!.subtitle)
      .toMatch(/camera permission/);
    expect(describeScanner({
      ...base, platform: 'android',
      support: { camera: true, docScanner: false, ocr: false, scannerModule: 'unavailable' },
    }).scanner[0]!.subtitle).toMatch(/Play services/);
  });

  it('tells an Android driver the module downloads once on first capture', () => {
    const view = describeScanner({
      ...base, platform: 'android',
      support: { camera: true, docScanner: true, ocr: true, scannerModule: 'pending_download' },
    });
    expect(view.scanner[0]!.subtitle).toMatch(/downloads the first time/);
  });

  it('reads text recognition from the probe, not from the platform', () => {
    expect(describeScanner(base).scanner[1]!.tone).toBe('success');
    expect(describeScanner({ ...base, support: { camera: true, docScanner: true, ocr: false } }).scanner[1]!.subtitle)
      .toMatch(/Not available/);
  });
});

describe('scanner settings — rules and device', () => {
  it('prints the resolution floor and the rules version from the delivered config', () => {
    const view = describeScanner(base);
    expect(view.rules.map((r) => r.key)).toEqual(['wifi', 'resolution', 'version']);
    expect(view.rules[1]!.subtitle).toMatch(/1,200 pixels/);
    expect(view.rules[2]!.subtitle).toMatch(/2026\.09\.1/);
  });

  it('says the rules have not loaded rather than inventing a version', () => {
    const view = describeScanner({ ...base, config: null });
    expect(view.rules.map((r) => r.key)).toEqual(['wifi', 'version']);
    expect(view.rules[1]!.subtitle).toMatch(/Not loaded yet/);
  });

  it('counts what is waiting for Wi-Fi, singular and plural', () => {
    expect(describeScanner({ ...base, pendingUploads: 1 }).rules[0]!.subtitle).toMatch(/^1 item waiting/);
    expect(describeScanner({ ...base, pendingUploads: 3 }).rules[0]!.subtitle).toMatch(/^3 items waiting/);
    expect(describeScanner({ ...base, pendingUploads: 3 }).rules[0]!.tone).toBe('action');
    expect(describeScanner(base).rules[0]!.tone).toBe('neutral');
  });

  it('never prints an empty device string as if it were a model', () => {
    const view = describeScanner({ ...base, support: { camera: true, docScanner: true, ocr: true, deviceModel: '' } });
    expect(view.device[0]!.subtitle).toBe('Not reported by this build');
    expect(view.device[1]!.subtitle).toBe('Not reported by this build');
    expect(describeScanner(base).device[0]!.subtitle).toBe('iPhone14,3');
  });
});
