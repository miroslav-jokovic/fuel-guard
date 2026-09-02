# One-time links in email, and the scanner that opens them

**Status: operational finding, measured 2026-09-02 against production.** Written because it cost two
days of "the invite link says expired" and the cause was invisible from the application side.

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

`AcceptInvitePage.vue` redeems the token **on submit, not on load** (2026-09-02). Loading the page is
inert: it parses the URL, rejects only what needs no network call, and shows a password form. The
token is spent by typing a password and pressing the button — the one action a scanner will not take,
because it has no password to supply.

⚠ This is the whole mitigation, and it is load-bearing. Any future surface that spends a credential
**on render** will be broken by the same scanner. Before adding one, ask what happens when a machine
opens the URL thirty seconds after it is sent.

An earlier attempt — moving from Supabase's `action_link` to a `token_hash` URL of our own (#460) —
did **not** fix this, and the reasoning is worth keeping: it removes the danger from a plain HTTP
`GET`, which is what most scanners do, but a link that spends itself on render cannot survive a
scanner that renders.

## The fix at source (the operator's half)

The code change makes invites work. It does not stop URL Defense opening every link the product
sends, so the belt to that braces is an exception in the Proofpoint console. **This is a tenant admin
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

The signature is a credential consumed **seconds** after the email was sent, by nobody. Check the
relevant GoTrue columns (`recovery_sent_at`, `confirmation_sent_at`, `last_sign_in_at`,
`email_confirmed_at`) against the audit row that sent it. A gap under a minute is a machine.
