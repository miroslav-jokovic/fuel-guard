import type { FakeMetaAccount } from "./fakeMeta.js";
import { graphError, pick } from "./fakeMetaShapes.js";

/**
 * FakeMeta's campaigns: create, read, update, and the account's campaign list — split out of `fakeMeta.ts`
 * (Publisher L3, 2026-11-05) by concern, as its ad sets, ads, forms and rules already were. The shapes and
 * the rules (special_ad_categories required, ACTIVE or PAUSED at creation, a $100 spend_cap minimum) are
 * the ones `fakeMeta.ts`'s header cites, read 2026-11-02.
 */

export interface FakeCampaign {
  id: string;
  account_id: string;
  name: string;
  objective: string | null;
  /** As sent; Meta defaults it to AUCTION (campaign reference) — read back by the L3 contract suite. */
  buying_type?: string; // absent only on a campaign a test planted
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  special_ad_categories: string[];
  /** Read back as sent; Meta defaults it to the account's tax country when absent (Special Ad Category page). */
  special_ad_category_country: string[] | null;
  spend_cap: string | null;
  daily_budget: string | null;
}

type Answer = { status: number; body: unknown };

const STATUSES = ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"] as const;
const SPECIAL = ["NONE", "EMPLOYMENT", "HOUSING", "CREDIT", "ISSUES_ELECTIONS_POLITICS", "ONLINE_GAMBLING_AND_GAMING", "FINANCIAL_PRODUCTS_SERVICES"];
const SPEND_CAP_MIN_CENTS = 10_000;

export class FakeCampaigns {
  readonly campaigns = new Map<string, FakeCampaign>();

  constructor(
    private readonly nextId: () => string,
    private readonly traceId: () => string,
    private readonly accounts: Map<string, FakeMetaAccount>,
  ) {}

  create(accountId: string, b: Record<string, string>): Answer {
    if (!this.accounts.has(accountId)) return graphError(400, 100, "OAuthException", "(#100) Ad account does not exist", this.traceId());
    let categories: unknown;
    try {
      categories = b.special_ad_categories === undefined ? undefined : JSON.parse(b.special_ad_categories);
    } catch {
      categories = null;
    }
    if (!Array.isArray(categories) || categories.some((c) => !SPECIAL.includes(String(c)))) {
      return graphError(400, 100, "OAuthException", "(#100) The parameter special_ad_categories is required", this.traceId());
    }
    if (b.status !== undefined && b.status !== "ACTIVE" && b.status !== "PAUSED") {
      return graphError(400, 100, "OAuthException", "(#100) Only ACTIVE and PAUSED are valid during creation", this.traceId());
    }
    if (b.spend_cap !== undefined && !(Number(b.spend_cap) >= SPEND_CAP_MIN_CENTS)) {
      return graphError(400, 100, "OAuthException", "(#100) spend_cap must be at least $100", this.traceId());
    }
    const id = this.nextId();
    this.campaigns.set(id, {
      id, account_id: accountId, name: b.name ?? "", objective: b.objective ?? null, buying_type: b.buying_type ?? "AUCTION", status: (b.status as FakeCampaign["status"]) ?? "ACTIVE",
      special_ad_categories: (categories as string[]).map(String), special_ad_category_country: countries(b.special_ad_category_country), spend_cap: b.spend_cap ?? null, daily_budget: b.daily_budget ?? null,
    });
    return { status: 200, body: { id, success: true } };
  }

  /** `act_{id}/campaigns`, narrowed by name as every list is (`listByName`). */
  listOf(accountId: string, b: Record<string, string>): Answer {
    return listByName([...this.campaigns.values()].filter((c) => c.account_id === accountId), b, this.traceId);
  }

  read(id: string, fields?: string): Answer {
    const c = this.campaigns.get(id);
    if (!c) return graphError(400, 100, "GraphMethodException", `Unsupported get request. Object with ID '${id}' does not exist.`, this.traceId(), 33);
    return { status: 200, body: pick({ ...c, effective_status: c.status }, fields, ["id"]) };
  }

  update(id: string, b: Record<string, string>): Answer {
    const c = this.campaigns.get(id);
    if (!c) return graphError(400, 100, "GraphMethodException", `Unsupported post request. Object with ID '${id}' does not exist.`, this.traceId(), 33);
    if (b.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(b.status)) return graphError(400, 100, "OAuthException", "(#100) Invalid status", this.traceId());
      c.status = b.status as FakeCampaign["status"];
    }
    if (b.daily_budget !== undefined) c.daily_budget = b.daily_budget;
    if (b.spend_cap !== undefined) c.spend_cap = b.spend_cap;
    return { status: 200, body: { success: true } };
  }
}

/** An edge read: `{ data }`, narrowed by a name-EQUAL `filtering` (the one filter our callers send). */
export function listByName(rows: Array<{ name: string }>, b: Record<string, string>, traceId: () => string): Answer {
  let filters: unknown;
  try {
    filters = b.filtering === undefined ? [] : JSON.parse(b.filtering);
  } catch {
    filters = null;
  }
  if (!Array.isArray(filters)) return graphError(400, 100, "OAuthException", "(#100) filtering must be an array", traceId());
  let out = rows;
  for (const f of filters as Array<{ field?: unknown; operator?: unknown; value?: unknown }>) {
    if (f.field !== "name" || f.operator !== "EQUAL") return graphError(400, 100, "OAuthException", `(#100) FakeMeta filters only name EQUAL, got ${String(f.field)} ${String(f.operator)}`, traceId());
    out = out.filter((r) => r.name === f.value);
  }
  return { status: 200, body: { data: out.map((r) => pick({ ...r }, b.fields, ["id"])) } };
}

function countries(raw: string | undefined): string[] | null {
  try {
    const v: unknown = raw === undefined ? null : JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : null;
  } catch {
    return null;
  }
}
