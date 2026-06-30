# FleetGuard — Claude AI Verification Layer

> An intelligent layer that sits **after** the deterministic rules engine to verify transactions and
> locations, judge plausibility, and produce explainable, prioritized risk assessments.
> Server-side only (Express). v1-additive — the rules engine works without it.

---

## 1. Why a second layer (and why it doesn't replace the rules)

The deterministic rules engine (docs 02 §7) is fast, free, and explainable — it catches the
*mechanical* violations (odometer regression, over-capacity, MPG cliffs). But some fraud signals are
**contextual and fuzzy**, and writing brittle `if` statements for them is a losing game:

- **Location plausibility** — does the fuel-station location make sense given the vehicle's recent
  stations, its route, and the miles driven? A truck that fueled in Chicago at 2pm and "fuels" in
  Dallas at 4pm is impossible — but encoding every geographic case in SQL is hopeless.
- **Pattern narrative** — a *cluster* of individually-minor events (slightly-low MPG + odd hour +
  unfamiliar station, repeating weekly) that no single rule trips but a reviewer would call
  suspicious.
- **Human-readable triage** — turning raw evidence into a short, plain-language risk summary a busy
  fleet manager can act on in seconds, with a recommended action.

**Division of labor:** rules decide *what mechanically violated*; Claude decides *how suspicious the
overall picture is and why*, in language. Claude never silently auto-resolves or auto-accuses — it
produces an assessment a human reviews. This keeps the system explainable and auditable.

---

## 2. When the layer runs (and cost control)

Calling an LLM on **every** fill-up is unnecessary and costly. The layer is **selective**:

| Trigger | Model | Rationale |
|---------|-------|-----------|
| A transaction fires **≥1 anomaly** of severity ≥ medium | **Haiku** (cheap, fast) | First-pass enrichment: location check + risk summary on the flagged subset only. |
| A transaction is **high/critical**, or Haiku flags `needs_deeper_review` | **Sonnet** | Deeper reasoning over richer context (recent history, route, driver pattern). |
| Manager clicks **"AI re-examine"** on an anomaly | **Sonnet** | On-demand, human-initiated. |
| **Weekly batch** over each vehicle's week of activity | **Sonnet** | Catches slow patterns no single txn trips. Scheduled job. |

Controls: a hard **monthly token budget per org** (config), **rate limiting** (M8), response
**caching** keyed by transaction content hash (re-runs are free unless data changed), and a global
**kill-switch** (`ai_verification_enabled`) so the product fully functions with the layer off.

> Model strings (current): `claude-haiku-4-5`, `claude-sonnet-4-6`. Pin versions in env; never
> hardcode in app logic.

---

## 3. What Claude is given, and what it must return

**Never** hand the model raw secrets or other tenants' data. The Express service assembles a tight,
org-scoped context and requires a **structured JSON** response (tool-use / structured output, Zod-
validated on return).

### Input context (assembled server-side)
```jsonc
{
  "vehicle":   { "unit": "T-104", "fuel_type": "diesel", "tank_capacity_gal": 120, "baseline_mpg": 6.4 },
  "transaction": {
    "fueled_at": "2026-06-21T14:05:00-05:00",
    "odometer": 184230, "gallons": 119.6, "price_per_gal": 3.91, "total_cost": 467.6,
    "station": { "name": "Loves #221", "city": "Effingham", "state": "IL", "lat": 39.12, "lng": -88.55 }
  },
  "rules_fired": [
    { "ruleId": "exceeds_tank_capacity", "severity": "critical", "evidence": {"gallons":119.6,"capacity":120} }
  ],
  "recent_transactions": [ /* last ~8 fills: time, station city/state/latlng, miles, mpg */ ],
  "operating_hours": { "start":"05:00","end":"20:00","tz":"America/Chicago" }
}
```

### Required output (Zod-validated)
```jsonc
{
  "risk_score": 0-100,                       // model's overall suspicion
  "risk_level": "low|medium|high|critical",
  "location_assessment": {
    "plausible": true|false,
    "reason": "string",                      // e.g. distance/time vs. previous station impossible
    "implied_speed_mph": 0.0                  // null if not computable
  },
  "summary": "1-3 sentence plain-language explanation for a fleet manager",
  "recommended_action": "monitor|investigate|contact_driver|block_card|none",
  "contributing_factors": ["string", ...],
  "needs_deeper_review": true|false,         // Haiku → escalate to Sonnet
  "confidence": 0.0-1.0
}
```

**Guardrails:** the system prompt instructs Claude to treat numbers as evidence, never invent
station distances it can't derive, state uncertainty, and **never** issue an accusation as fact —
only a risk assessment with reasons. Output that fails Zod validation is discarded (the rule-based
anomaly still stands).

