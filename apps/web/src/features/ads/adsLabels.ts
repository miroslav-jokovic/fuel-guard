import type { AdAiAgent, AdPlatform } from "@silvicom/shared";

/**
 * The ads names the office reads, worded once. They were written twice (Settings' form and the spend card) before
 * the Automation tab became a third reader on 2026-11-18. `Record`s, so an agent or a platform added to the contract
 * fails to compile here instead of rendering a raw key.
 */
export const PLATFORM_LABEL: Record<AdPlatform, string> = { meta: "Meta (Facebook, Instagram)", tiktok: "TikTok", x: "X", simulator: "Simulator" };

/** What each AI agent does, as a sentence: the agents have no other names in the office's language. */
export const AGENT_LABEL: Record<AdAiAgent, string> = {
  copywriter: "Writes the ad's words", art_director: "Describes the picture", renderer: "Draws the picture",
  checker: "Checks the picture", analyst: "Writes the daily report", craft_judge: "Ranks the copies the writer offers", finished_ad_judge: "Gives a second opinion on each finished ad",
  strategist: "Plans the campaign — no ad is made without a plan",
  researcher: "Reads the job pages your recruiters save to the swipe file",
  swipe_reader: "Reads the ad pictures your recruiters save to the swipe file",
};
