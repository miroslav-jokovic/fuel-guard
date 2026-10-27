import { describe, expect, it } from "vitest";
import { chatActivityReadRequestSchema, chatBodyText, chatMentionIds, chatMentionToken } from "./chatContract.js";

/**
 * D-CHAT22's token, as the web writes it and the API reads it. The database's own reading of the same
 * token (0521 `chat_mention_ids`, its trigger and CH013) is `supabase/tests/office-chat-mentions.test.mjs`'s.
 */
const ANA = "aaaaaaaa-1111-4111-8111-11111111abcd";
const BEN = "bbbbbbbb-2222-4222-8222-22222222beef";

describe("chat mention tokens", () => {
  it("reads every person a body names, once each, lower-cased as the database stores them", () => {
    const body = `${chatMentionToken(ANA)} and <@${BEN.toUpperCase()}>, then ${chatMentionToken(ANA)} again`;
    expect(chatMentionIds(body)).toEqual([ANA, BEN]);
  });

  it("names nobody for a body without a whole token", () => {
    expect(chatMentionIds(null)).toEqual([]);
    expect(chatMentionIds(`@${ANA} <@${ANA.slice(0, -1)}> <${ANA}> <@ ${ANA}>`)).toEqual([]);
    // 36 characters of hex and hyphens, but not 8-4-4-4-12: not an id, so not a mention — in words too.
    const skewed = "<@aaaaaaaaa-aaa-4aaa-8aaa-aaaaaaaaaaaa>";
    expect(chatMentionIds(skewed)).toEqual([]);
    expect(chatBodyText(skewed, () => "Ana")).toBe(skewed);
  });

  it("is the same answer twice in a row — the pattern carries no state between calls", () => {
    const body = `hi ${chatMentionToken(BEN)}`;
    expect(chatMentionIds(body)).toEqual([BEN]);
    expect(chatMentionIds(body)).toEqual([BEN]);
  });

  it("renders each token as the person's name, and one it cannot name as @someone, never the id", () => {
    const names: Record<string, string> = { [ANA]: "Ana" };
    expect(chatBodyText(`${chatMentionToken(ANA)} ask <@${BEN.toUpperCase()}>`, (id) => names[id])).toBe("@Ana ask @someone");
  });
});

describe("Activity read request", () => {
  it("takes an instant with its offset, or nothing for now", () => {
    expect(chatActivityReadRequestSchema.safeParse({}).success).toBe(true);
    expect(chatActivityReadRequestSchema.safeParse({ at: "2026-10-27T15:00:00.123456Z" }).success).toBe(true);
    expect(chatActivityReadRequestSchema.safeParse({ at: "yesterday" }).success).toBe(false);
  });
});
