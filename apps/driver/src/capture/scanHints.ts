import type { LiveEdgeBlocker, LiveEdgeCameraState, LiveEdgeDetection } from "../../modules/capture-native/LiveEdgeCameraView";

/**
 * The one line the scanner shows at the top (D-LED6): while the capture gate waits, what the driver
 * should do; while the outline traces, to hold still. One definition, used by the scanner screen and
 * the development prototype, so the two cannot drift. The blocker order is `LiveCaptureGate.swift`'s.
 */
export const SCAN_HINT: Record<LiveEdgeBlocker, string> = {
  noPage: "Point the camera at the page",
  offEdge: "Fit the whole page in the frame",
  tooFar: "Move closer",
  tilted: "Hold the phone flat above the page",
  lowResolution: "Move closer",
  focusing: "Focusing…",
  moving: "Hold still",
  settling: "Hold still",
};

export function scanHeadline(camera: LiveEdgeCameraState | null, detection: LiveEdgeDetection | null): string {
  if (camera?.status === "denied") return "Camera access is off. Turn it on in Settings.";
  if (camera?.status === "failed") return "The camera could not start. Close and try again.";
  if (!detection) return "Starting the camera";
  switch (detection.gate) {
    case "tracing":
      return "Hold still";
    case "capturing":
      return "Scanning…";
    case "captured":
      return "Page scanned";
    case "waiting":
      return SCAN_HINT[detection.blocker ?? "noPage"];
  }
}
