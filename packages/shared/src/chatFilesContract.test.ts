import { describe, expect, it } from "vitest";
import {
  CHAT_FILE_ACCEPT,
  CHAT_FILE_MAX_BYTES,
  chatFileDeclarationSchema,
  chatFileMimeOf,
  chatFileSize,
} from "./chatFilesContract.js";
import { chatPreview, chatSendRequestSchema } from "./chatContract.js";
import { chatSendReplyRequestSchema } from "./chatTeamsContract.js";

/**
 * CH7's contract (0539, D-CHAT27–D-CHAT30): what a file may be, and that a line is words or files. That
 * its limits equal 0539's CHECKs is held by apps/api's chatFileCheck.test.ts, which can read the SQL.
 */
const SHA = "a".repeat(64);
const ID = "11111111-1111-4111-8111-111111111111";

describe("what a file may be (D-CHAT30)", () => {
  it("knows a kind by its extension, whatever the case, and refuses what runs", () => {
    expect(chatFileMimeOf("POD 455.JPG")).toBe("image/jpeg");
    expect(chatFileMimeOf("rate-con.pdf")).toBe("application/pdf");
    expect(chatFileMimeOf("fuel.xlsx")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    for (const name of ["setup.exe", "run.sh", "page.html", "stuff.zip", "no-extension", "photo.svg"]) expect(chatFileMimeOf(name)).toBeNull();
    expect(CHAT_FILE_ACCEPT.split(",")).toContain(".pdf");
    expect(CHAT_FILE_ACCEPT).not.toContain(".exe");
  });

  it("refuses a declaration whose name and kind disagree, a path in the name, an oversize file or a bad hash", () => {
    const ok = { file_name: "a.pdf", mime: "application/pdf", byte_size: 10, sha256: SHA };
    expect(chatFileDeclarationSchema.safeParse(ok).success).toBe(true);
    expect(chatFileDeclarationSchema.safeParse({ ...ok, file_name: "a.jpg" }).success).toBe(false);
    expect(chatFileDeclarationSchema.safeParse({ ...ok, file_name: "../a.pdf" }).success).toBe(false);
    expect(chatFileDeclarationSchema.safeParse({ ...ok, byte_size: CHAT_FILE_MAX_BYTES + 1 }).success).toBe(false);
    expect(chatFileDeclarationSchema.safeParse({ ...ok, sha256: "abc" }).success).toBe(false);
    expect(chatFileDeclarationSchema.parse({ ...ok, sha256: SHA.toUpperCase() }).sha256).toBe(SHA);
  });

  it("reads a size the way a person does", () => {
    expect(chatFileSize(512)).toBe("512 B");
    expect(chatFileSize(830 * 1024)).toBe("830 KB");
    expect(chatFileSize(2.4 * 1024 * 1024)).toBe("2.4 MB");
    expect(chatFileSize(3 * 1024 * 1024)).toBe("3 MB");
  });
});

describe("a line is words or files (D-CHAT29)", () => {
  const file = { id: ID, file_name: "a.pdf", mime: "application/pdf", byte_size: 10, sha256: SHA };
  it("takes words alone, files alone, or both — never neither — for a post and for a reply", () => {
    for (const schema of [chatSendRequestSchema, chatSendReplyRequestSchema]) {
      expect(schema.safeParse({ message_id: ID, body: "On it." }).success).toBe(true);
      expect(schema.safeParse({ message_id: ID, files: [file] }).success).toBe(true);
      expect(schema.safeParse({ message_id: ID, body: "   ", files: [] }).success).toBe(false);
      expect(schema.safeParse({ message_id: ID, files: Array.from({ length: 11 }, () => file) }).success).toBe(false);
    }
  });

  it("previews a line that is only files as Sent a file", () => {
    const last = { id: ID, seq: 1, sender_user_id: null, sender_name: null, body: "", created_at: "2026-11-01T00:00:00Z", deleted: false };
    expect(chatPreview(last)).toBe("Sent a file");
  });
});
