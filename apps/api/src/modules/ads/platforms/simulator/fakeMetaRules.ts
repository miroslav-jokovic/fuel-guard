import { graphError, pick } from "./fakeMetaShapes.js";

/**
 * FakeMeta's Automated Rules (B3b), apart from `fakeMeta.ts` for the file budget. Shapes from the
 * schedule-based rules guide and the evaluation-spec page (read 2026-11-02):
 *   POST /{v}/act_{id}/adrules_library   `name`, `evaluation_spec`, `execution_spec`, `schedule_spec` → `{ id }`
 *   GET  /{v}/act_{id}/adrules_library   `{ data: [...] }`
 *   POST /{v}/{rule_id}                   update the same fields, or `status` ENABLED / DISABLED
 * https://developers.facebook.com/docs/marketing-api/ad-rules/guides/scheduled-based-rules
 *
 * `refuseSpendPause` plays U2: error 2703 has been reported for a PAUSE rule with a spend condition,
 * and nobody has tried it on our sandbox yet (V2). On, the fake refuses exactly those rules, so the
 * sync's fallback — record the refusal, keep the others, leave that rule to our monitor — is tested
 * before Meta decides it for us. ⚠ The page gives no create response; `{ id }` is our reading.
 */

export interface FakeRule {
  id: string;
  account_id: string;
  name: string;
  status: "ENABLED" | "DISABLED";
  evaluation_spec: unknown;
  execution_spec: unknown;
  schedule_spec: unknown;
}

type Answer = { status: number; body: unknown };

export class FakeRules {
  readonly rules = new Map<string, FakeRule>();
  refuseSpendPause = false;

  constructor(private readonly ids: () => string, private readonly trace: () => string) {}

  create(accountId: string, b: Record<string, string>): Answer {
    const specs = this.specs(b);
    if ("status" in specs) return specs;
    if (!b.name) return graphError(400, 100, "OAuthException", "(#100) name is required", this.trace());
    const id = this.ids();
    this.rules.set(id, { id, account_id: accountId, name: b.name, status: "ENABLED", ...specs });
    return { status: 200, body: { id } };
  }

  list(accountId: string, fields?: string): Answer {
    return { status: 200, body: { data: [...this.rules.values()].filter((r) => r.account_id === accountId).map((r) => pick({ ...r }, fields, ["id"])) } };
  }

  /** `POST /{rule_id}`; null when the id is not a rule (the caller routes on). */
  update(id: string, b: Record<string, string>): Answer | null {
    const r = this.rules.get(id);
    if (!r) return null;
    if (b.status !== undefined) {
      if (b.status !== "ENABLED" && b.status !== "DISABLED") return graphError(400, 100, "OAuthException", "(#100) Invalid status", this.trace());
      r.status = b.status;
    }
    if (b.evaluation_spec !== undefined) {
      const specs = this.specs(b);
      if ("status" in specs) return specs;
      Object.assign(r, specs);
    }
    return { status: 200, body: { success: true } };
  }

  private specs(b: Record<string, string>): Answer | Pick<FakeRule, "evaluation_spec" | "execution_spec" | "schedule_spec"> {
    let evaluation: { evaluation_type?: unknown; filters?: Array<{ field?: unknown }> };
    let execution: { execution_type?: unknown };
    let schedule: unknown;
    try {
      evaluation = JSON.parse(b.evaluation_spec ?? "null");
      execution = JSON.parse(b.execution_spec ?? "null");
      schedule = b.schedule_spec === undefined ? null : JSON.parse(b.schedule_spec);
    } catch {
      return graphError(400, 100, "OAuthException", "(#100) specs must be JSON", this.trace());
    }
    if (!evaluation || !Array.isArray(evaluation.filters) || !execution?.execution_type) return graphError(400, 100, "OAuthException", "(#100) evaluation_spec and execution_spec are required", this.trace());
    if (evaluation.evaluation_type === "SCHEDULE" && !schedule) return graphError(400, 100, "OAuthException", "(#100) schedule_spec is required for a schedule-based rule", this.trace());
    const spends = evaluation.filters.some((f) => f.field === "spent");
    if (this.refuseSpendPause && spends && execution.execution_type === "PAUSE") {
      return graphError(400, 2703, "OAuthException", "(#2703) This rule cannot pause on a spend condition", this.trace());
    }
    return { evaluation_spec: evaluation, execution_spec: execution, schedule_spec: schedule };
  }
}
