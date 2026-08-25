import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { readReportGrid } from "./reportGrid";

/**
 * Reading a genuine Excel 97-2003 binary (BIFF8) — the format the carrier's daily Pilot price report
 * actually arrives in, and the one that was rejected at the dropzone until now.
 *
 * ⚠ The fixture is written BY SheetJS rather than being a real vendor file, so this proves the decode
 * path works on well-formed BIFF8; it does NOT prove the Pilot report's particular quirks parse. That
 * needs one real file, and there is no substitute for it.
 */

// Relative to the package root — vitest runs with cwd = apps/web, and `import.meta.url` is not a file
// URL under its module runner.
const VENDOR = resolve(process.cwd(), "vendor/sheetjs/xlsx.mjs");

describe("the vendored SheetJS build", () => {
  it("is the exact file recorded in vendor/sheetjs/README.md", () => {
    // Vendored because npm's newest xlsx (0.18.5) carries two unpatched high-severity advisories and
    // the vendor's CDN cannot be integrity-checked by pnpm. The digest IS the integrity check, so a
    // silent edit — or a careless upgrade — fails here rather than shipping.
    const digest = createHash("sha256").update(readFileSync(VENDOR)).digest("hex");
    expect(digest).toBe("1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db");
  });
});

/** Build a BIFF8 workbook in memory, so the test needs no binary fixture committed beside it. */
async function biff8(rows: unknown[][]): Promise<ArrayBuffer> {
  const XLSX = (await import("@vendor/sheetjs/xlsx.mjs")) as unknown as {
    utils: { aoa_to_sheet(a: unknown[][]): unknown; book_new(): unknown; book_append_sheet(wb: unknown, ws: unknown, n: string): void };
    write(wb: unknown, o: { bookType: string; type: string }): ArrayBuffer;
  };
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  // `type: "array"` returns an ArrayBuffer directly — not a Uint8Array to unwrap.
  return XLSX.write(wb, { bookType: "xls", type: "array" });
}

describe("readReportGrid on a legacy .xls", () => {
  it("decodes it instead of telling the reader to re-save it in Excel", async () => {
    const buf = await biff8([
      ["Effective Date:", "08/22/2026"],
      ["Site", "City", "State", "Net"],
      ["436", "Amarillo", "TX", 4.512],
    ]);
    // The magic bytes must actually be OLE, or this test proves nothing about the branch it targets.
    const head = new Uint8Array(buf.slice(0, 4));
    expect([...head]).toEqual([0xd0, 0xcf, 0x11, 0xe0]);

    const grid = await readReportGrid(buf);
    expect(grid[1]).toEqual(["Site", "City", "State", "Net"]);
    expect(grid[2]?.[3]).toBe(4.512); // a number stays a number, not "4.512"
  });

  it("keeps blank cells as positions so column indexes stay aligned", async () => {
    const grid = await readReportGrid(await biff8([["a", "b", "c"], ["x", null, "z"]]));
    expect(grid[1]).toHaveLength(3);
    expect(grid[1]?.[1]).toBeNull();
    expect(grid[1]?.[2]).toBe("z");
  });

  it("still reads the formats that already worked", async () => {
    // A freshly allocated ArrayBuffer, not `TextEncoder().encode().buffer` — that hands back a pooled
    // buffer whose `instanceof ArrayBuffer` does not survive vitest's module realm, and readReportGrid
    // then takes it for a File.
    const bytes = new TextEncoder().encode("Site,City\n436,Amarillo\n");
    const csv = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(csv).set(bytes);
    expect((await readReportGrid(csv))[1]).toEqual(["436", "Amarillo"]);
  });
});
