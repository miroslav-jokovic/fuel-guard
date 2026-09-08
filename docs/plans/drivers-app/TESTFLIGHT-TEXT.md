# TestFlight — the text to paste

**Written 2026-09-08** for the first external TestFlight round. App Store Connect asks for these
before external testers can be invited; they are the fields Apple's help lists as required.

Kept in the repo rather than only in the console for the same reason `STORE-REVIEW-NOTES.md` is: it
gets edited between builds, and a field somebody retyped from memory is a field that drifts.

---

## Test Information → App-level (entered once)

**Feedback email**
`miki@silvicominc.com` (owner, 2026-09-08).

⚠ The address was first given as `miki@silviocminc.com` and that domain **does not exist** — no DNS
records at all, so every message to it would have bounced and the feedback would have been lost
silently, which is the worst way to lose it. `silvicominc.com` resolves and carries live Proofpoint
MX records. Two letters transposed. Checked with `dig` rather than assumed, and worth checking for
any address that goes into a store listing.

**Contact information** (goes to Apple's review team, not to testers)
First name, last name, email, phone of the account holder.

**Privacy policy URL**
`<BASE_URL>/privacy` — live since PR #672.

**Beta App Description** (what testers see in TestFlight before installing)

> Silvicom 360 is the driver's app for fleet compliance. It shows you the loads your dispatcher
> assigned, records arrival and delivery at each stop with proof photographs, tracks your shift, and
> carries messages with dispatch. It keeps working with no signal — anything you do offline is saved
> on the phone and sent when you get a bar.
>
> Your login is issued by your carrier. There is no sign-up.

---

## "What to Test" — per build

⚠ **Rewrite this per build.** A generic "please test the app" produces generic feedback. What follows
is the text for the FIRST build; later ones should name what changed.

> This is the first build. We are testing whether the app is usable in a cab, not whether it is
> feature-complete.
>
> **Please try, in this order:**
>
> 1. **Sign in** with the Driver ID and password your fleet manager gave you. There is no sign-up and
>    no password reset — if it does not work, tell your fleet manager rather than trying again.
> 2. **Home** — does it show your shift and today's work? Start your day and pick a truck.
> 3. **Loads** — accept a load. Open it, open a stop, and photograph something as proof.
> 4. **Then turn on airplane mode** and do all of step 3 again. Complete a stop, take a photo, send a
>    message. Nothing should be lost. Turn the signal back on and watch More → System settings → Sync
>    count down to zero.
> 5. **Read the screen in direct sunlight.** Tell us anything you cannot read.
> 6. **With gloves on**, try to hit the buttons you would actually hit while working.
>
> **What we already know and do not need reported:**
>
> - Loads marked `DEMO-` are test data. Real loads arrive when the dispatch connection is finished.
> - The map on a stop is a picture, not navigation — no routing and no ETA. The app never asks for
>   your location and cannot see where you are.
> - Documents / hazmat checks may fail. That part is new and we are watching it.
>
> **What to tell us:** which screen, what you did, what happened, and whether you had a signal. More →
> System settings → Build has the version number — include it.

---

## Export compliance

Asked once per build, and the answer is already declared in the app.

`app.config.ts` sets `ios.config.usesNonExemptEncryption: false`, so App Store Connect should not ask
at all. If it does: **the app uses only standard HTTPS and the operating system's own cryptography**,
which is exempt. Answer that it does not use non-exempt encryption.

---

## The order of clicks, once a build is processed

1. **TestFlight → Internal Testing → `+`** → create a group (any name, e.g. `Owner`) and add
   yourself. ⚠ Apple requires an internal group to exist before an external one can be created; on an
   Individual membership this group can only ever contain the account holder.
2. **TestFlight → External Testing → `+`** → create a group, e.g. `Pilot drivers`.
3. Add the build to that group → **Submit for Review**. This is TestFlight App Review, lighter than
   App Store review: typically a day or two, and it is per **version**, not per build — later builds
   of the same version go straight out.
4. Once approved: add testers by email, by CSV, or generate a **public link** (up to 10,000, with an
   optional cap).

A demo account is **not** required for TestFlight. That is an App Store review requirement, and
`STORE-REVIEW-NOTES.md` holds it for then.
