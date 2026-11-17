import { AD_NAME_LANGUAGES, feedImageOf, platformText, type AdFormat, type AdNameLanguage } from "@silvicom/shared";
import { adNameFor, byName, ensure, failureBody, type Found, type Listing, type PublishInput, type PublisherDeps } from "./publisher.js";
import { ensureVideo, type PublishVideoFile } from "./publisherVideo.js";

/**
 * The publisher's last three levels (ADS-AGENT-BUILD-WORKFLOW B2c): for every approved creative, in
 * every language, the image on the ad account, the ad creative that shows it and opens that language's
 * form, and the ad, PAUSED, in the campaign's one ad set (plan §2b.2: one ad set, several concepts).
 *
 * ── WHAT THE AD SAYS ─────────────────────────────────────────────────────────────────────────────
 * The image already carries the overlay's headline and call to action (C5b). The words Meta shows beside
 * it are two OTHER copy slots, named by the preset's `platform_slots` — primary text above the image,
 * headline under it. A preset that does not name them is refused (`no_platform_slots`), never guessed
 * from the slots' order: which sentence a person reads first is the preset author's choice, not ours.
 * The button is APPLY_NOW, one of the six the Lead Ads guide allows; the link is `https://fb.me/`, the
 * only value the guide allows a lead ad.
 *
 * ── WHICH IMAGE (Q-AD29) ─────────────────────────────────────────────────────────────────────────
 * A creative holds an image per format (1:1, 4:5, 9:16) per language. A lead ad's `link_data` takes ONE
 * `image_hash`. Meta's way to give each placement its own image is placement asset customization
 * (`asset_feed_spec`), and its page (read 2026-11-04) never mentions lead ads or `lead_gen_form_id`. So
 * this publisher uses the feed image — 4:5, else 1:1 — and a creative with neither is refused
 * (`no_feed_image`). The 9:16 image waits, unused and stored, for Q-AD29: placement customization proven
 * on the sandbox (L4), then added to `FEED_FORMATS` — shared's, because the preset save and compose read the
 * same list (D-AD24). Feed placements show 4:5 and 1:1 as made; Stories crop them.
 *
 * ── A MOTION AD (V4) ─────────────────────────────────────────────────────────────────────────────
 * A creative that holds a motion ad (`ads_creatives.motion`) is published as a VIDEO lead ad: its language's
 * MP4 goes to the account's video library (`publisherVideo.ts`), and the creative carries `video_data` in
 * place of `link_data` — the same two texts (`message`, `title`), the same button, the same form. The Lead
 * Ads guide's video sample puts the link INSIDE the button's value, so it is sent there. The thumbnail is
 * the creative's own feed still, named by `image_hash`: the Ad Creative Video Data reference lists it
 * ("Hash of an image in your image library with Facebook to use as thumbnail", read 2026-11-17), the still
 * is uploaded by the image road below either way, and it is the motion ad's own last frame. The guide's
 * sample uses `image_url` instead, which would need a public address for a file we keep private. Whether
 * a lead ad takes the hash is L4's to settle; nothing here guesses a URL. A motion ad missing a language's
 * file is refused before any call (`motion_file_missing`), never published as its still: the plan asked
 * for a video.
 *
 * ── RESUME, NEVER DUPLICATE ──────────────────────────────────────────────────────────────────────
 * The creative and the ad are levels like the campaign's (`ensure`): find by our name, adopt one, create
 * none, refuse two; read back by id and compare. The image is not: Meta answers the same hash for the
 * same bytes (FakeMeta's header marks that our reading), so an upload whose answer was lost is simply
 * sent again (`idempotent: true`) and makes nothing twice. Its hash is on the creative's ledger row.
 */

const CTA = "APPLY_NOW";
const LEAD_AD_LINK = "https://fb.me/";
const CREATIVE_FIELDS = "id,name,status,object_story_spec";
const AD_FIELDS = "id,name,status,adset_id,creative";

export interface PublishCreative {
  id: string;
  /** Its preset's key (P1…), for the ad's name. */
  preset_key: string;
  /** `ads_creatives.copy`: per language, slot → text. */
  copy: Partial<Record<AdNameLanguage, Record<string, string>>>;
  /** `ads_creatives.assets`: one PNG per format per language. */
  assets: ReadonlyArray<{ format: AdFormat; language: AdNameLanguage; sha256: string }>;
  /** The preset version's `platform_slots`; null = not said. */
  platform_slots: { primary_text: string; headline: string } | null;
  /** `ads_creatives.motion`'s files, one MP4 per language; null or absent = an image ad. */
  motion?: { files: readonly PublishVideoFile[] } | null;
}

