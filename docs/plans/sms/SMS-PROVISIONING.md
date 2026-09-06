# SMS provisioning — Telnyx

Decision log for the SMS transport. Companion to `docs/plans/recruitment/APPLICATION-SYSTEM-PLAN.md`
§A11b (D-APP13), which owns the consent regime; this document owns the *carrier* half only.

---

## 0. What is provisioned, measured 2026-09-06

| Thing | Value | State |
|---|---|---|
| Provider | Telnyx (Twilio removed, PR #592) | live |
| Account | `SILVICOM INC`, user `b949b210-2b4a-478e-8cb4-3a8698d26243` | $30.00 balance |
| Messaging profile | `4001a077-1066-4b5d-b44e-50fdb9a96843` — "Silvicom 360 - driver SMS" | enabled, `whitelisted_destinations: ["US"]` |
| Profile webhook | `https://fleetguardapi-production.up.railway.app/api/webhooks/sms`, API version **2** | matches the Ed25519 receiver we implemented |
| Number | **+1 833 352 1766** (toll-free, quickship) | `active`, bound to the profile above |
| Railway (`@fleetguard/api` only) | `SMS_PROVIDER=telnyx`, `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `TELNYX_FROM`, `TELNYX_MESSAGING_PROFILE_ID` | all set, API boots clean |

**Toll-free rather than 10DLC, ruled 2026-09-06.** Every Telnyx number costs the same ($1 upfront +
$1/mo), so the number was never the cost — registration is. 10DLC would have been ~$26 upfront
($4 brand + $15 campaign verification + $6 low-volume campaign + $1 number) and ~$3/mo, against $2
upfront and $1/mo here. Toll-free verification is free; 10DLC's per-message rate is lower
($0.004 vs $0.0055 per part) but the difference needs ~13,000 messages a month to repay $25, and this
product sends application nudges. ⚠ The trade accepted with it: a toll-free number reads as a
business or marketing line, so it is weaker than a local 872/312 number for outreach a driver has to
act on. Revisit if response rates matter more than setup cost.

---

## 1. The Telnyx CLI — installed, and half of it is broken

`npm install -g @telnyx/cli` (v1.0.0; the Go build at `team-telnyx/telnyx-cli` needs a Go toolchain
that is not on this machine — the npm package is the same repo). Authenticate non-interactively by
piping the key: `echo "$KEY" | telnyx auth login`. Credentials land in
`~/Library/Preferences/telnyx-cli-nodejs`.

**Measured, command by command — do not assume the rest work:**

| Command | State |
|---|---|
| `auth login` / `auth whoami` | ✅ works |
| `number search` (local) | ✅ works, though it renders features as `[object Object]` and location as `N/A` |
| `number search -t toll_free` | ❌ returns nothing; the API returns eight |
| `number order` | ❌ posts to `/v2/phone_numbers`, which is GET-only. Orders go to `/v2/number_orders` |
| `messaging-profile *` | ❌ every subcommand: `Resource not found: messaging-profiles` (real path is `/v2/messaging_profiles`) |
| `billing balance` | ❌ **reports $0.00 against a real $30.00**, ignores `--json`, and then warns the balance is low |

⚠ **`billing balance` being confidently wrong is the one to remember.** It does not fail; it prints a
plausible number. Anything that matters is read from the API.

---

## 2. Why no SMS can be sent yet, and it is not the carrier

The account half is finished. The product half is not, and the chain was measured rather than
assumed on 2026-09-06:

1. **There is no opt-in surface at all.** `recordSmsConsent` (`modules/recruiting/applicationSms.ts`)
   is exported from its file and reached by **nothing** — it is not in the module barrel, no route
   calls it, and no UI collects it. `smsConsentGrantSchema` names
   `POST /api/public/application/:token/sms-consent` in a comment; that route does not exist.
2. **So `liveConsent` can only ever return null**, and `sendApplicationSms` holds every message with
   `no_consent`. This is true regardless of Telnyx, the number, or verification.
3. **The consent wording is `v0-draft`.** `isDraftSmsConsent()` gates both recording a consent and
   sending against one. Publishing it is **counsel's call, not an engineer's** — the file says so at
   length, and the classification question (transactional vs. §64.1200(f)(9) telemarketing) is the
   reason. Tracked as the counsel review package.
4. **Verification cannot be submitted**, because it requires `optInWorkflowImageURLs` —
   screenshots of the consent flow — and there is no flow to screenshot. See §3.

**`HELP` was the one link in this chain that was independently broken, and it is fixed.**
`isHelpMessage` was written and unit-tested and had no caller, so a mandated keyword went
unanswered. It now replies through the transport directly, bypassing consent, quiet hours and the
draft gate, because a HELP answer is the required response to a message somebody sent *us* rather
than a message we chose to send. `SMS_HELP_REPLY` carries the reasoning.

---

## 3. The toll-free verification submission

`POST /v2/messaging_tollfree/verification/requests`. Required fields, discovered by posting `{}` and
reading the validation errors:

```
businessName  corporateWebsite  businessAddr1  businessCity  businessState  businessZip
businessContactFirstName  businessContactLastName  businessContactEmail  businessContactPhone
messageVolume  phoneNumbers  useCase  useCaseSummary  productionMessageContent
optInWorkflow  optInWorkflowImageURLs  additionalInformation  entityType
```

**What we can already fill**, from the Samsara account's `carrierSettings` and this repo:

| Field | Value |
|---|---|
| `businessName` | Silvicom, Inc |
| `businessAddr1` | 1301 Armitage Ave |
| `businessCity` / `businessState` / `businessZip` | Melrose Park / IL / 60160 |
| `entityType` | Private (US DOT 1864495) |
| `phoneNumbers` | `+18333521766` |
| `useCase` | Account notification / Customer care |
| `messageVolume` | Low — one nudge per invitation, ever; nothing before 48 h |

**What is missing and blocks submission:**

- `corporateWebsite` — a public site. Since 2026-01-01 verification also wants a Business
  Registration Number (EIN), and the site must carry the SMS privacy policy in §4.
- `optInWorkflowImageURLs` — screenshots of the consent checkbox in the application flow. **Blocked
  by §2.1**: the flow does not exist.
- `businessContact*` — a named person, their email and phone.
- `productionMessageContent` — must be the real nudge text, which is gated on counsel publishing
  `SMS_CONSENT` (§2.3). Submitting placeholder text and changing it later is how a verification gets
  revoked.

---

## 4. The SMS privacy policy, drafted from what the code does

For the public website. This is a *website disclosure*, distinct from the consent instrument in
`smsConsentContract.ts` — that one is counsel's and is still `v0-draft`. Every claim below was read
off the implementation rather than written from a template, so it is checkable:

> **Text messages about your driver application**
>
> If you give us your mobile number and tick the consent box while applying, Silvicom may text you
> about **your own application** — for example a link back to an application you started and have not
> finished.
>
> - **You do not have to agree.** Consent is not a condition of applying or of being considered.
>   (`SMS_CONSENT.body`)
> - **What you get.** Messages about your own application only. No marketing, no third-party content.
>   In practice this is at most one reminder per invitation, and never within the first 48 hours.
>   (`APPLICATION_NUDGE_ENABLED`, one nudge per invitation ever.)
> - **When.** Daytime only. We hold messages outside civil hours across all US time zones and send
>   them later the same day rather than dropping them. (`canSendSmsAt`, `smsQuietHours.ts`.)
> - **Stopping.** Reply **STOP** at any time — also STOPALL, UNSUBSCRIBE, CANCEL, END or QUIT, and we
>   honour a plain-English "please stop" too. This revokes every live consent on that number
>   immediately. (`SMS_STOP_KEYWORDS`, `revoke_sms_consent`.)
> - **Help.** Reply **HELP** for help. (`SMS_HELP_REPLY`.)
> - **Rates.** Message and data rates may apply.
> - **What we keep.** Your number, the exact wording you agreed to, its version, and the date, time,
>   IP address and browser you agreed from — so we can show what was agreed and when.
>   (`sms_consents`.)
> - **Sharing.** We do not sell or share your number, and we do not share it with third parties for
>   marketing.

⚠ The bullet on frequency and the one on quiet hours describe behaviour that is real but currently
unreachable, because §2 means no consent can be granted. Publish this **with** the opt-in flow, not
before it — a policy describing a flow that does not exist is the kind of discrepancy a verification
reviewer opens by checking.

---

## 5. Order of work

1. **Counsel publishes `SMS_CONSENT`** (version off `v0-draft`). Blocks 2 and 4. Not an engineering task.
2. **Build the opt-in surface** — `POST /api/public/application/:token/sms-consent` reaching the
   existing `recordSmsConsent`, plus the checkbox on the application form, shown alone beside its own
   control as `SmsConsentDocument` requires.
3. **Publish the website** carrying §4.
4. **Screenshot the flow from 2**, host the images, submit §3.
5. **Send a real message** — nothing in this system has ever talked to a carrier, and until one round
   trip completes, the transport is wired, tested against a stub, and unproven.
