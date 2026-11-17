import { TOLL_PROVIDER_LABEL, type TransponderDto } from "@silvicom/shared";

/** How a tag is named to a reader: the brand and the number as printed, `E-ZPass 00812345678`. */
export const tagLabel = (t: Pick<TransponderDto, "provider" | "tagNumber">): string =>
  `${TOLL_PROVIDER_LABEL[t.provider]} ${t.tagNumber}`;

/** The short form a table cell has room for: brand and the last five, `E-ZPass …45678`. */
export const tagShortLabel = (t: Pick<TransponderDto, "provider" | "tagNumber">): string =>
  `${TOLL_PROVIDER_LABEL[t.provider]} ${t.tagNumber.length > 6 ? `…${t.tagNumber.slice(-5)}` : t.tagNumber}`;

/** What the tag dialog is open for: add one to this truck, move, retire, or void a wrong entry. */
export type TollTagAction =
  | { kind: "add" }
  | { kind: "move"; tag: TransponderDto }
  | { kind: "retire"; tag: TransponderDto }
  | { kind: "void"; tag: TransponderDto; entryId: string; entryLabel: string };
