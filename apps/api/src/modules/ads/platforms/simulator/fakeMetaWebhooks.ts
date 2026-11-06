import { createHmac } from "node:crypto";
import { graphError } from "./fakeMetaShapes.js";
import type { FakeLead } from "./fakeMetaLeads.js";

/**
 * FakeMeta's webhooks (B4b), apart from `fakeMeta.ts` for the file budget. Two halves, read 2026-11-03:
 *
 *   POST /{v}/{page_id}/subscribed_apps?subscribed_fields=leadgen   with the PAGE's token → `{ success: true }`
 *   GET  /{v}/{page_id}/subscribed_apps                              → `{ data: [{ id, name, subscribed_fields }] }`
 *        "A Page access token requested by a person who can perform" CREATE_CONTENT, MANAGE or MODERATE;
 *        `pages_manage_metadata` + `pages_show_list`. https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps/
 *        ⚠ "only fields with subscriptions at both the page and app levels will get Webhooks": the APP-level
 *        subscription is the App Dashboard's (owner track). This fake models the Page half only, so a
 *        delivery is made only for a subscribed Page; the app half is unproven until L4.
 *
 *   The delivery Meta POSTs to our endpoint: `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 with the app
 *   secret>` over `{ object: "page", entry: [{ id, time, changes: [{ field: "leadgen", value: { leadgen_id,
 *   page_id, form_id, adgroup_id, ad_id, created_time } }] }] }`.
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started/ ·
 *   https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/
 *   `created_time` is a unix integer in the guide's sample. Ids are strings here, as Graph returns ids.
 *
 * A delivery is RETURNED, not sent: the test posts it to the app under test, so "twice", "forged" and "not
 * at all" are the test's own choices, and a delivery can be re-serialised to prove the raw-bytes check.
 */

const PAGE_TASKS = ["CREATE_CONTENT", "MANAGE", "MODERATE"];
const PAGE_FIELDS = new Set(["leadgen", "leadgen_fat", "leadgen_update", "feed", "messages"]);
export const FAKE_APP_ID = "990000000777";

export interface FakeDelivery {
  /** The exact bytes to POST. */
  body: string;
  /** `X-Hub-Signature-256`. */
  signature: string;
}

type Answer = { status: number; body: unknown };

export class FakeWebhooks {
  /** Page id → the fields our app is subscribed to on that Page. */
  readonly subscriptions = new Map<string, Set<string>>();

  constructor(readonly appSecret: string, private readonly trace: () => string) {}

  subscribe(page: { id: string; tasks: string[] }, b: Record<string, string>): Answer {
    if (!page.tasks.some((t) => PAGE_TASKS.includes(t))) {
      return graphError(400, 200, "OAuthException", "(#200) The user must be an administrator, editor, or moderator of the page", this.trace());
    }
    const fields = (b.subscribed_fields ?? "").split(",").map((f) => f.trim()).filter(Boolean);
    if (!fields.length || fields.some((f) => !PAGE_FIELDS.has(f))) {
      return graphError(400, 100, "OAuthException", "(#100) Param subscribed_fields must be one of the Page Webhooks fields", this.trace());
    }
    this.subscriptions.set(page.id, new Set(fields));
    return { status: 200, body: { success: true } };
  }

  list(pageId: string): Answer {
    const s = this.subscriptions.get(pageId);
    return { status: 200, body: { data: s ? [{ id: FAKE_APP_ID, name: "Silvicom 360", subscribed_fields: [...s] }] : [] } };
  }

  /**
   * One signed delivery for these leads of one Page, or null when the Page is not subscribed to `leadgen`
   * (Meta sends nothing then). `forge` signs with another secret; `secret` overrides the app secret.
   */
  leadgenDelivery(pageId: string, leads: FakeLead[], opts: { forge?: boolean; at?: Date } = {}): FakeDelivery | null {
    if (!this.subscriptions.get(pageId)?.has("leadgen")) return null;
    const body = leadgenDeliveryBody(pageId, leads, opts.at ?? new Date());
    return { body, signature: signMetaBody(opts.forge ? `${this.appSecret}-forged` : this.appSecret, body) };
  }
}

/**
 * The body of one leadgen delivery, as this fake reads Meta's webhook pages. Pure, so the Lead intake L4 suite
 * (stage2-kit-2c) builds the same body for a lead on Meta's sandbox, whose webhook cannot reach a laptop.
 */
export function leadgenDeliveryBody(pageId: string, leads: ReadonlyArray<Pick<FakeLead, "id" | "form_id" | "ad_id" | "created_time">>, at: Date): string {
  return JSON.stringify({
    object: "page",
    entry: [{
      id: pageId, time: Math.floor(at.getTime() / 1000),
      changes: leads.map((l) => ({
        field: "leadgen",
        value: {
          leadgen_id: l.id, page_id: pageId, form_id: l.form_id, adgroup_id: l.ad_id ?? "0", ad_id: l.ad_id ?? "0",
          created_time: Math.floor(Date.parse(l.created_time.replace("+0000", "Z")) / 1000),
        },
      })),
    }],
  });
}

/** `sha256=<hex>` of the bytes as sent — Meta's header value. */
export function signMetaBody(secret: string, body: string | Buffer): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}
