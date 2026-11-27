import type { ComponentType } from 'react';
import { Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';

/**
 * The live edge camera (LIVE-EDGE-DETECTION-PLAN.md step L0, D-LED2): our own viewfinder, with the
 * document outline drawn NATIVELY over the preview. Nothing per-frame crosses the bridge to draw it;
 * the view also decides when to take the photo (the capture gate, D-LED6) and reports why it is waiting.
 * Detection events arrive at most ten times a second, plus one on every gate transition.
 *
 * Both phones since step L4 (2026-11-25): iOS's `LiveEdgeCameraView.swift` and Android's
 * `LiveEdgeCameraView.kt` take the same props and send the same events. `getLiveEdgeCameraView()`
 * answers null on a binary built before the view existed (iOS runtime < 1.5.0, Android < 1.6.0).
 */

export interface LiveEdgeDetection {
  /** `tracking` once three valid detections in a row have drawn the outline; `searching` otherwise. */
  state: 'searching' | 'tracking';
  /** Detections completed in the last second. */
  detectFps: number;
  /** From the frame's capture to the detector's answer, milliseconds. */
  latencyMs: number;
  /** The detector's own confidence for the last accepted outline, 0–1. */
  confidence: number;
  gate: LiveEdgeGatePhase;
  /** Present while `gate` is `waiting`. */
  blocker?: LiveEdgeBlocker;
  /** While tracking: the DRAWN-TOWARD corners (smoothed), TL/TR/BR/BL, as fractions of the view. */
  corners?: [number, number][];
}

/**
 * Why the capture gate is not taking the photo (D-LED6, `LiveCaptureGate.swift`). `settling` is every
 * condition met while the page has not yet held still long enough for the trace to start.
 */
export type LiveEdgeBlocker =
  | 'noPage'
  | 'offEdge'
  | 'tooFar'
  | 'tilted'
  | 'lowResolution'
  | 'focusing'
  | 'moving'
  | 'settling';

/** The capture gate's phase: waiting on a blocker, tracing the outline, taking the photo, or done. */
export type LiveEdgeGatePhase = 'waiting' | 'tracing' | 'capturing' | 'captured';

/** The photo the gate took, and the page straightened from it. Both are files in the app's cache. */
export interface LiveEdgeCapture {
  originalUri: string;
  pageUri: string;
  photoWidth: number;
  photoHeight: number;
  pageWidth: number;
  pageHeight: number;
}

export interface LiveEdgeCameraState {
  status: 'ready' | 'denied' | 'failed';
  detail?: string;
}

export interface LiveEdgeCameraViewProps extends ViewProps {
  /** False pauses the camera without unmounting the view. */
  active?: boolean;
  /** Any CSS colour string — a design-system role colour, not a literal. */
  strokeColor?: string;
  fillColor?: string;
  /** The outline's colour from the moment the photo is asked for. */
  successColor?: string;
  /**
   * The quality gate's resolution floor (`CaptureConfig.gates.resolutionMinLongEdgePx`): the gate will not
   * shoot a page whose straightened long edge would be smaller. Pass it from the loaded config.
   */
  minPageLongEdgePx: number;
  onCapture?: (event: NativeSyntheticEvent<LiveEdgeCapture>) => void;
  onDetection?: (event: NativeSyntheticEvent<LiveEdgeDetection>) => void;
  onCameraState?: (event: NativeSyntheticEvent<LiveEdgeCameraState>) => void;
}

let cached: ComponentType<LiveEdgeCameraViewProps> | null | undefined;

export function getLiveEdgeCameraView(): ComponentType<LiveEdgeCameraViewProps> | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return (cached = null);
  try {
    cached = requireNativeViewManager<LiveEdgeCameraViewProps>('CaptureNative');
  } catch {
    cached = null;
  }
  return cached;
}