### Location math is done in code, not by the model
Great-circle distance between consecutive stations and elapsed time → **implied speed** is computed
**deterministically in the API** and passed to Claude as a fact. The model reasons about whether the
*pattern* is suspicious; it does not do trigonometry. This keeps the hard numbers exact and the model
focused on judgment.

---

## 4. Where it lives (architecture)

```
fuel txn scored by rules engine (docs 01 §5)
        │  (≥1 anomaly, severity ≥ medium)  + ai_verification_enabled
        ▼
apps/api  services/aiVerification/
  1. assemble org-scoped context (no cross-tenant data)
  2. compute geo distance + implied speed in code
  3. check cache (content hash) → return if hit
  4. call Claude (Haiku → maybe Sonnet) with structured-output schema
  5. Zod-validate response; on fail, log + skip
  6. persist ai_verifications row; attach to the anomaly/txn
  7. if risk_level >= high → raise/boost notification (docs Phase 8)
        ▼
packages/shared/aiSchemas.ts  (input + output Zod, shared with tests)
```

- The **Anthropic API key** is a server-only secret (`ANTHROPIC_API_KEY`), Railway env, never in the
  browser bundle — same discipline as the Supabase service-role key.
- Failures are non-blocking: if Claude is unreachable or over budget, the transaction keeps its
  rule-based anomalies and the UI shows "AI assessment unavailable."

---

## 5. Schema — `ai_verifications`

```sql
create table ai_verifications (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  transaction_id uuid not null references fuel_transactions(id) on delete cascade,
  anomaly_id     uuid references anomalies(id) on delete set null,  -- if tied to one
  model          text not null,                 -- 'claude-haiku-4-5' | 'claude-sonnet-4-6'
  risk_score     int not null,                  -- 0-100
  risk_level     anomaly_severity not null,
  location_plausible boolean,
  implied_speed_mph  numeric(6,1),
  summary        text not null,
  recommended_action text not null,             -- monitor|investigate|contact_driver|block_card|none
  contributing_factors text[] not null default '{}',
  confidence     numeric(4,3),                  -- 0.000-1.000
  raw_response   jsonb not null default '{}',   -- full validated payload, for audit
  input_hash     text not null,                 -- cache key (content hash of context)
  token_usage    jsonb,                         -- {input, output} for budget tracking
  created_at     timestamptz not null default now()
);
create index on ai_verifications (org_id, created_at desc);
create index on ai_verifications (transaction_id);
create unique index on ai_verifications (org_id, input_hash);   -- cache / dedup
```

RLS (per 02 §5 pattern): **read** = org members; **write** = service role only (the API). Add a
column on `fuel_transactions`: `ai_risk_level anomaly_severity` (denormalized latest, for fast queue
sorting), updated when a verification is written.

Org settings additions (in `organizations` or `anomaly_thresholds`):
`ai_verification_enabled boolean default true`, `ai_monthly_token_budget int`, `ai_model_tier text`.

---

## 6. UX surface

- **Anomaly detail** shows an **"AI Assessment"** card: risk level badge, the plain-language
  `summary`, location verdict (plausible? implied speed), contributing factors, and the recommended
  action — clearly labeled *AI-generated, for review*.
- **Anomaly queue** gains an optional **AI risk** sort/filter so managers can triage by the model's
  prioritization, not just rule severity.
- **"AI re-examine"** button on any anomaly (Sonnet, on demand).
- Every AI run writes an `ai.verification_run` audit entry (who/when/model/cost).

---

## 7. Build phasing

This is **Phase 5.5** (after the rules engine, before/with dashboards) in the roadmap, kept behind
the kill-switch so it never blocks core delivery:
1. Schema + `packages/shared/aiSchemas.ts` (Zod in/out) + geo-distance util + unit tests (mock the API).
2. `aiVerification` service with caching, budget, Haiku→Sonnet escalation.
3. Wire into the scoring pipeline (selective triggers) + notifications boost.
4. UI: assessment card, queue AI-sort, re-examine button.
5. Weekly batch job (scheduled) for slow-pattern detection.

---

## 8. Risks & mitigations specific to this layer

- **Hallucinated distances/claims** → all hard numbers computed in code; model output Zod-validated;
  "for review" labeling; never auto-acts.
- **Cost runaway** → selective triggering, budget cap, caching, kill-switch.
- **Latency** → asynchronous; the rule-based anomaly appears instantly, the AI card fills in shortly
  after.
- **Prompt injection via station names / free-text** → treat all transaction text as untrusted data,
  delimit clearly in the prompt, never let it change instructions.
- **PII / data minimization** → send only what's needed; no driver PII beyond an internal id; org-scoped.
