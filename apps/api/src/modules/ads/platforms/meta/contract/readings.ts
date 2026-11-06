import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * FakeMeta's "OUR reading" lines, as requests whose answers can be recorded and compared (stage2-kit, L4).
 *
 * Several shapes in the fakes are marked OUR reading: what Meta's pages did not say and the fake had to
 * choose (`fakeMeta.ts`: the HTTP status of an error and where `error_subcode` sits; `fakeMetaAds.ts`: one
 * entry under `images`, the hash being the MD5 of the bytes, the same hash on a re-upload;
 * `fakeMetaEvents.ts`: the Conversions API's success body and its refusal). A prose comment cannot be
 * checked, so each reading below is the one request that shows it and the few things observed in the
 * answer — a status, a code, a type, a yes/no — never an id, a token or a time, so a recording is the
 * same on every run and safe to commit.
 *
 * `readings.recorded.json` is what FakeMeta answers, committed. The contract tests re-record every reading
 * on the target `ADS_TARGET` names and diff it against that file: on the fake, a difference means the fake
 * drifted from its own committed reading; on the sandbox (`pnpm ads:certify`), it means Meta answers
 * otherwise and the fake named in the difference is corrected, re-recorded and certified again (§4R L4).
 */

export interface ReadingTarget {
  base: string;
  token: string;
  accountId: string;
  datasetId: string | null;
  leadId: string | null;
  testEventCode: string | null;
}

export type Observed = Record<string, string | number | boolean | null>;

export interface Reading {
  id: string;
  /** The fake whose OUR-reading comment this settles, which a difference says to correct. */
  fake: string;
  ask(t: ReadingTarget): Promise<Observed>;
}

export interface Recording {
  [id: string]: { fake: string; observed: Observed };
}

export const RECORDED = new URL("./readings.recorded.json", import.meta.url);

/** The committed recording: FakeMeta's answers. */
export function committedReadings(): Recording {
  return (JSON.parse(readFileSync(RECORDED, "utf8")) as { readings: Recording }).readings;
}

/** A 1×1 PNG: the smallest image an ad account takes. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function call(t: ReadingTarget, method: "GET" | "POST", path: string, body?: Record<string, string>) {
  const res = await fetch(`${t.base}/${path}`, {
    method,
    headers: { authorization: `Bearer ${t.token}`, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: body ? new URLSearchParams(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, body: json ?? {} };
}

const kind = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const err = (b: Record<string, unknown>) => (b.error ?? {}) as Record<string, unknown>;

function needs(t: ReadingTarget): { datasetId: string; leadId: string } {
  if (!t.datasetId || !t.leadId) throw new Error("the Conversions API readings need a dataset and a lead the target knows (META_SANDBOX_DATASET_ID, META_SANDBOX_LEAD_ID on the sandbox)");
  return { datasetId: t.datasetId, leadId: t.leadId };
}

const crmEvent = (leadId: string, ageS: number) => ({
  event_name: "Lead", event_time: Math.floor(Date.now() / 1000) - ageS, event_id: `reading-${leadId}-${ageS}`,
  action_source: "system_generated", user_data: { lead_id: leadId }, custom_data: { event_source: "crm", lead_event_source: "Silvicom 360" },
});

/** The Graph readings: the Publisher's (fakeMeta.ts, fakeMetaAds.ts). */
export const GRAPH_READINGS: readonly Reading[] = [
  {
    id: "error-envelope",
    fake: "platforms/simulator/fakeMeta.ts",
    async ask(t) {
      const r = await call(t, "GET", "999999999999?fields=id");
      const e = err(r.body);
      return { status: r.status, "error.code": kind(e.code) === "number" ? (e.code as number) : kind(e.code), "error.type": kind(e.type), "error.error_subcode": kind(e.error_subcode), "error.fbtrace_id": kind(e.fbtrace_id), "error_subcode outside error": "error_subcode" in r.body };
    },
  },
  {
    id: "image-upload",
    fake: "platforms/simulator/fakeMetaAds.ts",
    async ask(t) {
      const once = await call(t, "POST", `act_${t.accountId}/adimages`, { bytes: PNG });
      const twice = await call(t, "POST", `act_${t.accountId}/adimages`, { bytes: PNG });
      const entries = (b: Record<string, unknown>) => Object.values((b.images ?? {}) as Record<string, { hash?: unknown; url?: unknown }>);
      const first = entries(once.body)[0];
      return {
        status: once.status,
        "images entries": entries(once.body).length,
        "hash is the md5 of the bytes": first?.hash === createHash("md5").update(Buffer.from(PNG, "base64")).digest("hex"),
        "re-upload answers the same hash": first?.hash !== undefined && entries(twice.body)[0]?.hash === first.hash,
        "url": kind(first?.url),
      };
    },
  },
];

/** The Conversions API readings: the Outcome feed's (fakeMetaEvents.ts). */
export const EVENTS_READINGS: readonly Reading[] = [
  {
    id: "events-accepted",
    fake: "platforms/simulator/fakeMetaEvents.ts",
    async ask(t) {
      const { datasetId, leadId } = needs(t);
      const r = await call(t, "POST", `${datasetId}/events`, { data: JSON.stringify([crmEvent(leadId, 60)]), ...(t.testEventCode ? { test_event_code: t.testEventCode } : {}) });
      return { status: r.status, events_received: kind(r.body.events_received) === "number" ? (r.body.events_received as number) : kind(r.body.events_received), messages: kind(r.body.messages), fbtrace_id: kind(r.body.fbtrace_id) };
    },
  },
  {
    id: "events-older-than-7-days",
    fake: "platforms/simulator/fakeMetaEvents.ts",
    async ask(t) {
      const { datasetId, leadId } = needs(t);
      const r = await call(t, "POST", `${datasetId}/events`, { data: JSON.stringify([crmEvent(leadId, 8 * 24 * 3600)]), ...(t.testEventCode ? { test_event_code: t.testEventCode } : {}) });
      const e = err(r.body);
      return { status: r.status, "error.code": kind(e.code) === "number" ? (e.code as number) : kind(e.code), events_received: kind(r.body.events_received) };
    },
  },
];

export async function record(readings: readonly Reading[], t: ReadingTarget): Promise<Recording> {
  const out: Recording = {};
  for (const r of readings) out[r.id] = { fake: r.fake, observed: await r.ask(t) };
  return out;
}

/** Every way `recorded` is not `committed`, one line each, naming the reading, the field and the fake to correct. */
export function diffReadings(committed: Recording, recorded: Recording): string[] {
  const out: string[] = [];
  for (const [id, rec] of Object.entries(recorded)) {
    const was = committed[id];
    if (!was) { out.push(`${id}: no committed reading — add it to readings.recorded.json from the fake`); continue; }
    for (const field of [...new Set([...Object.keys(was.observed), ...Object.keys(rec.observed)])]) {
      const a = was.observed[field], b = rec.observed[field];
      if (a !== b) out.push(`${id} ${JSON.stringify(field)}: committed ${JSON.stringify(a ?? "(absent)")}, target answered ${JSON.stringify(b ?? "(absent)")} — correct ${was.fake}`);
    }
  }
  return out;
}

/**
 * Re-record one group on the target and diff it against the committed file. Under `pnpm ads:certify` the
 * command sets ADS_CERTIFY_OUT, and the recording and its differences land there for the run's verdict.
 */
export async function rerecord(group: string, readings: readonly Reading[], t: ReadingTarget & { name: string }, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const recorded = await record(readings, t);
  const differences = diffReadings(committedReadings(), recorded);
  if (env.ADS_CERTIFY_OUT) writeFileSync(join(env.ADS_CERTIFY_OUT, `readings-${group}.json`), `${JSON.stringify({ group, target: t.name, recorded, differences }, null, 2)}\n`);
  return differences;
}
