/**
 * Where a Bates footer goes on a page that may be turned on its side.
 *
 * Pure arithmetic, in its own file with no imports, because it is the one piece of this feature that
 * is silently wrong rather than loudly wrong: a scanned page frequently carries `/Rotate 90`, and
 * stamping at the page's own bottom-left then puts the export id running up the side of the printed
 * sheet. Nothing throws, nothing logs, and the defect only shows up on paper in front of an auditor.
 *
 * A viewer applies `/Rotate` clockwise. For each of the four lawful angles this returns the start
 * point and text rotation, in the page's OWN coordinates, such that the run lands `fromLeft` points
 * in from the visual left edge and `up` points above the visual bottom edge, reading horizontally.
 */
export interface FooterPlacement {
  x: number;
  y: number;
  /** Counter-clockwise degrees, as pdf-lib's `degrees()` takes them. */
  rotate: number;
}

export function footerPosition(
  angle: number,
  width: number,
  height: number,
  fromLeft: number,
  up: number,
): FooterPlacement {
  switch (((angle % 360) + 360) % 360) {
    case 90:
      // Turned clockwise: the page's +y axis runs along the visual x axis.
      return { x: width - up, y: fromLeft, rotate: 90 };
    case 180:
      return { x: width - fromLeft, y: height - up, rotate: 180 };
    case 270:
      return { x: up, y: height - fromLeft, rotate: 270 };
    default:
      return { x: fromLeft, y: up, rotate: 0 };
  }
}

/** The width and height of the printed sheet — swapped when the page is turned on its side. */
export function visibleSize(
  angle: number,
  width: number,
  height: number,
): { width: number; height: number } {
  const a = ((angle % 360) + 360) % 360;
  return a === 90 || a === 270 ? { width: height, height: width } : { width, height };
}
