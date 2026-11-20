import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire("/Users/miroslavjokovic/Projects/FuelGuard/apps/api/package.json");
const { PDFDocument } = require("pdf-lib");
let sharp; try { sharp = require("sharp"); } catch { sharp = null; }
const jpg = sharp ? await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 10, b: 10 } } }).jpeg().toBuffer() : null;
async function build(upd) {
  const d = await PDFDocument.create({ updateMetadata: upd });
  if (jpg) { const img = await d.embedJpg(jpg); const p = d.addPage([64,64]); p.drawImage(img,{x:0,y:0,width:64,height:64}); } else d.addPage();
  return createHash("sha256").update(await d.save()).digest("hex").slice(0,16);
}
const a = await build(false); await new Promise(r=>setTimeout(r,1100)); const b = await build(false);
const c = await build(true); await new Promise(r=>setTimeout(r,1100)); const e = await build(true);
console.log({ jpg: !!jpg, noMeta_equal: a===b, meta_equal: c===e });
const d = await PDFDocument.create({ updateMetadata: false }); d.addPage();
const s = Buffer.from(await d.save()).toString("latin1"); console.log("has /ID:", /\/ID\s*\[/.test(s), "has CreationDate:", /CreationDate/.test(s), "Producer:", /Producer/.test(s));
