import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Bring photographs into the labelled set (LIVE-EDGE-DETECTION-PLAN.md step L1).
 *
 *   pnpm --filter @silvicom/capture-engine edges:import -- <folder of photos>
 *
 * Copies every JPEG, PNG and HEIC in the folder into `fixtures/real/private/edges/photos/`, which is
 * gitignored (`fixtures/real/README.md`: a real document is PII and is never committed). Each copy is
 * NAMED BY ITS CONTENT HASH, because a phone's or a person's file name can carry a load number, a
 * customer or a driver — and a hash carries nothing, so a label file pointing at it can be shared.
 * The same photo imported twice lands on the same name once.
 *
 * HEIC (an iPhone's default) is converted to JPEG with macOS `sips`, because the labeller runs in a
 * browser and Chrome cannot show HEIC. The conversion keeps the EXIF orientation, and the label's id is
 * the hash of the JPEG that is stored — the file every later step reads.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DEST = resolve(HERE, "../../fixtures/real/private/edges/photos");
const ACCEPT = new Set([".jpg", ".jpeg", ".png", ".heic"]);

function main(): void {
  const src = process.argv.slice(2).find((a) => a !== "--");
  if (!src || !existsSync(src)) {
    console.error("✗ usage: edges:import <folder of photos>");
    process.exit(2);
  }
  mkdirSync(DEST, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "edges-import-"));
  let added = 0;
  let already = 0;
  try {
    for (const name of readdirSync(src).sort()) {
      const ext = extname(name).toLowerCase();
      if (!ACCEPT.has(ext)) continue;
      let path = join(src, name);
      let outExt = ext === ".jpeg" ? ".jpg" : ext;
      if (ext === ".heic") {
        const jpg = join(work, "converted.jpg");
        execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "best", path, "--out", jpg], { stdio: "ignore" });
        path = jpg;
        outExt = ".jpg";
      }
      const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
      const target = join(DEST, `${digest.slice(0, 16)}${outExt}`);
      if (existsSync(target)) {
        already++;
        continue;
      }
      copyFileSync(path, target);
      added++;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`✓ ${added} photos added, ${already} already there → ${DEST}`);
  console.log("  Next: open tools/edges/label.html in a browser and choose that folder.");
}

main();
