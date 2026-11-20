import type { ComponentType } from 'react';
import { Platform, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';

/**
 * The live edge camera (LIVE-EDGE-DETECTION-PLAN.md step L0, D-LED2): our own viewfinder, with the
 * document outline drawn NATIVELY over the preview. Nothing per-frame crosses the bridge to draw it;
 * these events exist for the spike's readout and arrive at most ten times a second.
 *
 * iOS only until step L4: Android's module declares no view, so asking for one there would throw.
 * `getLiveEdgeCameraView()` answers null on Android, and on a binary built before this view existed.
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
  /** While tracking: the DRAWN-TOWARD corners (smoothed), TL/TR/BR/BL, as fractions of the view. */
  corners?: [number, number][];
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
  onDetection?: (event: NativeSyntheticEvent<LiveEdgeDetection>) => void;
  onCameraState?: (event: NativeSyntheticEvent<LiveEdgeCameraState>) => void;
}

let cached: ComponentType<LiveEdgeCameraViewProps> | null | undefined;

export function getLiveEdgeCameraView(): ComponentType<LiveEdgeCameraViewProps> | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'ios') return (cached = null);
  try {
    cached = requireNativeViewManager<LiveEdgeCameraViewProps>('CaptureNative');
  } catch {
    cached = null;
  }
  return cached;
}
