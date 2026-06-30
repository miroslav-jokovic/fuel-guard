/**
 * Compress an image File to WebP at or under a size budget before upload (audit H7).
 * Keeps receipt photos small so the free-tier Storage bucket doesn't fill up. Browser-only.
 */
export async function compressToWebp(
  file: File,
  maxBytes = 200_000,
  maxDim = 1600,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, width, height);

  let quality = 0.8;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > maxBytes && quality > 0.3) {
    quality -= 0.1;
    blob = await canvasToBlob(canvas, quality);
  }
  return blob;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Image encoding failed"))),
      "image/webp",
      quality,
    );
  });
}
