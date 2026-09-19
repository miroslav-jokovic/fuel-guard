/**
 * Turning a mark into the PNG the carrier's packet will print (C2, D-HUI14).
 *
 * ── ⚠ WHY A MARK IS A PICTURE AND NOT A STRING ────────────────────────────────────────────────
 * `renderPacketOverlay` has always had two branches for a signature line: `embedPng` of a staged
 * capture when there is one, and `drawText` in `StandardFonts.HelveticaOblique` when there is not.
 * Until C2 only a DRAWN mark took the first branch, so a driver who typed their name got the second —
 * and that branch prints a slanted Helvetica, which is what a form field looks like, not what a
 * signature looks like.
 *
 * ⚠ **The adoption screen meanwhile previewed the typed name in a brush script** (`ui-rounded`,
 * `Segoe Script`, `Brush Script MT`), under copy that promised *"These go on the form exactly as they
 * look here."* Measured on 2026-09-19 by rendering `p03` with a typed mark and rasterising it: the
 * paper said `Marija Varmeda` in oblique Helvetica, the screen said it in a brush script, and the
 * component's own comment claimed it *"shows the marks in the face they will be PRINTED in"*. Three
 * statements, one of them on the one screen whose entire job is to be believed. `lint:comment-claims`
 * could not see it — it guards claims about TEST COVERAGE, and this was a claim about a font.
 *
 * ⚠ **So the fix is not a better font stack; it is to remove the second source of truth.** Every mark
 * the driver adopts — styled, drawn or uploaded — becomes a PNG here, is staged into the one
 * `signature_mark` slot, and is the thing `embedPng` puts on the paper. The preview then is not *like*
 * the print, it IS the print: the same bytes, scaled. A promise that cannot come apart because there is
 * nothing left to come apart.
 *
 * ⚠ **What did NOT change, and must not.** `signed_name` is still the signature of record on every row
 * (D-APP8), the typed-text branch is still there for when staging fails (A8b: a PNG that will not
 * upload may never stand between a driver and twenty-two signatures), and the packet gains no embedded
 * font — `packetOverlay.ts`'s argument for the standard-14 face is an argument about the PDF, and a
 * rasterised mark honours all three of its reasons: the pixels are in the document, nothing has to
 * resolve a font when it is opened, and it reproduces identically in ten years.
 *
 * ── ⚠ AND THE THREE INITIALS LINES DO NOT GET ONE (Q-HUI14) ───────────────────────────────────
 * `p05`, `p06` and `p09` still print typed HelveticaOblique, because `takesDrawing` in the overlay is
 * `mark === "signature"` and `application_captures` has one row per slot with no `initials_mark` in its
 * CHECK. That is a real gap, it is recorded rather than routed around, and the screen says so: the
 * confirm step shows the initials in the face they are actually printed in rather than in the face the
 * signature got. See §8 of `HIRING-MODULE-PLAN.md`.
 */

/** The rectangle of a canvas that has ink in it. Coordinates are inclusive of both edges. */
export interface InkBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The tightest box containing everything that is not transparent, or null for a blank canvas.
 *
 * ── ⚠ WHY EVERY MARK IS TRIMMED, WHICHEVER TAB MADE IT ────────────────────────────────────────
 * The overlay scales a mark by `DRAWN_MARK_MAX_HEIGHT / drawn.height`, so the HEIGHT OF THE IMAGE is
 * what decides how big the signature looks on the line. An untrimmed canvas is mostly empty space, and
 * that empty space counts: the same name in Great Vibes (tall loops, deep descenders) and in Caveat
 * (compact) would arrive at two different visual sizes for no reason a driver could see, and a
 * photograph of a signature on A4 would shrink to a smear because the paper around it is part of the
 * height.
 *
 * ⚠ **Trimming is also why there are no per-face metrics here, and there must not be.** The obvious
 * alternative is a table of em-scales and baselines, one row per face — four magic numbers that are
 * right until somebody adds a fifth face, and that nothing can test because the only check is looking
 * at it. Measuring the ink asks the renderer what it actually drew.
 *
 * ⚠ Pure, and separated from the canvas for exactly that reason: jsdom has no 2D context, so this is
 * the half a unit test can reach. The `Uint8ClampedArray` is RGBA in `getImageData` order.
 */
export function inkBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 8,
): InkBounds | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3]! <= alphaThreshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { left, top, right, bottom };
}

/**
 * Grow a box by `pad` without letting it leave the canvas.
 *
 * ⚠ The padding is not cosmetic. A trim that ends exactly on the ink clips the antialiased edge of a
 * stroke, which on a thin script face is most of the stroke — the descender of a `y` loses its tip and
 * the signature reads as though it were cut out with scissors.
 */
export function padBounds(
  bounds: InkBounds,
  pad: number,
  width: number,
  height: number,
): InkBounds {
  return {
    left: Math.max(0, bounds.left - pad),
    top: Math.max(0, bounds.top - pad),
    right: Math.min(width - 1, bounds.right + pad),
    bottom: Math.min(height - 1, bounds.bottom + pad),
  };
}

/**
 * Make a light background transparent, in place.
 *
 * ⚠ **This exists for the Upload tab and nothing else**, and it is the difference between a signature
 * and a sticker. A driver uploading a photograph or a scan of their signature hands us white paper with
 * ink on it, and `embedPng` draws every pixel it is given — so an untreated upload lands on the packet
 * as an opaque white rectangle sitting on top of the carrier's own signature line, which it hides.
 *
 * ⚠ **Luminance, not equality with white.** Paper photographed by a phone is never pure white — it is
 * a grey-beige gradient with a shadow down one side. A test for pure white removes nothing from a real
 * photograph, which is the failure that makes this look like it works on a screenshot and not on a
 * scan.
 *
 * ⚠ **A soft edge rather than a hard cut.** Everything above `light` goes fully transparent, everything
 * below `dark` is kept at full opacity, and the band between is faded in proportion. A hard threshold
 * turns the antialiased rim of every stroke into a staircase, which at the 18pt the overlay scales a
 * mark down to reads as a dotted line rather than a pen stroke.
 */
export function knockOutPaper(
  pixels: Uint8ClampedArray,
  dark = 110,
  light = 205,
): void {
  for (let i = 0; i < pixels.length; i += 4) {
    // Rec. 601 luma. The weights matter on a photograph: an equal-weight average reads a blue-ish
    // shadow as darker than it looks and leaves a bruise around the signature.
    const luma = 0.299 * pixels[i]! + 0.587 * pixels[i + 1]! + 0.114 * pixels[i + 2]!;
    const opacity = luma <= dark ? 1 : luma >= light ? 0 : (light - luma) / (light - dark);
    pixels[i + 3] = Math.round(pixels[i + 3]! * opacity);
  }
}

/**
 * How much to shrink an image so its long edge fits, never enlarging it.
 *
 * ⚠ Only ever downscale — `webImageIo.encode` says the same thing for the same reason. Enlarging a
 * small upload invents detail, and here it would also inflate the PNG past the 8 MB staging cap for a
 * picture that was already the right size.
 */
export function fitScale(width: number, height: number, maxEdge: number): number {
  const longEdge = Math.max(width, height);
  return longEdge > maxEdge ? maxEdge / longEdge : 1;
}
