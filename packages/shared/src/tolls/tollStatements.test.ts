import { describe, expect, it } from "vitest";
import { tollStatementConfirmSchema, tollStatementFormatOf, tollStatementUploadSchema, TOLL_STATEMENT_MAX_BYTES } from "./tollStatements.js";

const bytes = (...parts: Array<string | number[]>) => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") for (const c of p) out.push(c.charCodeAt(0));
    else out.push(...p);
  }
  return new Uint8Array(out);
};
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

describe("a statement's format comes from its bytes", () => {
  it("knows a PDF, even with a few bytes before its header", () => {
    expect(tollStatementFormatOf(bytes("%PDF-1.7\n"))).toBe("pdf");
    expect(tollStatementFormatOf(bytes([0xef, 0xbb, 0xbf], "\n%PDF-1.4"))).toBe("pdf");
  });

  it("tells an Excel workbook from an OpenDocument sheet, and refuses any other zip", () => {
    expect(tollStatementFormatOf(bytes(ZIP, "....[Content_Types].xml....xl/workbook.xml"))).toBe("xlsx");
    expect(tollStatementFormatOf(bytes(ZIP, "....mimetypeapplication/vnd.oasis.opendocument.spreadsheet"))).toBe("ods");
    expect(tollStatementFormatOf(bytes(ZIP, "....[Content_Types].xml....word/document.xml"))).toBeNull();
  });

  it("knows a legacy Excel file", () => {
    expect(tollStatementFormatOf(bytes(OLE, "rest"))).toBe("xls");
  });

  it("knows an HTML table named .xls from a CSV", () => {
    expect(tollStatementFormatOf(bytes("<html><body><table><tr><td>1</td></tr></table>"))).toBe("html");
    expect(tollStatementFormatOf(bytes([0xef, 0xbb, 0xbf], "  <table border=1>"))).toBe("html");
    expect(tollStatementFormatOf(bytes("Tag,Date,Plaza,Amount\n00812345678,06/01/2026,Exit 7,3.25\n"))).toBe("csv");
  });

  it("refuses a picture, an empty file and a blank one", () => {
    expect(tollStatementFormatOf(bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBeNull();
    expect(tollStatementFormatOf(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBeNull();
    expect(tollStatementFormatOf(new Uint8Array())).toBeNull();
    expect(tollStatementFormatOf(bytes("  \n\n "))).toBeNull();
  });
});

describe("the upload contract", () => {
  const ok = { provider: "ezpass", fileName: "June 2026.pdf", byteSize: 1000 };

  it("takes a named file of a toll provider up to 25 MB", () => {
    expect(tollStatementUploadSchema.safeParse(ok).success).toBe(true);
    expect(tollStatementUploadSchema.safeParse({ ...ok, byteSize: TOLL_STATEMENT_MAX_BYTES }).success).toBe(true);
  });

  it("refuses PrePass, an empty or oversized file, and a name holding a path", () => {
    expect(tollStatementUploadSchema.safeParse({ ...ok, provider: "prepass" }).success).toBe(false);
    expect(tollStatementUploadSchema.safeParse({ ...ok, byteSize: 0 }).success).toBe(false);
    expect(tollStatementUploadSchema.safeParse({ ...ok, byteSize: TOLL_STATEMENT_MAX_BYTES + 1 }).success).toBe(false);
    expect(tollStatementUploadSchema.safeParse({ ...ok, fileName: "../june.pdf" }).success).toBe(false);
  });

  it("needs a well-formed fingerprint to keep a file", () => {
    const base = { ...ok, fileId: "6f1c1a52-6a4b-4c8e-9d0e-0b8d2f3a1c11" };
    expect(tollStatementConfirmSchema.safeParse({ ...base, sha256: "a".repeat(64) }).success).toBe(true);
    expect(tollStatementConfirmSchema.safeParse({ ...base, sha256: "A".repeat(64) }).success).toBe(false);
    expect(tollStatementConfirmSchema.safeParse({ ...base, sha256: "a".repeat(63) }).success).toBe(false);
  });
});
