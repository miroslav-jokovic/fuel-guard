# FleetGuard — Product Overview (PRD)

> Fuel-theft prevention and fuel-efficiency monitoring for commercial fleets.
> Owner: Silvicom Inc. · Status: v1 (Enterprise) planning · Last updated: 2026-06-30

---

## 1. The problem

Fleet fuel is one of the largest controllable costs in operations, and it leaks in ways that are hard to see transaction-by-transaction. Industry reporting suggests the large majority of fleets experience regular fuel loss, and most incidents go undetected for months because no one is correlating **gallons purchased** against **miles actually driven**.

FleetGuard exists to close that gap. Every fill-up generates two numbers a driver can manipulate or mis-enter: the **odometer reading** and the **gallons dispensed**. By validating those two numbers against each vehicle's history, tank capacity, and expected efficiency, we surface the small set of transactions that don't add up — before they become a pattern.

### The three jobs FleetGuard does

1. **Prevent fuel stealing** — catch fuel that is paid for but never moves the truck (siphoning, fueling a personal vehicle or a container, station collusion, inflated gallons).
2. **Control MPG & usage** — track real fuel economy per vehicle/driver over time and flag abnormal drops that signal loss or a mechanical issue.
3. **Verify odometer integrity** — make sure drivers enter correct, plausible odometer readings at every fill-up, because every downstream calculation depends on it.

---

## 2. Who uses it (personas & roles)

| Role | Who | What they need |
|------|-----|----------------|
| **Org Admin** | Silvicom operations lead | Invite/manage users, configure vehicles, set anomaly thresholds, see everything, manage billing/settings. |
| **Fleet Manager** | Supervisor over a set of vehicles/drivers | Review the anomaly queue, investigate flagged fill-ups, manage vehicles & driver assignments, run reports. |
| **Driver** | Person fueling the vehicle | Fast, mobile-friendly fill-up entry (vehicle, odometer, gallons, cost, photo of pump/receipt), view own history. |
| **Auditor / Viewer** | Finance, internal audit | Read-only access to transactions, anomalies, and reports; export data. |

Roles are **per-organization** (multitenant). A user has exactly one role within an org for v1.

---

## 3. Core concepts (the domain model in plain words)

- **Organization (Tenant)** — a company. v1 launches with one (Silvicom Inc.) but every row is tenant-scoped so adding more is zero-rework.
- **Vehicle** — a unit in the fleet. Has a tank capacity, an expected/baseline MPG, fuel type, and a running odometer.
- **Driver** — a person who fuels vehicles. May be linked to a login user, or exist as a record only.
- **Fuel Transaction (Fill-up)** — the central object. One fueling event: which vehicle, which driver, when, where, gallons, price, total cost, and the **odometer reading entered at the pump**.
- **Anomaly** — a flag raised on a fill-up (or pattern of fill-ups) by the rules engine, with a severity, a reason, and a workflow status (open → investigating → resolved/dismissed).
- **Fuel Card** *(phase 2 import)* — external transactions imported from a card provider (e.g., WEX, Fuelman, EFS) reconciled against fill-ups.

---

## 4. The anomaly engine — what we actually detect

This is the heart of the product. Each fill-up is scored against a set of rules. Rules are configurable thresholds per organization, with sensible enterprise defaults. (Full technical spec in `02-DATA-MODEL.md`.)

### Tier 1 — Odometer integrity
| Rule | Logic | Default severity |
|------|-------|------------------|
| **Odometer regression** | New odometer < previous odometer for the same vehicle. | High |
| **Odometer implausible jump** | Miles since last fill imply impossible speed/usage for the elapsed time. | High |
| **Stale / duplicate odometer** | Same odometer entered as the previous fill-up while gallons were dispensed. | Medium |
| **Missing odometer** | Fill-up recorded with no odometer reading. | Medium |

### Tier 2 — Volume vs. capacity
| Rule | Logic | Default severity |
|------|-------|------------------|
| **Exceeds tank capacity** | Gallons dispensed > vehicle tank capacity (+ small tolerance). Fuel can't fit → diverted to container. | Critical |
| **Implausible top-off** | Gallons dispensed exceed what could plausibly be empty given recent miles driven. | High |

