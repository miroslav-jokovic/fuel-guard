/**
 * The browser half of the web capture provider (A7).
 *
 * Kept behind an interface for the same reason `@silvicom/capture-engine` has a provider seam at all:
 * the decision — is this photograph good enough to upload? — is pure and must be testable without a
 * camera, a canvas or a GPU. The default implementation is browser-only; a test passes its own.
 */

export interface DecodedImage {
  width: number;
  height: number;
  source: CanvasImageSource;
  close(): void;
}

export interface EncodedImage {
  blob: Blob;
  width: number;
  height: number;
  mediaType: "image/webp" | "image/jpeg";
}

export interface WebImageIo {
  decode(file: File): Promise<DecodedImage>;
  encode(
    image: DecodedImage,
    targetLongEdgePx: number,
    format: "webp" | "jpeg",
    quality: number,
  ): Promise<EncodedImage>;
  sha256(blob: Blob): Promise<string>;
}

/**
 * ── HOW EXIF IS STRIPPED, AND WHY NO LIBRARY IS NEEDED ────────────────────────────────────────
 * Decoding to a bitmap and re-encoding through a canvas produces pixels and nothing else: the
 * original file's EXIF — which on a phone includes the GPS coordinates of wherever the driver
 * photographed their licence — cannot survive the round trip. That is a property of the pipeline
 * rather than a step somebody has to remember, which is the only kind of privacy guarantee worth
 * having.
 *
 * ⚠ `imageOrientation: "from-image"` is not optional. EXIF orientation is exactly the metadata being
 * discarded, so without it a portrait photograph from a phone re-encodes sideways — a legible licence
 * turned into one a recruiter has to tilt their head to read.
 */
export const browserImageIo: WebImageIo = {
  async decode(file: File): Promise<DecodedImage> {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      close: () => bitmap.close(),
    };
  },

  async encode(image, targetLongEdgePx, format, quality): Promise<EncodedImage> {
    const longEdge = Math.max(image.width, image.height);
    // Only ever downscale. Enlarging a small photograph would invent detail and, worse, would let it
    // past a resolution gate that is measured on the original for exactly that reason.
    const scale = longEdge > targetLongEdgePx ? targetLongEdgePx / longEdge : 1;
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot process the photo.");
    ctx.drawImage(image.source, 0, 0, width, height);

    const toBlob = (type: string): Promise<Blob | null> =>
      new Promise((resolve) => canvas.toBlob(resolve, type, quality / 100));

    if (format === "webp") {
      const webp = await toBlob("image/webp");
      // Safari encoded WebP only from 14, and a browser that cannot will hand back a PNG or null
      // rather than failing loudly. Checked by TYPE, not by truthiness, for that reason.
      if (webp && webp.type === "image/webp") return { blob: webp, width, height, mediaType: "image/webp" };
    }
    const jpeg = await toBlob("image/jpeg");
    if (!jpeg) throw new Error("This browser could not save the photo.");
    return { blob: jpeg, width, height, mediaType: "image/jpeg" };
  },

  async sha256(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  },
};

/**
 * Open the phone's camera and hand back one photograph.
 *
 * `capture="environment"` asks for the rear camera; `accept="image/*"` keeps the library available to
 * a driver who photographed their licence earlier. This is A7's v1 by decision (D-APP11): the native
 * camera app is already very good, it costs no bytes of JavaScript, and it works on every phone. A
 * `getUserMedia` + OpenCV auto-crop provider is a SECOND implementation behind this same seam, added
 * only if a measured re-shoot rate justifies its weight.
 */
export function pickPhotoFromCamera(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("capture", "environment");
    input.style.display = "none";

    let settled = false;
    const finish = (file: File | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };

    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    // Modern browsers fire `cancel` when the picker is dismissed. Where they do not, the promise
    // simply never settles and the caller's UI stays where it was — which is what dismissing a
    // camera should look like.
    input.addEventListener("cancel", () => finish(null));

    document.body.appendChild(input);
    input.click();
  });
}
