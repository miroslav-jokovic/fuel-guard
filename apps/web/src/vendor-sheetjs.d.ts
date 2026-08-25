/**
 * Types for the vendored SheetJS build. Lives under `src/` rather than beside the library because
 * tsconfig only includes `src/**` — a declaration next to the vendored file is never loaded.
 *
 * The slice of SheetJS this codebase uses, declared locally rather than vendoring the library's own
 * 200 KB of types. Reading a legacy `.xls` into a cell grid needs three calls and nothing else.
 */
declare module "@vendor/sheetjs/xlsx.mjs" {
  export interface WorkSheet {
    [cell: string]: unknown;
  }
  export interface WorkBook {
    SheetNames: string[];
    Sheets: Record<string, WorkSheet>;
  }
  export function read(data: ArrayBuffer | Uint8Array, opts?: { type?: string; cellDates?: boolean; raw?: boolean }): WorkBook;
  export const utils: {
    sheet_to_json<T = unknown>(ws: WorkSheet, opts?: { header?: 1 | string[]; raw?: boolean; defval?: unknown; blankrows?: boolean }): T[];
  };
}