### Tier 3 — Efficiency (MPG)
| Rule | Logic | Default severity |
|------|-------|------------------|
| **MPG deviation** | Computed MPG deviates > X% (default 15%) below the vehicle's rolling baseline. | High |
| **Sustained MPG decline** | Baseline trending down over N fill-ups (loss or mechanical). | Medium |

### Tier 4 — Behavioral / pattern
| Rule | Logic | Default severity |
|------|-------|------------------|
| **Rapid repeat fueling** | Multiple fill-ups on same vehicle within a short window (default < 4h). | High |
| **Off-hours fueling** | Fill-up outside configured operating hours. | Medium |
| **Unattributed transaction** | Fill-up with no vehicle or no driver attribution. | High |
| **Cost outlier** | Price/gallon or total far outside expected range. | Low/Medium |

> **Design principle:** rules produce *signals*, not verdicts. A flagged fill-up goes into a review queue for a human (Fleet Manager) to resolve. We optimize for catching real loss while keeping false positives low enough that managers trust the queue.

---

## 5. Core features (v1 enterprise scope)

**Auth & tenancy**
- Invite-only, domain-restricted login via Supabase Auth (email/password; Supabase issues OAuth2-style JWTs under the hood). A user with an `@silvicominc.com` email can be invited, then sets a password and signs in. *(Microsoft 365 / Google SSO is a deferred enhancement — see `06-AUDIT-FINDINGS.md` B1.)*
- Role-based access control (Admin, Fleet Manager, Driver, Auditor).
- Full data isolation per organization via row-level security.

**Fleet management**
- Vehicle CRUD: make/model, plate, fuel type, tank capacity, baseline MPG, status, current odometer.
- Driver CRUD and driver↔vehicle assignment.

**Fuel capture**
- Driver fill-up entry (mobile-friendly): vehicle, odometer, gallons, price/total, location, optional receipt/pump photo.
- Manual entry by managers; CSV/fuel-card import (phase 2).
- Live, inline validation at entry time (e.g., "this odometer is lower than the last reading").

**Anomaly detection & workflow**
- Automatic scoring of every fill-up against the rule set.
- Anomaly queue with severity, reason, filters, and assignment.
- Investigation workflow: open → investigating → resolved / dismissed, with notes and audit trail.
- Per-org configurable thresholds.

**Dashboards & reporting**
- Executive dashboard: spend, gallons, fleet MPG trend, open anomalies, top offenders.
- Per-vehicle and per-driver drill-downs with MPG history.
- Exportable reports (CSV/PDF) for finance/audit.

**Enterprise hardening**
- Audit log of sensitive actions (user invites, role changes, threshold changes, anomaly resolutions).
- Email notifications for critical anomalies.
- Settings: org profile, operating hours, anomaly thresholds, notification preferences.

---

## 6. Explicitly out of scope for v1 (deferred)

To stay professional but not over-built, these are intentionally **later**:
- Native mobile apps (the web app will be mobile-responsive instead).
- Live telematics / GPS hardware integration (we design the schema to accept GPS odometer later, but don't build device ingestion now).
- Real-time IoT tank-level sensors.
- ML-based anomaly scoring (v1 is a deterministic, explainable rules engine; ML is a phase-3 enhancement).
- Multi-org self-serve signup & billing automation (single tenant for launch).

---

## 7. Success metrics

- **Detection quality:** % of flagged anomalies a manager marks as "real" (target: keep the queue trustworthy, not noisy).
- **Coverage:** % of fill-ups with a valid, plausible odometer reading (target rises over time).
- **Adoption:** weekly active drivers entering fill-ups; median time to log a fill-up (target: under ~30s on mobile).
- **Outcome:** measurable fleet-wide MPG stabilization and reduction in unexplained fuel spend quarter over quarter.

---

## 8. Guiding principles

1. **Simple to use, serious underneath.** Drivers get a 30-second form; managers get an enterprise-grade audit trail.
2. **Explainable over clever.** Every anomaly states *why* it fired in plain language. No black boxes in v1.
3. **Tenant-isolated by default.** Security is enforced at the database, not just the UI.
4. **Design from the templates.** All UI is built from the licensed Tailwind UI v4 (Vue) components already in `/TemplatesTailwind` for a consistent, professional look with minimal custom CSS.

---

*Sources informing the fraud-detection design are listed in `02-DATA-MODEL.md`.*
