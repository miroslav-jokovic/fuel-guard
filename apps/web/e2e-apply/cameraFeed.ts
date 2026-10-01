import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";
import { aamvaStandardExample } from "../src/features/apply/capture/aamvaStandardExample";

/**
 * The phone camera the browser specs point at a licence (2026-09-30): Chromium's fake capture device, playing
 * a video of a card held under the lens.
 *
 * ── TWO CARDS, TWO PROJECTS ────────────────────────────────────────────────────────────────────
 * A browser has ONE fake camera, fixed at launch, so each card is its own Playwright project
 * (`playwright.apply.config.ts`). `PLAIN_CARD` has no barcode: every existing walk photographs through the
 * live scanner with it, pressing the shutter, and nothing it shows can fill an answer those walks then type.
 * `BARCODE_CARD` carries the AAMVA standard's own example (§D.13, `aamvaStandardExample`) as a real PDF417,
 * for `scanner.spec.ts` — the back must take ITSELF and fill Part 1 from what it read.
 *
 * ── HOW THE FRAMES ARE MADE ────────────────────────────────────────────────────────────────────
 * Drawn by Chromium in a canvas and saved as JPEG, and the video is those JPEGs end to end — the MJPEG
 * Chromium's `--use-file-for-fake-video-capture` plays (measured 2026-09-30: the pixels arrive under the
 * production CSP). No image library: the browser that will look at the card is the one that draws it.
 *
 * ⚠ PORTRAIT, 2160×3840 — an upright phone at 4K. The scanner's aspect-neutral request gets it whole
 * (`LIVE_CONSTRAINTS`); the card is ~80% of the frame's width, inside the outline's 88%, as a driver holds it.
 */

const DIR = join(tmpdir(), "silvicom-e2e-apply");
export const PLAIN_CARD = join(DIR, "cdl-plain.mjpeg");
export const BARCODE_CARD = join(DIR, "cdl-barcode.mjpeg");

/** Launch flags that make `getUserMedia` answer with `feed`, and say yes without a prompt. */
export const fakeCamera = (feed: string): string[] => [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  `--use-file-for-fake-video-capture=${feed}`,
];

const HERE = dirname(fileURLToPath(import.meta.url));
const ANNEX = join(HERE, "../../../docs/plans/recruitment/aamva/annex-d-12-13.txt");
const FRAMES = 3;

async function pdf417PngBase64(): Promise<string> {
  const wasm = readFileSync(createRequire(import.meta.url).resolve("zxing-wasm/writer/zxing_writer.wasm"));
  prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer }, fireImmediately: false });
  const drawn = await writeBarcode(aamvaStandardExample(readFileSync(ANNEX, "utf8")), { format: "PDF417", scale: 4 });
  if (drawn.error || !drawn.image) throw new Error(`PDF417 not drawn: ${drawn.error}`);
  return Buffer.from(await drawn.image.arrayBuffer()).toString("base64");
}

export default async function globalSetup(): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  const barcode = await pdf417PngBase64();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const frame = (withBarcode: boolean): Promise<string> =>
      page.evaluate(
        async ({ withBarcode, barcode }) => {
          const W = 2160;
          const H = 3840;
          const c = document.createElement("canvas");
          c.width = W;
          c.height = H;
          const g = c.getContext("2d")!;
          // A cab seat: dark, with enough texture that the frame has edges to score.
          for (let y = 0; y < H; y += 40) {
            for (let x = 0; x < W; x += 40) {
              const v = 30 + ((x * 13 + y * 7) % 40);
              g.fillStyle = `rgb(${v},${v},${v + 8})`;
              g.fillRect(x, y, 40, 40);
            }
          }
          // The card: ID-1 (85.60 × 53.98 mm), 80% of the frame's width, in the middle.
          const cw = Math.round(W * 0.8);
          const ch = Math.round((cw * 53.98) / 85.6);
          const cx = (W - cw) / 2;
          const cy = (H - ch) / 2;
          g.fillStyle = "rgb(236,238,242)";
          g.beginPath();
          g.roundRect(cx, cy, cw, ch, 60);
          g.fill();
          g.fillStyle = "rgb(20,24,32)";
          if (withBarcode) {
            const img = new Image();
            img.src = `data:image/png;base64,${barcode}`;
            await img.decode();
            const bw = cw * 0.86;
            const bh = (img.height / img.width) * bw;
            g.imageSmoothingEnabled = false;
            g.drawImage(img, cx + (cw - bw) / 2, cy + (ch - bh) / 2, bw, bh);
          } else {
            g.font = "bold 96px sans-serif";
            g.fillText("COMMERCIAL DRIVER LICENSE", cx + 80, cy + 180);
            g.font = "64px sans-serif";
            for (const [i, line] of ["SAMPLE, MICHAEL JOHN", "DOB 06/06/1986", "CLASS A"].entries()) {
              g.fillText(line, cx + 80, cy + 420 + i * 110);
            }
          }
          return c.toDataURL("image/jpeg", 0.92).split(",")[1]!;
        },
        { withBarcode, barcode },
      );
    for (const [path, withBarcode] of [[PLAIN_CARD, false], [BARCODE_CARD, true]] as const) {
      const jpeg = Buffer.from(await frame(withBarcode), "base64");
      writeFileSync(path, Buffer.concat(Array.from({ length: FRAMES }, () => jpeg)));
    }
  } finally {
    await browser.close();
  }
}
