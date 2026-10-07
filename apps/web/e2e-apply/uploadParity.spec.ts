import { expect, test, type Page } from "@playwright/test";
import { pastTipsIfShown } from "./liveScanner";
import { partOneLink, stubApi, TOKEN, type Stub } from "./stubApi";

/**
 * The medical card three ways — the live scanner, the camera app, "Upload a photo instead" — in a real
 * browser under production's CSP (2026-10-07).
 *
 * The owner asked that taking a picture and uploading one differ in nothing that matters. Production
 * had never received a medical card: both test applications ended on "I don't have one yet". Upload
 * offered images only, so a certificate the clinic emailed as a PDF could not be chosen, and a file the
 * browser could not open was blamed on "the camera". Now a PDF's first page is drawn by pdfjs — a worker,
 * which only a page served with the real header can prove runs — and enters the same pipeline as a photo.
 *
 * ⚠ What still differs, on purpose: the scanner cuts its photograph to the outline, and a file is sent
 * whole. Nothing finds a page's edges in a picture the scanner did not frame (Q-AW53 (a), not built).
 */

const url = `/apply/${TOKEN}`;
const DONE = (slot: string) => ({ slot, contentType: "image/webp", bytes: 1000, capturedAt: "2026-09-28T15:00:00.000Z" });

function atMedicalCard(): Record<string, unknown> {
  const link = partOneLink({ captures: [DONE("cdl_front"), DONE("cdl_back")] }) as Record<string, unknown>;
  link.partOne = { ...(link.partOne as object), contact: true, address: true, licences: true, screening: true };
  link.identityComplete = true;
  return link;
}

/** A one-page, letter-size PDF with words on it — built by hand, offsets and all, so pdfjs reads it as written. */
function certificatePdf(): Buffer {
  const text = "BT /F1 28 Tf 72 700 Td (MEDICAL EXAMINER'S CERTIFICATE) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A phone's portrait photograph, textured enough to be a picture rather than a flat colour. */
async function phonePhoto(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = Object.assign(document.createElement("canvas"), { width: 3024, height: 4032 });
    const g = c.getContext("2d")!;
    for (let y = 0; y < 4032; y += 24) for (let x = 0; x < 3024; x += 24) {
      g.fillStyle = `rgb(${(x * 7) % 255},${(y * 3) % 255},${(x + y) % 255})`;
      g.fillRect(x, y, 24, 24);
    }
    return c.toDataURL("image/jpeg", 0.9).split(",")[1]!;
  });
  return Buffer.from(b64, "base64");
}

/** What the office receives: the last upload's type and pixel size, read back by the browser. */
async function lastSent(page: Page, stub: Stub): Promise<{ contentType: unknown; width: number; height: number }> {
  const confirm = stub.callsTo("PUT", /\/capture\/[^/]+$/).at(-1)!;
  const bytes = [...stub.state.uploads.values()].at(-1)!;
  const size = await page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
    return { width: bitmap.width, height: bitmap.height };
  }, bytes.toString("base64"));
  return { contentType: (confirm.body as { content_type?: unknown }).content_type, ...size };
}

async function choose(page: Page, button: string, file: { name: string; mimeType: string; buffer: Buffer }): Promise<string | null> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: button, exact: true }).click();
  const picker = await chooser;
  const accept = await picker.element().getAttribute("accept");
  await picker.setFiles(file);
  return accept;
}

async function send(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Use this photo" }).click();
  await expect(page.getByText("Received.")).toBeVisible();
}

test("a medical card the clinic emailed as a PDF is sent as a picture of its first page", async ({ page }) => {
  const stub = await stubApi(page, atMedicalCard());
  await page.goto(url);
  await expect(page.getByText(/If the clinic emailed it to you, upload the PDF/)).toBeVisible();

  const accept = await choose(page, "Upload a photo instead", { name: "medical-card.pdf", mimeType: "application/pdf", buffer: certificatePdf() });
  expect(accept).toBe("image/*,application/pdf");
  // Shown large first, like any photo: the driver sees which page goes before anything is sent.
  await expect(page.getByRole("button", { name: "Use this photo" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await send(page);

  const sent = await lastSent(page, stub);
  expect(sent.contentType).toMatch(/^image\/(webp|jpeg)$/);
  // The letter page's shape, at the long edge every photograph is sent at.
  expect(Math.max(sent.width, sent.height)).toBe(sent.height);
  expect(sent.width / sent.height).toBeCloseTo(8.5 / 11, 2);
});

test("the scanner, the camera app and an upload send the same kind of file at the same size", async ({ page }) => {
  const stub = await stubApi(page, atMedicalCard());
  await page.goto(url);

  // The scanner.
  await page.getByRole("button", { name: "Take photo", exact: true }).click();
  await pastTipsIfShown(page);
  await expect(page.locator("[data-live-shutter]")).toBeEnabled();
  await page.locator("[data-live-shutter]").click();
  await send(page);
  const scanned = await lastSent(page, stub);

  // The camera app, from inside the scanner.
  await page.getByRole("button", { name: "Take it again" }).click();
  await choose(page, "Camera app", { name: "image.jpg", mimeType: "image/jpeg", buffer: await phonePhoto(page) });
  await send(page);
  const cameraApp = await lastSent(page, stub);

  // An upload from the screen.
  await choose(page, "Upload a photo instead", { name: "IMG_0412.jpg", mimeType: "image/jpeg", buffer: await phonePhoto(page) });
  await send(page);
  const uploaded = await lastSent(page, stub);

  for (const sent of [cameraApp, uploaded]) {
    expect(sent.contentType).toBe(scanned.contentType);
    expect(Math.max(sent.width, sent.height)).toBe(Math.max(scanned.width, scanned.height));
  }
  // One confirm each: the same three calls, whichever button took it.
  expect(stub.callsTo("PUT", /\/capture\/[^/]+$/)).toHaveLength(3);
});

test("a file the browser cannot open says so, without blaming the camera", async ({ page }) => {
  await stubApi(page, atMedicalCard());
  await page.goto(url);
  // An iPhone's HEIC, which Chromium cannot decode.
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(64)]);
  await choose(page, "Upload a photo instead", { name: "IMG_5678.HEIC", mimeType: "image/heic", buffer: heic });
  await expect(page.getByRole("alert")).toHaveText("We could not open that picture. Take a new photo, or choose a different file.");
  await expect(page.getByRole("button", { name: "Use this photo" })).toHaveCount(0);
});
