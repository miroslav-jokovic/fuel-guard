/**
 * An in-memory `card_fraud_record` and its two tables, for the API's unit tests (chunk 5c).
 *
 * WHY A FAKE AND NOT THE DATABASE. The API reads through PostgREST, which the unit suites do not run.
 * The SQL writer itself is proven in PGlite by `supabase/tests/card-fraud-incidents.test.mjs`, against
 * the full migration ledger; this file restates only the CONTRACT that migration 0438 documents above
 * the function, in its order: 'duplicate' when the attempt is stored anywhere, 'moved' when the card's
 * latest incident (opened_at desc, created_at desc) is not the id and version read, 'closed' when the
 * incident to update is resolved or dismissed, else 'recorded'. A test here proves what the SERVICE does
 * with those answers, never that the SQL gives them.
 *
 * Plug `tables` and `rpc` into `createSupabaseRecorder`. Reads answer only the filters they applied
 * (`supabase-recorder-does-not-filter`), so a read that drops `org_id` finds nothing.
 */
import type { RecordedQuery } from "./supabaseRecorder.js";

export interface StoredIncident {
  id: string;
  org_id: string;
  card_key: string;
  incident_key: string;
  card_ref: string;
  vehicle_id: string | null;
  opened_at: string;
  last_attempt_at: string;
  level: string;
  attempt_count: number;
  fuel_taken: boolean;
  failed_prompts: string[];
  places: unknown;
  steps: unknown;
  last_truck: unknown;
  version: number;
  status: string;
  created_seq: number;
}

export interface StoredAttempt {
  source: string;
  source_id: string;
  org_id: string;
  incident_id: string;
  attempted_at: string;
  step: string | null;
}

type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function createCardFraudStore() {
  const incidents: StoredIncident[] = [];
  const attempts: StoredAttempt[] = [];
  /** Runs once, inside the next `card_fraud_record` call, before it judges the read: a race. */
  let beforeNextWrite: (() => void) | null = null;
  let seq = 0;

  const eqOf = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;
  const latest = (org: string, cardKey: string) =>
    incidents
      .filter((i) => i.org_id === org && i.card_key === cardKey)
      .sort((x, y) => Date.parse(y.opened_at) - Date.parse(x.opened_at) || y.created_seq - x.created_seq)[0];
  const answer = (outcome: string, id: string | null = null, version: number | null = null) => [
    { outcome, incident_id: id, version },
  ];

  function record(a: Args) {
    if (beforeNextWrite) {
      const race = beforeNextWrite;
      beforeNextWrite = null;
      race();
    }
    if (attempts.some((x) => x.source === a.p_attempt_source && x.source_id === a.p_attempt_id)) return answer("duplicate");
    const l = latest(a.p_org, a.p_card_key);
    if ((l?.id ?? null) !== a.p_read_id || (l?.version ?? null) !== a.p_read_version) return answer("moved");
    const state = {
      last_attempt_at: a.p_last_attempt_at,
      level: a.p_level,
      attempt_count: a.p_attempt_count,
      fuel_taken: a.p_fuel_taken,
      failed_prompts: a.p_failed_prompts ?? [],
      places: a.p_places,
      steps: a.p_steps,
      last_truck: a.p_last_truck,
    };
    let row: StoredIncident;
    if (a.p_incident_id == null) {
      row = {
        id: `inc-${++seq}`, org_id: a.p_org, card_key: a.p_card_key, incident_key: a.p_incident_key,
        card_ref: a.p_card_ref, vehicle_id: a.p_vehicle_id, opened_at: a.p_opened_at, ...state,
        version: 1, status: "open", created_seq: seq,
      };
      incidents.push(row);
    } else {
      if (a.p_incident_id !== a.p_read_id) throw new Error("card_fraud_record: incident is not the one read");
      const found = incidents.find((i) => i.id === a.p_incident_id && i.org_id === a.p_org);
      if (!found || (found.status !== "open" && found.status !== "investigating")) return answer("closed");
      Object.assign(found, state, { version: found.version + 1 });
      row = found;
    }
    attempts.push({
      source: a.p_attempt_source, source_id: a.p_attempt_id, org_id: a.p_org, incident_id: row.id,
      attempted_at: a.p_attempted_at, step: a.p_step,
    });
    return answer("recorded", row.id, row.version);
  }

  return {
    incidents,
    attempts,
    /** Make the next write meet a store some other actor has just changed. */
    race(fn: () => void) {
      beforeNextWrite = fn;
    },
    tables: {
      card_fraud_incidents: (q: RecordedQuery) => {
        const org = eqOf(q, "org_id");
        const cardKey = eqOf(q, "card_key");
        const l = typeof org === "string" && typeof cardKey === "string" ? latest(org, cardKey) : undefined;
        return l ? [l] : [];
      },
      card_fraud_incident_attempts: (q: RecordedQuery) =>
        attempts.filter((x) => x.org_id === eqOf(q, "org_id") && x.incident_id === eqOf(q, "incident_id")),
    },
    rpc: (fn: string, args: unknown) => (fn === "card_fraud_record" ? record(args as Args) : null),
  };
}
