import { graphError } from "./fakeMetaShapes.js";

/**
 * The faults §4R injects into Meta's answers, and the answer each one gives — split out of `fakeMeta.ts`
 * (Publisher L3, 2026-11-05) because two things inject them now:
 *
 *   · FakeMeta itself, for every contract test written before L3 (`meta.inject(…)`);
 *   · the fault proxy in front of a contract TARGET (`meta/contract/faultProxy.ts`), which injects the same
 *     faults on the wire whether the target behind it is FakeMeta or Meta's sandbox — so `ADS_TARGET=sandbox`
 *     (L4) runs the very suite L3 runs, faults included, without a fake in the way.
 *
 * One book of faults and one answer per fault, so a fault cannot mean one thing to the fake and another to
 * the proxy. The answers' shapes and their HTTP statuses are `fakeMeta.ts`'s header's (and its ⚠ reading).
 */

export type FakeMetaFault =
  /** 80004 / 2446079, with the usage header at 100 %. */
  | { kind: "throttle"; regainMinutes?: number }
  /** code 1 or 2, HTTP 500. */
  | { kind: "temporary"; code?: 1 | 2 }
  /** 190 / 463: the token expired or was revoked. */
  | { kind: "token_expired" }
  /** Holds the response until the caller gives up (the request is never answered). */
  | { kind: "hang" }
  /** The act HAPPENS, then the answer is an error — the half-created object the adapter must resume. */
  | { kind: "applied_then_temporary" }
  /** `{ success: true }` and nothing changes — why the adapter answers from a read-back, not the 200 (B3). */
  | { kind: "accepted_not_applied" };

/** A fault answered in place of the call: the act never reaches the platform. */
export type AnsweredFault = Extract<FakeMetaFault, { kind: "throttle" | "temporary" | "token_expired" }>;

interface FaultRule {
  method: "GET" | "POST";
  /** Matches the path after the version, e.g. `act_1/campaigns` or a campaign id. */
  path: RegExp;
  fault: FakeMetaFault;
  times: number;
}

export class FaultBook {
  private rules: FaultRule[] = [];

  /** The next `times` requests matching method + path get this fault instead of their answer. */
  inject(method: "GET" | "POST", path: RegExp, fault: FakeMetaFault, times = 1): void {
    this.rules.push({ method, path, fault, times });
  }

  /** The fault this request meets, spending one of its `times`; null when none is waiting for it. */
  take(method: string, path: string): FakeMetaFault | null {
    const rule = this.rules.find((f) => f.method === method && f.path.test(path) && f.times > 0);
    if (!rule) return null;
    rule.times -= 1;
    return rule.fault;
  }
}

export interface FaultAnswer {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/** What Meta answers for an answered fault (`fakeMeta.ts`'s header cites each code). */
export function faultAnswer(f: AnsweredFault, businessId: string, traceId: string): FaultAnswer {
  if (f.kind === "throttle") {
    const usage = { [businessId]: [{ type: "ads_management", call_count: 100, total_cputime: 34, total_time: 41, estimated_time_to_regain_access: f.regainMinutes ?? 5 }] };
    return { ...graphError(400, 80004, "OAuthException", "(#80004) There have been too many calls to this ad-account.", traceId, 2446079), headers: { "X-Business-Use-Case-Usage": JSON.stringify(usage) } };
  }
  if (f.kind === "token_expired") return { ...graphError(400, 190, "OAuthException", "Error validating access token: Session has expired.", traceId, 463), headers: {} };
  const code = f.code ?? 2;
  return { ...graphError(500, code, "OAuthException", code === 1 ? "An unknown error occurred" : "An unexpected error has occurred. Please retry your request later.", traceId), headers: {} };
}
