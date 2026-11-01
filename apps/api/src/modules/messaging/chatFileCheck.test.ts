import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHAT_FILE_MAX_BYTES, CHAT_FILES_PER_LINE } from "@silvicom/shared";

/**
 * CH7's limits are written twice — the shared contract (`chatFilesContract.ts`) and migration 0539's bucket
 * and CHECKs — as the reactions are (chatReactionCheck.test.ts). This holds the two together: a contract
 * that allowed more than the table would turn a valid-looking upload into a refusal at send.
 */
const SQL = readFileSync(fileURLToPath(new URL("../../../../../supabase/migrations/0539_office_chat_files.sql", import.meta.url)), "utf8");

describe("CH7's limits match 0539", () => {
  it("25 MB a file: the contract, the bucket's cap and the table's CHECK are one number", () => {
    expect(CHAT_FILE_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(SQL).toContain("values ('chat-files', 'chat-files', false, 25 * 1024 * 1024)");
    expect(SQL).toContain("check (byte_size between 1 and 25 * 1024 * 1024)");
  });

  it("ten files a line: the contract, the position CHECK and chat_send_files' count", () => {
    expect(CHAT_FILES_PER_LINE).toBe(10);
    expect(SQL).toContain("check (position between 1 and 10)");
    expect(SQL).toContain("not between 1 and 10");
  });
});
