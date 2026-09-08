# Store review notes

**The text pasted into App Store Connect ("App Review Information → Notes") and Google Play ("App
content → App access").** Written 2026-09-08 for §6 P7 of `DRIVER-APP-DIRECTION-B-PLAN.md`.

Kept here rather than only in the two consoles because a reviewer's question is answered by whoever
is awake, and reconstructing this from memory under a 24-hour rejection clock is how a wrong answer
gets sent. Edit here first, then paste.

---

## Why this app needs notes at all

Every screen is behind a login, and the login **cannot be created from the app** — it is issued by
the trucking company the driver works for. A reviewer who opens it without credentials sees a sign-in
screen and nothing else, which is an automatic rejection under 2.1 unless the notes explain it and
supply a working account.

Two further things reliably draw a question, and both are answered below rather than waited for:
account deletion, and what the app does with the camera.

---

## The notes text

> **What this app is.** Silvicom 360 is fleet compliance software for trucking carriers. This is the
> driver's app: it shows a driver the loads their dispatcher assigned them, lets them record arrival
> and delivery at each stop with proof photographs, tracks their shift, and carries messages with
> dispatch.
>
> **Accounts are issued by the employer.** There is no sign-up, by design — a driver's login is
> created by their carrier's office staff, because the account is the employer's record of that
> driver. Please use the demo credentials below.
>
> **Demo account**
> Driver ID: `<REVIEW_DRIVER_ID>`
> Password: `<REVIEW_PASSWORD>`
>
> This account belongs to a demonstration carrier with no real people in it. It is loaded with
> assigned loads, a shift, message history and a completed compliance check, so every screen has
> content.
>
> **Account deletion.** More → **Close my account**. It closes the login immediately. It is a
> *request* to the carrier rather than an erasure, and that is a legal constraint rather than a
> choice: this app supports no account creation, so guideline 5.1.1(ix) applies, and United States
> federal regulation **49 CFR §391.51** requires the motor carrier to retain a driver's qualification
> file for three years after the driver leaves. The app says exactly this in the confirmation dialog
> before the driver confirms, and the privacy policy repeats it. The carrier deletes everything the
> law permits within 30 days and records that it did.
>
> ⚠ Please note the demo account will stop working if you close it. Tell us and we will re-issue it.
>
> **Camera.** Used only to photograph work documents — bills of lading, seals, trailers, damage — as
> proof that a stop was completed. The app requests no photo library access and no microphone.
>
> **Location.** The app requests no location permission on either platform and contains no location
> software. The map on a stop screen is a static picture drawn from the addresses the dispatcher
> typed.
>
> **Notifications** are a feature each carrier enables for its own drivers. They are on for the demo
> carrier.
>
> **Privacy policy:** `<BASE_URL>/privacy` · **Terms:** `<BASE_URL>/terms` ·
> **Support:** `<BASE_URL>/support`

---

## Filling the placeholders

| Placeholder | Where it comes from |
|---|---|
| `<REVIEW_DRIVER_ID>` / `<REVIEW_PASSWORD>` | The review fleet — §6 P7's seed. Until that exists, a real driver login on a demo org, issued through Web → Roster → App access. **Never a real driver's own credentials.** |
| `<BASE_URL>` | The production web host. The three pages shipped in PR #672. |

---

## Two answers to have ready, not in the notes

**"Show us deletion actually deleting."** Guideline 5.1.1(ix) permits a customer-service flow for a
regulated industry, and the notes cite it. If a reviewer rejects on this point anyway, the fallback
is recorded as **Q-PR6** in the plan: `complete` gains an automatic 30-day job that removes the
non-retained rows — push tokens, message participation, app preferences — without fleet action. The
retained qualification file is the legal floor and does not move. Do not offer that change unless
asked; it is a real behaviour change and it is not required by the guideline as written.

**"What is the hazmat feature?"** A driver photographs a bill of lading and a deterministic rules
engine checks it against the published Hazardous Materials Table, returning required placards and the
49 CFR sections behind them. It is a compliance aid, not a clearance — the carrier remains
responsible under §177.817, and the app says so.

---

## Before pasting

- The demo account signs in **on a real device, from the store build**, not a simulator or a dev
  build. A credential that works locally and not in TestFlight is the most common cause of a 2.1
  rejection.
- Its loads, messages and score have content — a reviewer who lands on three empty tabs concludes the
  app is broken, whatever the notes say.
- The three URLs resolve on the production host.