export interface PublishedAd {
  creative_id: string;
  language: AdNameLanguage;
  /** The image the ad shows; a video ad's thumbnail. */
  image_hash: string;
  /** Meta's video id, on a motion ad only. */
  video_id?: string;
  meta_creative_id: string;
  meta_ad_id: string;
}

/** Why a creative cannot become ads, said before any call; null when it can. */
export function creativeRefusal(c: PublishCreative): string | null {
  if (!c.platform_slots) return "no_platform_slots";
  for (const language of AD_NAME_LANGUAGES) {
    if (!platformText(c.copy[language], c.platform_slots)) return "creative_copy_missing";
    if (!feedImage(c, language)) return "no_feed_image";
    if (c.motion && !motionFile(c, language)) return "motion_file_missing";
  }
  return null;
}

/** The image this ad shows; the rule is shared's (`feedImageOf`), because the review screen previews the same one. */
export function feedImage(c: Pick<PublishCreative, "assets">, language: AdNameLanguage) {
  return feedImageOf(c.assets, language);
}

/** The MP4 this language's ad plays, when the creative is a motion ad. */
export function motionFile(c: Pick<PublishCreative, "motion">, language: AdNameLanguage): PublishVideoFile | null {
  return c.motion?.files.find((f) => f.language === language) ?? null;
}

/** The video-ad spec Meta stores (header, "A MOTION AD"); the read-back compares these fields. */
export function videoData(c: PublishCreative, language: AdNameLanguage, videoId: string, thumbnailHash: string, formId: string) {
  const said = platformText(c.copy[language], c.platform_slots)!;
  return {
    video_id: videoId, image_hash: thumbnailHash, message: said.primary_text, title: said.headline,
    call_to_action: { type: CTA, value: { link: LEAD_AD_LINK, lead_gen_form_id: formId } },
  };
}

/** The link-ad spec Meta stores; the read-back compares these fields. */
export function linkData(c: PublishCreative, language: AdNameLanguage, imageHash: string, formId: string) {
  // The two texts beside the image are shared's (`platformText`): what is sent here is what the review screen shows.
  const said = platformText(c.copy[language], c.platform_slots)!;
  return {
    image_hash: imageHash, link: LEAD_AD_LINK, message: said.primary_text, name: said.headline,
    call_to_action: { type: CTA, value: { lead_gen_form_id: formId } },
  };
}

type AdsResult = { ok: true; ads: PublishedAd[] } | { ok: false; error_code: string; response?: unknown };

export async function publishAds(deps: PublisherDeps, input: PublishInput, at: { adsetId: string; forms: Record<AdNameLanguage, string> }): Promise<AdsResult> {
  const ads: PublishedAd[] = [];
  for (const creative of input.creatives) {
    for (const language of AD_NAME_LANGUAGES) {
      const one = await publishOne(deps, input, creative, language, at.adsetId, at.forms[language]);
      if (!one.ok) return one;
      ads.push(one.ad);
    }
  }
  return { ok: true, ads };
}

