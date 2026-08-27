/**
 * @fuelguard/capture-engine — the self-built document scanner core (DCE design of record).
 *
 * Pure, reusable, platform-agnostic: public API contracts, the versioned + signed config, the §5
 * quality/legibility gate, and the provider seam. Built first in Silvicom 360 `apps/driver`; reused by the
 * standalone HazmatGuard driver app. All IO (native capture, OCR, crypto, storage) lives in the app
 * around this core.
 */
export * from "./contracts";
export * from "./config";
export * from "./gate";
export * from "./provider";
