import { graphError } from "./fakeMetaShapes.js";

/**
 * FakeMeta's Conversions API dataset (B6, the outcome feed), apart from `fakeMeta.ts` for the file budget.
 * What it implements, and where each shape is from (read 2026-11-06):
 *
 *   POST /{v}/{dataset_id}/events   form fields `data` (a JSON array of events, "up to 1,000") and optionally
 *                                   `test_event_code` ("events sent with `test_event_code` are not dropped").
 *                                   https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api
 *   An event older than 7 days      "we return an error for the entire request and process no events".
 *                                   https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event
 *   Duplicates                      "the same `event_id` and `event_name` … we keep only the first copy" (same page,
 *                                   within 48 hours). The fake keeps the first copy forever: a stricter test.
 *   A CRM event                     `action_source: "system_generated"`, `user_data.lead_id`, `custom_data`
 *                                   `{ event_source: "crm", lead_event_source }`.
 *                                   https://developers.facebook.com/documentation/ads-commerce/conversions-api/guides/conversions-api-crm-for-platforms
 *
 * ⚠ OUR READINGS, marked for L4 (the same sends re-run against the sandbox's Events Manager test code):
 *   · The success body `{ events_received, messages: [], fbtrace_id }`: none of the three pages prints one.
 *   · A refused request is Graph's error envelope, code 100 (invalid parameter), HTTP 400.
 *   · A batch with one invalid event: the using-the-api page says valid events with an `event_id` are still
 *     kept and the request errors; the CRM guide says "the whole batch will be discarded". The fake takes the
 *     guide's (stricter) side and stores nothing, and the feed resends each event alone, so it is right
 *     under either reading.
 *   · Which token may write a dataset: the fake takes the account token (the system user's).
 *
 * `refuse(leadId)` plays a lead Meta will not take (an id it does not know): every request carrying it fails.
 */

export interface FakeCapiEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: string;
  user_data: { lead_id?: string };
  custom_data: { event_source?: string; lead_event_source?: string };
  test_event_code: string | null;
}

type Answer = { status: number; body: unknown };

const MAX_AGE_S = 7 * 24 * 60 * 60;

export class FakeDatasets {
  /** Every accepted event per dataset, first copy only, in arrival order: the test's "exactly one accepted". */
  readonly events = new Map<string, FakeCapiEvent[]>();
  /** Requests answered, accepted or not, so a test can count sends. */
  requests = 0;
  private readonly refused = new Set<string>();

  constructor(private readonly trace: () => string, private readonly now: () => Date) {}

  /** A dataset the token may write. A dataset not created here does not exist. */
  create(datasetId: string): void {
    if (!this.events.has(datasetId)) this.events.set(datasetId, []);
  }

  refuse(leadId: string): void {
    this.refused.add(leadId);
  }

  accepted(datasetId: string): FakeCapiEvent[] {
    return [...(this.events.get(datasetId) ?? [])];
  }

  route(method: string, path: string, body: Record<string, string>): Answer | null {
    const m = /^(\d+)\/events$/.exec(path);
    if (!m || method !== "POST") return null;
    this.requests += 1;
    const stored = this.events.get(m[1]!);
    if (!stored) return graphError(400, 100, "GraphMethodException", `Unsupported post request. Object with ID '${m[1]}' does not exist.`, this.trace(), 33);
    let data: unknown;
    try {
      data = JSON.parse(body.data ?? "");
    } catch {
      return graphError(400, 100, "OAuthException", "(#100) param data must be an array.", this.trace());
    }
    if (!Array.isArray(data) || data.length === 0 || data.length > 1000) return graphError(400, 100, "OAuthException", "(#100) param data must be an array of 1 to 1000 events.", this.trace());
    const nowS = Math.floor(this.now().getTime() / 1000);
    const events: FakeCapiEvent[] = [];
    for (const raw of data as Array<Record<string, unknown>>) {
      const e = raw as unknown as FakeCapiEvent;
      if (typeof e.event_name !== "string" || typeof e.event_time !== "number" || typeof e.event_id !== "string") {
        return graphError(400, 100, "OAuthException", "(#100) event_name, event_time and event_id are required.", this.trace());
      }
      if (nowS - e.event_time > MAX_AGE_S) return graphError(400, 100, "OAuthException", "(#100) event_time is more than 7 days in the past.", this.trace(), 2804003);
      if (e.action_source !== "system_generated" || e.custom_data?.event_source !== "crm" || !e.custom_data?.lead_event_source) {
        return graphError(400, 100, "OAuthException", "(#100) a CRM event needs action_source system_generated and custom_data event_source crm + lead_event_source.", this.trace());
      }
      if (!e.user_data?.lead_id || this.refused.has(e.user_data.lead_id)) {
        return graphError(400, 100, "OAuthException", "(#100) user_data has no lead this dataset can match.", this.trace(), 2804050);
      }
      events.push({ ...e, test_event_code: body.test_event_code ?? null });
    }
    for (const e of events) {
      if (!stored.some((s) => s.event_id === e.event_id && s.event_name === e.event_name)) stored.push(e);
    }
    return { status: 200, body: { events_received: events.length, messages: [], fbtrace_id: this.trace() } };
  }
}
