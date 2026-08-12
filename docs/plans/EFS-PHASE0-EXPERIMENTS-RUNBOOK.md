# Phase 0 — `no_change` diagnosis experiments: runbook

Companion to `EFS-CARD-CONTROL-FIX-PLAN.md` Phase 0 and audit Part 1. Instrument:
`POST /api/fuel-cards/experiment` (routes/fuelCards/experiments.ts). Findings are appended to
`docs/22-EFS-CARD-CONTROL.md` — winner's redacted XML included, losing hypotheses struck through.

## Preconditions

- Staging/QA API only. `EFS_CARD_CONTROL_PROBE_ENABLED=true` for the session, **unset afterwards**.
- QA org (`07fe4058-…`), disposable card ••••7671 (WEX-confirmed), admin sign-in **fresh** (<5 min —
  the endpoint demands step-up).
- Run from the browser console on any signed-in admin page, so requests carry the session token:

```js
const experiment = (body) =>
  fetch("/api/fuel-cards/experiment", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${window.__accessToken ?? ""}` },
    body: JSON.stringify(body),
  }).then(async (r) => ({ http: r.status, ...(await r.json()) }));
```

(However the app exposes its token — adapt the header to match `useApi`'s pattern. A 403
`step_up_required` means re-sign-in and retry within five minutes.)

## The sequence — stop at the first experiment that lands

Between mutating experiments the card must be **Active** again; once any variant proves able to
write, use that same variant with `status: "Active"` to revert (or the WEX portal if none succeed).

**E1 — state + casing (read-only, run first):**
```js
await experiment({ experiment: "read_state", cardNumber: "<full card number>" })
```
Record: `status` **verbatim casing**, `version`, `documentShape`.
- If status is already Hold → **H2 confirmed**: the 00:23 write landed late; our verification raced
  it. Fix is plan 1.2. Revert to Active, still run E2 once for casing knowledge.
- Note whether this account returns `HOLD` or `Hold` — decides how meaningful E2 is.

**E2 — uppercase status (H1):**
```js
await experiment({ experiment: "set_status", cardNumber: "<card>", status: "HOLD", variant: "standard", confirm: "WRITE 7671" })
```
`landed: true` here with a prior lowercase failure ⇒ H1 confirmed ⇒ fix = write account-observed casing.

**E3 — qualified rpc/literal wrapper (H5):** *(revert to Active first)*
```js
await experiment({ experiment: "set_status", cardNumber: "<card>", status: "Hold", variant: "qualified_wrapper", confirm: "WRITE 7671" })
```

**E4 — originalStatus supplied (H3):** *(revert first)*
```js
await experiment({ experiment: "set_status", cardNumber: "<card>", status: "Hold", setOriginalStatus: "Active", variant: "standard", confirm: "WRITE 7671" })
```

**E5 — setCard v1 (provisioning):** *(revert first; endpoint refuses if the card has limits)*
```js
await experiment({ experiment: "set_status", cardNumber: "<card>", status: "Hold", variant: "setcard_v1", confirm: "WRITE 7671" })
```

**E6 — all failed identically ⇒ WEX ticket (H4).** Attach each response's `requestXmlRedacted` /
`responseXmlRedacted` + timestamps. Ask in the same ticket: (1) does the sandbox apply `setCardv2`?
(2) acceptable request rates (plan B5/B6); (3) sandbox behavior for product-limit overrides and
`deleteOverride` (plan B4/D1); (4) any REST roadmap for OTR card management (audit 5.4).

## Reading a result

Each mutating response reports: `readings` (status + version at ~0s/+3s/+8s — a landing at +3s/+8s
alone is **H2 evidence**: writes apply with lag, fix 1.2's delay accordingly), `landed`,
`changedPaths` (must name only `/header/status` (+ `originalStatus` in E4) — anything else is drift
to investigate before continuing), `writeErrorCode` (a `declined`/`not_allowed` here is its own
finding: the variant was *refused*, not ignored), and the redacted request/response XML (the
evidence to archive).

## Results table (fill in docs/22)

| Exp | Variant | Sent | landed | at (ms) | changedPaths | Notes |
|-----|---------|------|--------|---------|--------------|-------|
| E1  | —       | —    | —      | —       | —            | status casing: … |
| E2  | standard | HOLD |       |         |              | |
| E3  | qualified_wrapper | Hold | |     |              | |
| E4  | standard +orig | Hold |  |        |              | |
| E5  | setcard_v1 | Hold |     |         |              | |

Afterwards: revert the card to Active, **unset `EFS_CARD_CONTROL_PROBE_ENABLED`**, write the root
cause into docs/22, and pick the matching fix from the plan (H1→casing map · H2→1.2 delay values ·
H3→originalStatus edit in lockEdits · H5→wrapper change behind a probe-verified flag · H4→WEX).
