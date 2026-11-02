import { graphError, pick } from "./fakeMetaShapes.js";

/**
 * FakeMeta's Instant Forms (B2b), apart from `fakeMeta.ts` only for the file budget. Shapes, read
 * 2026-11-02:
 *   POST /{v}/{page_id}/leadgen_forms   `name` + `questions` required; `privacy_policy { url, link_text ≤ 70 }`,
 *                                        `locale`, `block_display_for_non_targeted_viewer`, … → `{ id }`.
 *                                        https://developers.facebook.com/docs/graph-api/reference/page/leadgen_forms/
 *   GET  /{v}/{page_id}/leadgen_forms   the Page's forms, `{ data }`.
 *   GET  /{v}/{form_id}?fields=…        `id, name, status, locale, questions, privacy_policy_url`.
 *                                        https://developers.facebook.com/docs/marketing-api/reference/lead-gen-form/
 * Made with the PAGE's token (Lead Ads "create" guide: "access_token set to your Page access token"):
 * `fakeMeta.ts` routes a Page edge only for that Page's token.
 *
 * ⚠ The reference marks `privacy_policy` optional, yet a lead form cannot be published without one in
 * Ads Manager. This fake REQUIRES it (https), which is our reading; L4 re-runs the suite on the
 * sandbox to settle it. The question types are the reference's enum as far as our builder can send;
 * a type outside it is refused as Meta would (code 100).
 */

const KNOWN_TYPES = new Set(["CUSTOM", "FULL_NAME", "FIRST_NAME", "LAST_NAME", "EMAIL", "PHONE", "DOB", "GENDER", "CITY", "STATE", "ZIP", "POST_CODE", "STREET_ADDRESS", "COUNTRY", "JOB_TITLE", "COMPANY_NAME", "DATE_TIME"]);

export interface FakeForm {
  id: string;
  page_id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED" | "DELETED" | "DRAFT";
  locale: string;
  questions: Array<{ type: string; key: string; label?: string; options?: Array<{ key: string; value: string }> }>;
  privacy_policy_url: string;
}

type Answer = { status: number; body: unknown };

export class FakeForms {
  readonly forms = new Map<string, FakeForm>();

  constructor(private readonly ids: () => string, private readonly trace: () => string) {}

  create(pageId: string, b: Record<string, string>): Answer {
    const bad = (m: string) => graphError(400, 100, "OAuthException", `(#100) ${m}`, this.trace());
    if (!b.name) return bad("name is required");
    let questions: unknown;
    let privacy: unknown;
    try {
      questions = JSON.parse(b.questions ?? "null");
      privacy = JSON.parse(b.privacy_policy ?? "null");
    } catch {
      return bad("questions and privacy_policy must be JSON");
    }
    if (!Array.isArray(questions) || questions.length === 0) return bad("questions is required");
    for (const q of questions as Array<Record<string, unknown>>) {
      if (!KNOWN_TYPES.has(String(q.type))) return bad(`Unknown question type ${String(q.type)}`);
      if (q.type === "CUSTOM" && (typeof q.label !== "string" || !q.label)) return bad("A CUSTOM question needs a label");
    }
    const p = privacy as { url?: unknown; link_text?: unknown } | null;
    if (typeof p?.url !== "string" || !p.url.startsWith("https://")) return bad("privacy_policy.url must be an https URL");
    if (typeof p.link_text === "string" && p.link_text.length > 70) return bad("privacy_policy.link_text is at most 70 characters");
    const id = this.ids();
    this.forms.set(id, {
      id, page_id: pageId, name: b.name, status: "ACTIVE", locale: b.locale ?? "EN_US",
      questions: questions as FakeForm["questions"], privacy_policy_url: p.url,
    });
    return { status: 200, body: { id } };
  }

  list(pageId: string, fields?: string): Answer {
    return { status: 200, body: { data: [...this.forms.values()].filter((f) => f.page_id === pageId).map((f) => pick({ ...f }, fields, ["id"])) } };
  }

  read(id: string, fields?: string): Answer | null {
    const f = this.forms.get(id);
    return f ? { status: 200, body: pick({ ...f }, fields, ["id"]) } : null;
  }

  /** The Page this form belongs to (its reads need that Page's token), or null if it is not a form. */
  pageOf(id: string): string | null {
    return this.forms.get(id)?.page_id ?? null;
  }
}
