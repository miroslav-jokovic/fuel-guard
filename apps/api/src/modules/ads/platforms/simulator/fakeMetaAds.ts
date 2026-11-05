import { createHash } from "node:crypto";
import type { FakeAdSet, FakeAdSets } from "./fakeMetaAdSets.js";
import type { FakeForms } from "./fakeMetaForms.js";
import { graphError, pick } from "./fakeMetaShapes.js";

/**
 * FakeMeta's ad images, ad creatives and ads (B2c), apart from `fakeMeta.ts` for the file budget. The
 * ads themselves live in `FakeAdSets.ads`, beside the ad sets whose status B3 already moves.
 *
 * ── WHERE EACH SHAPE IS FROM (read 2026-11-04) ───────────────────────────────────────────────────
 *   POST /{v}/act_{id}/adimages         `bytes` = the image, base64 → `{ images: { <key>: { hash, url,
 *                                        width, height, name, … } } }`; "the hash … uniquely identifies the
 *                                        image"; `url` is temporary and must not be used in a creative.
 *                                        https://developers.facebook.com/docs/marketing-api/reference/ad-image/
 *   POST /{v}/act_{id}/adcreatives      `name`, `object_story_spec { page_id, link_data { image_hash, link,
 *                                        message, name, call_to_action { type, value { lead_gen_form_id } } } }`;
 *                                        the CTA type one of APPLY_NOW, DOWNLOAD, GET_QUOTE, LEARN_MORE,
 *                                        SIGN_UP, SUBSCRIBE; the link "can only be https://fb.me/".
 *                                        https://developers.facebook.com/docs/marketing-api/guides/lead-ads/create
 *   POST /{v}/act_{id}/ads              `name`, `adset_id`, `creative { creative_id }`, `status` → `{ id }`
 *                                        (the same guide, Step 5).
 *   GET  /{v}/act_{id}/adcreatives,     lists, narrowed by name EQUAL as the other edges are (B2a).
 *        /{v}/{adset_id}/ads
 *   GET  /{v}/act_{id}/adimages         `hashes=["<hash>", …]` → `{ data: [{ hash, width, height, … }] }` — the
 *                                        image read back (Publisher L3's contract suite reads every object it
 *                                        made). Same reference page, read 2026-11-05.
 *
 * ⚠ OUR reading, not Meta's word — L4 re-runs the contract suite on the sandbox to settle each:
 *   · the key inside `images` is not named by the page: this fake keys by `bytes`, and the publisher
 *     reads the one entry whatever its key;
 *   · the hash is the MD5 of the bytes (the page says only that it identifies the image), so the same
 *     bytes uploaded twice answer the same hash — which is what lets the publisher re-send an upload;
 *   · the guide writes the link both as `https://fb.me/` and `http://fb.me/`; this fake takes either;
 *   · a creative's `link_data.name` (the headline) is not in the guide's list; it is in the link-ad
 *     spec, and this fake keeps it.
 */

const CTA_TYPES = new Set(["APPLY_NOW", "DOWNLOAD", "GET_QUOTE", "LEARN_MORE", "SIGN_UP", "SUBSCRIBE"]);
const STATUSES = new Set(["ACTIVE", "PAUSED"]);

type Answer = { status: number; body: unknown };

export interface FakeImage { hash: string; account_id: string; width: number; height: number; bytes: number }

export interface FakeCreative {
  id: string;
  account_id: string;
  name: string;
  status: "ACTIVE" | "DELETED";
  object_story_spec: { page_id: string; link_data: Record<string, unknown> };
}

export class FakeAds {
  readonly images = new Map<string, FakeImage>();
  readonly creatives = new Map<string, FakeCreative>();

  constructor(
    private readonly ids: () => string,
    private readonly trace: () => string,
    private readonly sets: FakeAdSets,
    private readonly forms: FakeForms,
  ) {}

  /** The routes this file answers; null for any other path (the caller routes on). */
  route(method: string, path: string, b: Record<string, string>): Answer | null {
    const acct = /^act_(\d+)\/(adimages|adcreatives|ads)$/.exec(path);
    if (acct && method === "POST") {
      const [, account, edge] = acct;
      return edge === "adimages" ? this.upload(account!, b) : edge === "adcreatives" ? this.createCreative(account!, b) : this.createAd(account!, b);
    }
    if (acct && method === "GET" && acct[2] === "adimages") return this.readImages(acct[1]!, b);
    if (acct && method === "GET" && acct[2] === "adcreatives") return this.list([...this.creatives.values()].filter((c) => c.account_id === acct[1]), b);
    const children = /^(\d+)\/ads$/.exec(path);
    if (children && method === "GET") return this.list([...this.sets.ads.values()].filter((a) => a.adset_id === children[1]), b);
    const one = /^(\d+)$/.exec(path);
    const creative = one && method === "GET" ? this.creatives.get(one[1]!) : undefined;
    if (creative) return { status: 200, body: pick({ ...creative }, b.fields, ["id"]) };
    return null;
  }