async function publishOne(deps: PublisherDeps, input: PublishInput, creative: PublishCreative, language: AdNameLanguage, adsetId: string, formId: string): Promise<{ ok: true; ad: PublishedAd } | { ok: false; error_code: string; response?: unknown }> {
  const image = await uploadImage(deps, input, feedImage(creative, language)!.sha256);
  if (!image.ok) return image;

  const name = adNameFor(input, creative, language);
  const short = name.split("|").slice(-2).join(":");
  const file = motionFile(creative, language);
  const video = file ? await ensureVideo(deps, input, creative.id, short, file) : null;
  if (video && !video.ok) return video;
  const spec: StorySpec = video
    ? { page_id: input.pageId, video_data: videoData(creative, language, video.video_id, image.hash, formId) }
    : { page_id: input.pageId, link_data: linkData(creative, language, image.hash, formId) };
  const made = await ensure(deps, input, `creative:${short}`, {
    find: () => deps.graph.get<Listing>(`act_${input.accountId}/adcreatives`, byName(name, CREATIVE_FIELDS)),
    readBack: (id) => deps.graph.get<Found>(id, { fields: CREATIVE_FIELDS }),
    create: () => deps.graph.post<{ id: string }>(`act_${input.accountId}/adcreatives`, { name, object_story_spec: spec }, { idempotent: false }),
    expect: { name, status: "ACTIVE" },
    expectCategory: false,
    verify: (o) => sameSpec(o.object_story_spec, spec),
    ref: "meta_creative_id",
    creativeId: creative.id,
  });
  if (!made.ok) return made;

  const ad = await ensure(deps, input, `ad:${short}`, {
    find: () => deps.graph.get<Listing>(`${adsetId}/ads`, byName(name, AD_FIELDS)),
    readBack: (id) => deps.graph.get<Found>(id, { fields: AD_FIELDS }),
    create: () => deps.graph.post<{ id: string }>(`act_${input.accountId}/ads`, { name, adset_id: adsetId, creative: { creative_id: made.id }, status: "PAUSED" }, { idempotent: false }),
    expect: { name, status: "PAUSED", adset_id: adsetId },
    expectCategory: false,
    verify: (o) => ((o.creative as { id?: unknown } | undefined)?.id === made.id ? [] : ["creative"]),
    ref: "meta_ad_id",
    creativeId: creative.id,
  });
  if (!ad.ok) return ad;
  return { ok: true, ad: { creative_id: creative.id, language, image_hash: image.hash, ...(video ? { video_id: video.video_id } : {}), meta_creative_id: made.id, meta_ad_id: ad.id } };
}

/**
 * The stored PNG onto the ad account; Meta's hash back. Re-sendable: the same bytes answer the same hash.
 *
 * A failure carries the client's own code (`token_invalid`, `rate_limited`, …), the step named in its
 * response. Until Publisher L3 (2026-11-05) it was prefixed `image_`, so a token revoked mid-run that met
 * the upload first came back `image_token_invalid` — a code the runner's connection alert
 * (`alerts/connectionAlerts.ts` CONNECTION_CODES) does not know, and no admin was told.
 */
async function uploadImage(deps: PublisherDeps, input: PublishInput, sha256: string): Promise<{ ok: true; hash: string } | { ok: false; error_code: string; response?: unknown }> {
  const bytes = await deps.readAsset(input.orgId, { sha256, format: "png" });
  const r = await deps.graph.post<{ images?: Record<string, { hash?: unknown }> }>(`act_${input.accountId}/adimages`, { bytes: bytes.toString("base64") }, { idempotent: true });
  if (!r.ok) return { ok: false, error_code: r.error.error_code, response: { step: "image", ...failureBody(r.error) } };
  const entries = Object.values(r.data.images ?? {});
  const hash = entries.length === 1 ? entries[0]!.hash : undefined;
  return typeof hash === "string" && hash ? { ok: true, hash } : { ok: false, error_code: "image_hash_missing", response: { images: entries.length } };
}

type StorySpec = { page_id: string; link_data: ReturnType<typeof linkData> } | { page_id: string; video_data: ReturnType<typeof videoData> };

/** The creative Meta holds shows our image or our video, our words and our form, on our Page — and is the kind we would send. */
function sameSpec(got: unknown, want: StorySpec): string[] {
  type Held = Record<string, unknown> & { call_to_action?: { type?: unknown; value?: { link?: unknown; lead_gen_form_id?: unknown } } };
  const g = (got ?? {}) as { page_id?: unknown; link_data?: Held; video_data?: Held };
  const wrong: string[] = [];
  if (g.page_id !== want.page_id) wrong.push("page_id");
  const moving = "video_data" in want;
  const sent: Record<string, unknown> = moving ? want.video_data : want.link_data;
  const held = (moving ? g.video_data : g.link_data) ?? {};
  // An image creative under a motion ad's name (or the reverse) is not ours to adopt, whatever else it says.
  if ((moving ? g.link_data : g.video_data) !== undefined) wrong.push(moving ? "link_data" : "video_data");
  for (const k of moving ? ["video_id", "image_hash", "message", "title"] : ["image_hash", "message", "name"]) if (held[k] !== sent[k]) wrong.push(k);
  const button = (moving ? want.video_data : want.link_data).call_to_action;
  if (held.call_to_action?.type !== CTA || String(held.call_to_action?.value?.lead_gen_form_id ?? "") !== button.value.lead_gen_form_id) wrong.push("call_to_action");
  if (moving && held.call_to_action?.value?.link !== LEAD_AD_LINK) wrong.push("link");
  return wrong;
}
