# One-time links in email, and the scanner that opens them

**Status: operational finding, measured 2026-09-02 and 2026-09-03 against production; the
invitation link was redesigned on 2026-09-04 (§the-fix-at-source).** Written because it cost three
days of "the invite link says expired" and each cause was invisible from the application side.

## The short version, 2026-09-04

An office invitation is now delivered as **our own token** (`?token=…` on `/accept-invite`), stored
hashed on the `invites` row, with the row's `expires_at` as its only expiry. Nothing of Supabase's
is in the email. The page reads the invitation on load (`POST /api/public/invites/lookup`, spends
nothing) and spends it only with a password (`POST /api/public/invites/redeem`), which creates the
login and the membership; the page then signs in with the password it just set.

Three properties of the old Supabase one-time token each lost a real invitation:

| property of GoTrue's token | what it cost | measured |
| --- | --- | --- |
| spent by whoever opens it first | the recipient's mail scanner opened it 15–47s after send | 2026-09-02, three sends |
| lives for the project's OTP expiry — **one hour** by default — while the email and the `invites` row both said seven days | sent 17:37 UTC, token still unspent the next morning, click said "expired" | 2026-09-03, `confirmation_token` present, `email_confirmed_at` null |
| every `generateLink` for an address overwrites the previous token | "send it again" killed the email already in the inbox; two identical messages, one dead | 2026-09-03, invite created 17:22, deleted 17:35, re-created 17:37 |

The 2026-09-02 fix (redeem on submit) removed the first. It could not touch the other two, because
they are properties of a credential we did not mint. The 2026-09-04 change mints it.

## What was measured

Three invitations to `george@silvicominc.com`, and the moment GoTrue's one-time token was redeemed:

| link sent | token redeemed | gap |
| --- | --- | ---: |
| Sep 1 20:51:02 (invite) | 20:51:17 — `email_confirmed_at` set | **15s** |
| Sep 2 14:26:09 (recovery) | 14:26:56 — `last_sign_in_at` set | **47s** |
| Sep 2 15:14:27 (invite) | 15:14:52 — `last_sign_in_at` set | **25s** |

`recovery_token` was empty afterwards each time — consumed. **The links worked.** Nobody receives,
opens and clicks an email in fifteen seconds, and the redemption path at the time ran only from our
own SPA, in JavaScript. So the recipient's mail security was opening the link, executing the page,
spending the token and discarding the session it got. The human clicked minutes later and was told
the link had expired. `memberships` stayed empty through all four attempts.

## Who is doing it

`silvicominc.com` MX records point at `mx1-us1.ppe-hosted.com` / `mx2-us1.ppe-hosted.com`, and its
SPF is `v=spf1 a:dispatch-us.ppe-hosted.com ~all`. That is **Proofpoint Essentials**, whose URL
Defense rewrites links in inbound mail and detonates them in a sandbox — a sandbox that renders
pages and runs their scripts.

## What the code does about it

**Since 2026-09-04 — the link is ours.** `lib/linkToken.ts` mints 256 bits, the row holds the
SHA-256, the email holds the plaintext. `POST /api/public/invites/lookup` reads; `…/redeem` spends,
and needs a password. A scanner that renders the page gets the org's name and a form.

- Expiry is `invites.expires_at`, seven days, the same number the email prints. There is no second
  clock. (GoTrue's `otp_expiry` — `supabase/config.toml` says 3600s locally, and the hosted
  project's setting was never read — no longer matters to invitations.)
- **Resend rotates.** The earlier email's link dies the moment the resend returns, and the Users
  page toast says so. Tell the person to use the newest email.
- Revoke works on our row, so a revoked link is refused at lookup, before a password is typed.
- An address GoTrue already knows (every invitation before this date created the auth user up
  front — an unfinished one is exactly this state) redeems by setting that account's password:
  `createUser` answers `email_exists`, the account is found by address, `updateUserById` sets the
  password and confirms the email. Possession of the emailed link is the proof, the same proof a
  password-reset email would be.
- The authenticated `POST /api/invites/accept` remains for a caller that already holds a confirmed
  session — the driver app's accept screen, a path DC9 retires — and both routes end in the same
  `admitInvitedUser`.

**Before that, 2026-09-02:** `AcceptInvitePage.vue` redeemed the GoTrue token **on submit, not on
load**. Loading the page was inert. That defeated the scanner and is still the rule for any surface
that spends a credential: ask what happens when a machine opens the URL thirty seconds after it is
sent. It did not, and could not, fix the one-hour expiry or the overwrite-on-resend.

An earlier attempt — moving from Supabase's `action_link` to a `token_hash` URL of our own (#460) —
did **not** fix the scanner either, and the reasoning is worth keeping: it removes the danger from a
plain HTTP `GET`, which is what most scanners do, but a link that spends itself on render cannot
survive a scanner that renders.

### Links already in inboxes when this shipped

Every invitation emailed before 2026-09-04 carries a GoTrue credential and is dead — spent, or an
hour past its expiry. The page tells such a link "this is from an earlier kind of invitation".
The fix is a **resend** from the Users page, which mints the new kind. The pending row for the
2026-09-03 recipient is exactly this case.

## The fix at source (the operator's half)

The code change makes invites work without it. It does not stop URL Defense opening every link the
product sends, so the belt to that braces is an exception in the Proofpoint console. **This is a tenant admin
action — it cannot be done from the codebase.**

In **Proofpoint Essentials** (admin.ppe-hosted.com), for the Silvicom company:

1. **Security Settings → Email → URL Defense.**
2. Add the application's own domain — whatever `WEB_APP_URL` is set to on the `fleetguardweb`
   Railway service, i.e. the address people log in at — to the **URL Defense exception list**, so
   links to it are neither rewritten nor detonated.
3. Optionally add the invite sender address (`MAIL_FROM` on the API service) to **Safe Senders**.
   On its own this is *not* sufficient — Safe Senders governs filtering, and URL rewriting is a
   separate control — which is why step 2 is the one that matters.

To confirm it is in force: open a received invitation and look at the link target. While URL Defense
is rewriting it, the href points at `urldefense.proofpoint.com/...` rather than at the app domain.

## If it happens again elsewhere

Two signatures, and the columns that tell them apart:

**A machine spent it.** A credential consumed **seconds** after the email was sent, by nobody. Check the
relevant GoTrue columns (`recovery_sent_at`, `confirmation_sent_at`, `last_sign_in_at`,
`email_confirmed_at`) against the audit row that sent it. A gap under a minute is a machine.

**Nobody spent it and it still says expired.** The token column is still populated
(`confirmation_token` / `recovery_token` non-empty), `email_confirmed_at` or `last_sign_in_at` is
null, and the click came more than the OTP expiry after `confirmation_sent_at` /
`recovery_sent_at`. That is a clock the email did not mention. Invitations no longer have one; a
new surface built on `generateLink` would.