  private bad(message: string, code = 100): Answer {
    return graphError(400, code, "OAuthException", `(#${code}) ${message}`, this.trace());
  }

  private upload(accountId: string, b: Record<string, string>): Answer {
    const bytes = b.bytes ? Buffer.from(b.bytes, "base64") : Buffer.alloc(0);
    const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!png || bytes.length < 24) return this.bad("Invalid image: bytes is required and must be an image file");
    const hash = createHash("md5").update(bytes).digest("hex");
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    this.images.set(hash, { hash, account_id: accountId, width, height, bytes: bytes.length });
    return { status: 200, body: { images: { bytes: { hash, url: `https://fake-meta.invalid/i/${hash}.png`, width, height, name: "bytes" } } } };
  }

  /** The account's images whose hash is in `hashes` (a JSON array); an unparseable list is Meta's 100. */
  private readImages(accountId: string, b: Record<string, string>): Answer {
    let hashes: unknown;
    try {
      hashes = JSON.parse(b.hashes ?? "[]");
    } catch {
      hashes = null;
    }
    if (!Array.isArray(hashes)) return this.bad("hashes must be an array");
    const rows = [...this.images.values()].filter((i) => i.account_id === accountId && hashes.includes(i.hash));
    return { status: 200, body: { data: rows.map((i) => pick({ ...i }, b.fields, ["hash"])) } };
  }

  private createCreative(accountId: string, b: Record<string, string>): Answer {
    if (!b.name) return this.bad("name is required");
    let spec: FakeCreative["object_story_spec"] | null;
    try {
      spec = b.object_story_spec ? (JSON.parse(b.object_story_spec) as FakeCreative["object_story_spec"]) : null;
    } catch {
      spec = null;
    }
    const link = spec?.link_data as { image_hash?: unknown; link?: unknown; call_to_action?: { type?: unknown; value?: { lead_gen_form_id?: unknown } } } | undefined;
    if (!spec || typeof spec.page_id !== "string" || !link) return this.bad("object_story_spec with page_id and link_data is required");
    const image = this.images.get(String(link.image_hash ?? ""));
    if (!image || image.account_id !== accountId) return this.bad("Image hash not found in this ad account", 1487242);
    if (link.link !== "https://fb.me/" && link.link !== "http://fb.me/") return this.bad("A lead ad's link can only be https://fb.me/");
    if (!CTA_TYPES.has(String(link.call_to_action?.type ?? ""))) return this.bad("call_to_action type is not allowed for lead ads");
    const formId = String(link.call_to_action?.value?.lead_gen_form_id ?? "");
    if (this.forms.pageOf(formId) !== spec.page_id) return this.bad("lead_gen_form_id must be a form on the creative's Page");
    const id = this.ids();
    this.creatives.set(id, { id, account_id: accountId, name: b.name, status: "ACTIVE", object_story_spec: spec });
    return { status: 200, body: { id } };
  }

  private createAd(accountId: string, b: Record<string, string>): Answer {
    if (!b.name || b.name.length > 400) return this.bad("name is required, at most 400 characters");
    const adset: FakeAdSet | undefined = this.sets.adsets.get(b.adset_id ?? "");
    if (!adset || adset.account_id !== accountId) return this.bad("adset_id is required and must belong to this ad account");
    let creativeId: string;
    try {
      creativeId = String((JSON.parse(b.creative ?? "{}") as { creative_id?: unknown }).creative_id ?? "");
    } catch {
      creativeId = "";
    }
    const creative = this.creatives.get(creativeId);
    if (!creative || creative.account_id !== accountId) return this.bad("creative.creative_id must be a creative of this ad account");
    if (!STATUSES.has(b.status ?? "")) return this.bad("Only ACTIVE and PAUSED are valid during creation");
    const id = this.ids();
    this.sets.ads.set(id, { id, adset_id: adset.id, name: b.name, status: b.status as "ACTIVE" | "PAUSED", creative: { id: creative.id } });
    return { status: 200, body: { id } };
  }

  private list(rows: Array<{ name: string }>, b: Record<string, string>): Answer {
    let filters: Array<{ field?: unknown; operator?: unknown; value?: unknown }>;
    try {
      filters = b.filtering === undefined ? [] : (JSON.parse(b.filtering) as typeof filters);
    } catch {
      return this.bad("filtering must be an array");
    }
    let out = rows;
    for (const f of filters) {
      if (f.field !== "name" || f.operator !== "EQUAL") return this.bad(`FakeMeta filters only name EQUAL, got ${String(f.field)} ${String(f.operator)}`);
      out = out.filter((r) => r.name === f.value);
    }
    return { status: 200, body: { data: out.map((r) => pick({ ...r }, b.fields, ["id"])) } };
  }
}
