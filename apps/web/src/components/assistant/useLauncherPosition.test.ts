import { describe, expect, it } from "vitest";
import { clampOffset, dockAnchor } from "./useLauncherPosition";

const viewport = { width: 1280, height: 800 };

describe("dockAnchor", () => {
  it("opens from the bottom-right when the launcher is home", () => {
    expect(dockAnchor({ right: 24, bottom: 24 }, 52, viewport)).toEqual({ x: "right", y: "bottom", xPx: 24, yPx: 24 });
  });

  it("opens from the top-left when the launcher was moved there, measured from those edges", () => {
    // left = 1280 − 1180 − 52 = 48, top = 800 − 700 − 52 = 48.
    expect(dockAnchor({ right: 1180, bottom: 700 }, 52, viewport)).toEqual({ x: "left", y: "top", xPx: 48, yPx: 48 });
  });

  it("splits on the launcher's centre, not its edge", () => {
    // Centre at x = 1280 − 590 − 26 = 664 > 640: still the right half.
    expect(dockAnchor({ right: 590, bottom: 24 }, 52, viewport).x).toBe("right");
    expect(dockAnchor({ right: 620, bottom: 24 }, 52, viewport).x).toBe("left");
  });
});

describe("clampOffset", () => {
  it("leaves an on-screen position alone", () => {
    expect(clampOffset({ right: 300, bottom: 200 }, 52, viewport)).toEqual({ right: 300, bottom: 200 });
  });

  it("pulls a position parked on a larger screen back inside a smaller one", () => {
    expect(clampOffset({ right: 2400, bottom: 1500 }, 52, viewport)).toEqual({ right: 1220, bottom: 740 });
  });

  it("stops at the sidebar's edge rather than sliding beneath it", () => {
    // 1280 − 272 (an expanded sidebar) − 52 − 8 = 948.
    expect(clampOffset({ right: 2400, bottom: 24 }, 52, { ...viewport, left: 272 }).right).toBe(948);
  });

  it("never lets the launcher touch an edge", () => {
    expect(clampOffset({ right: -40, bottom: 0 }, 52, viewport)).toEqual({ right: 8, bottom: 8 });
  });
});
