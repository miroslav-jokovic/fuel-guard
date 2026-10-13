/**
 * The sniff lives in `@silvicom/shared` (`documentFormats.ts`) since the browser asks the same question
 * before it uploads; re-exported here so the pages stage keeps one local import.
 */
export { FORMAT_MIMES, SOURCE_FORMATS, sniffFormat, type SourceFormat } from "@silvicom/shared";
