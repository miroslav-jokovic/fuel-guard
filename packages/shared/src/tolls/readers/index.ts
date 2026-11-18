/**
 * One entry point per provider (TOLLS-PER-TRUCK-PLAN TL5, D-TL5). The provider is the one the office
 * chose for the file (TL4a never defaults it); a file read with the wrong provider is refused by that
 * reader's header check, never read with another reader's columns.
 */
import type { StatementWord } from "../../reconcile/pilotStatement.js";
import type { TollProvider } from "../tollTags.js";
import { readDriveKsStatement } from "./driveKs.js";
import { readExpressTollStatement } from "./expressToll.js";
import { readEzpassNjStatement } from "./ezpassNj.js";
import type { TollStatementRead } from "./tollStatementRead.js";

export * from "./tollStatementRead.js";
export { readDriveKsStatement, readExpressTollStatement, readEzpassNjStatement };

const READERS: Record<TollProvider, (words: readonly StatementWord[]) => TollStatementRead> = {
  ezpass: readEzpassNjStatement,
  ktag: readDriveKsStatement,
  expresstoll: readExpressTollStatement,
};

/** Read a statement's PDF words with its provider's reader. Throws `TollStatementReadError` to refuse. */
export function readTollStatement(provider: TollProvider, words: readonly StatementWord[]): TollStatementRead {
  return READERS[provider](words);
}
