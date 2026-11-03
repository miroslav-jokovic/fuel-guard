import { graphError, pick } from "./fakeMetaShapes.js";

/**
 * FakeMeta's leads (B4a), apart from `fakeMeta.ts` for the file budget, like the forms beside it. Shape,
 * read 2026-11-03:
 *   GET /{v}/{form_id}/leads?fields=…&filtering=…&limit=…&after=…
 *     → `{ data: [{ id, created_time, field_data: [{ name, values: [] }], ad_id, campaign_id, form_id }],
 *          paging: { cursors: { before, after }, next? } }`
 *     https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/
 *   `filtering=[{"field":"time_created","operator":"GREATER_THAN","value":<unix seconds>}]` — the guide's
 *   own example of "leads since a time", which is what an hourly backfill asks.
 *   `created_time` is Meta's `+0000` offset form ("2026-11-03T14:00:00+0000"), not ISO's `+00:00`.
 * Read with the PAGE's token (the guide: "retrieve leads … using a Page access token"), so `fakeMeta.ts`
 * routes `{form}/leads` for the form's Page token only.
 *
 * ⚠ Our readings, for L4 to settle on the sandbox: the order is newest first (the guide shows it, it does
 * not promise it — the backfill does not depend on order), and a custom question's `values` holds the
 * option KEY. `catalogueAnswer` accepts a key or either language's label, so either reading works.
 */

export interface FakeLead {
  id: string;
  form_id: string;
  created_time: string;
  field_data: Array<{ name: string; values: string[] }>;
  ad_id: string | null;
  campaign_id: string | null;
}

type Answer = { status: number; body: unknown };
const PAGE_MAX = 100;

/** `2026-11-03T14:00:00.000Z` → `2026-11-03T14:00:00+0000`, the form Meta writes. */
export const metaTime = (d: Date): string => `${d.toISOString().slice(0, 19)}+0000`;

export class FakeLeads {
  /** Every lead, newest first per form, as Meta lists them. */
  readonly leads: FakeLead[] = [];

  constructor(private readonly ids: () => string, private readonly trace: () => string) {}

  /** A person submits the form (the test's stand-in for the Lead Ads Testing Tool). */
  submit(formId: string, answers: Record<string, string>, at: Date, ad?: { ad_id?: string; campaign_id?: string }): FakeLead {
    const lead: FakeLead = {
      id: this.ids(), form_id: formId, created_time: metaTime(at),
      field_data: Object.entries(answers).map(([name, v]) => ({ name, values: [v] })),
      ad_id: ad?.ad_id ?? null, campaign_id: ad?.campaign_id ?? null,
    };
    this.leads.push(lead);
    return lead;
  }

  /** The form a lead was collected on, or null if the id is not a lead. */
  formOf(id: string): string | null {
    return this.leads.find((l) => l.id === id)?.form_id ?? null;
  }

  /**
   * GET /{v}/{lead_id}?fields=… (B4b) — one lead, read by the id a leadgen webhook carried: "You can use
   * `leadgen_id` to retrieve data associated with the lead" (retrieving guide). Page token only.
   */
  read(id: string, fields?: string): Answer | null {
    const l = this.leads.find((x) => x.id === id);
    return l ? { status: 200, body: pick({ ...l }, fields, ["id"]) } : null;
  }

  list(formId: string, b: Record<string, string>): Answer {
    let since: number | null = null;
    if (b.filtering) {
      let f: unknown;
      try {
        f = JSON.parse(b.filtering);
      } catch {
        return graphError(400, 100, "OAuthException", "(#100) filtering must be a JSON array", this.trace());
      }
      for (const rule of Array.isArray(f) ? (f as Array<Record<string, unknown>>) : []) {
        if (rule.field !== "time_created" || rule.operator !== "GREATER_THAN" || typeof rule.value !== "number") {
          return graphError(400, 100, "OAuthException", "(#100) Unsupported filtering on leads", this.trace());
        }
        since = rule.value;
      }
    }
    const limit = Math.min(Number(b.limit ?? 25) || 25, PAGE_MAX);
    const all = this.leads
      .filter((l) => l.form_id === formId && (since === null || Date.parse(l.created_time.replace("+0000", "Z")) / 1000 > since))
      .sort((x, y) => y.created_time.localeCompare(x.created_time) || y.id.localeCompare(x.id));
    const start = b.after ? Number(Buffer.from(b.after, "base64url").toString()) : 0;
    const page = all.slice(start, start + limit);
    const cursor = (n: number) => Buffer.from(String(n)).toString("base64url");
    const more = start + limit < all.length;
    return {
      status: 200,
      body: {
        data: page.map((l) => pick({ ...l }, b.fields, ["id"])),
        paging: { cursors: { before: cursor(start), after: cursor(start + page.length) }, ...(more ? { next: `https://graph.facebook.com/${formId}/leads?after=${cursor(start + page.length)}` } : {}) },
      },
    };
  }
}
