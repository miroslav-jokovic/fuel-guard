import { describe, it, expect } from "vitest";
import { detectReportKind } from "@fuelguard/shared";
import { parseCsv, tokenizeCsv, fileSourceFor, readEfsBuffer } from "./readEfsFile.js";

const TXN_HEADER = "Card #,Tran Date,Invoice,Unit,Driver Name,Odometer,Location Name,City,State/ Prov,Fees,Item,Unit Price,Qty,Amt,DB,Currency";
const REJECT_HEADER = "Date,Time,Card Number,Invoice,Location ID,Location Name,Location City,State/Prov,Error Code,Error Description,Unit,Driver ID,Driver Name,Policy,Policy Name";

describe("fileSourceFor", () => {
  it("classifies by extension", () => {
    expect(fileSourceFor("efs.csv")).toBe("csv");
    expect(fileSourceFor("EFS-REPORT.CSV")).toBe("csv");
    expect(fileSourceFor("efs.xlsx")).toBe("xlsx");
    expect(fileSourceFor("efs.xls")).toBe("xlsx");
    expect(fileSourceFor("efs.pdf")).toBeNull();
    expect(fileSourceFor("efs")).toBeNull();
  });
});

describe("readEfsBuffer — xlsx guard", () => {
  it("rejects a legacy binary .xls with a clear, actionable reason (not a cryptic exceljs error)", async () => {
    const ole2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // OLE2 magic
    await expect(readEfsBuffer("TransExport-123.xls", ole2)).rejects.toThrow(/legacy binary \.xls/i);
  });
  it("rejects a non-zip payload masquerading as .xlsx", async () => {
    await expect(readEfsBuffer("report.xlsx", Buffer.from("not a zip"))).rejects.toThrow(/not a valid \.xlsx/i);
  });
});

describe("tokenizeCsv", () => {
  it("keeps commas and newlines inside quoted fields and unescapes doubled quotes", () => {
    const rows = tokenizeCsv('a,"b,c","line1\nline2","say ""hi"""\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(["a", "b,c", "line1\nline2", 'say "hi"']);
  });

  it("handles CRLF line endings and a final row without a trailing newline", () => {
    const rows = tokenizeCsv("a,b\r\nc,d");
    expect(rows).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});

describe("parseCsv", () => {
  it("parses a transaction report: header + rows, quoted comma preserved", () => {
    const csv = `${TXN_HEADER}\n94507,2026-06-29,0801987714,691,"BOOTHE, DONOVAN",293580,"PILOT JAMESTOWN 305",JAMESTOWN,NM,0.0,ULSD,4.227,141.7,598.91,Y,USD/Gallons\n`;
    const { headers, rows } = parseCsv(csv);
    expect(detectReportKind(headers)).toBe("transaction");
    expect(rows).toHaveLength(1);
    expect(rows[0]!["Driver Name"]).toBe("BOOTHE, DONOVAN");
    expect(rows[0]!["Item"]).toBe("ULSD");
    expect(rows[0]!["Qty"]).toBe("141.7");
  });

  it("strips a UTF-8 BOM from the first header cell", () => {
    const csv = "﻿" + `${TXN_HEADER}\n94507,2026-06-29,0801987714,691,X,1,Y,C,NM,0,ULSD,4,10,40,Y,USD`;
    const { headers } = parseCsv(csv);
    expect(headers[0]).toBe("Card #");
  });

  it("skips a leading title row and locates the real header (needs ≥5 recognized columns)", () => {
    const csv = `Transaction Detail Report\n\n${TXN_HEADER}\n94507,2026-06-29,0801987714,691,X,1,Y,C,NM,0,ULSD,4,10,40,Y,USD\n`;
    const { headers, rows } = parseCsv(csv);
    expect(headers[0]).toBe("Card #");
    expect(headers).toHaveLength(16);
    expect(rows).toHaveLength(1);
  });

  it("drops fully-empty rows and columns with no header", () => {
    const csv = `${TXN_HEADER}\n\n94507,2026-06-29,0801987714,691,X,1,Y,C,NM,0,ULSD,4,10,40,Y,USD\n\n`;
    const { rows } = parseCsv(csv);
    expect(rows).toHaveLength(1);
  });

  it("parses a reject report", () => {
    const csv = `${REJECT_HEADER}\n2026-06-29,14:32:00,94507,0801987714,305,PILOT,JAMESTOWN,NM,51,DECLINE,691,D1,BOOTHE,P,PN\n`;
    const { headers, rows } = parseCsv(csv);
    expect(detectReportKind(headers)).toBe("reject");
    expect(rows).toHaveLength(1);
    expect(rows[0]!["Error Code"]).toBe("51");
  });
});
