# S-AP3a · The careers pages get their own name (D-AP9) — 2026-11-22

The owner chose `careers.silvicominc.com` as the address silvicominc.com's Apply buttons link to (APPLY-PAGE-PLAN
D-AP9). This step builds what serves that name; the pages themselves are AP3b.

- **One source for the name.** `CAREERS_HOST` in `infra/server/production.env` (`careers.silvicominc.com`) and
  `staging.env` (`staging-careers.360.silvicominc.com`). Caddy routes on it; compose.yml gives the api
  `CAREERS_URL=https://${CAREERS_HOST}`. The API's `careersOrigin(env)` (applyChecks.ts) reads `CAREERS_URL`, falling
  back to `WEB_APP_URL`, for both the Settings card's link and the hostname Turnstile must report.
- **The Caddy block serves only the applicant's paths**: `/careers/*`, `/api/public/careers/*`, and paths with a file
  extension. Everything else is a 404. Measured with Caddy 2.10 and http-echo stand-ins on a Docker network:
  - `/careers…` reaches web, and `/api/public/careers/…` reaches api;
  - `/`, `/login`, `/privacy`, `/api/version`, `/api/public/application/…`, `/api/x.js`, `/careers/../login` and
    `/careers/%2e%2e/login` all answer 404;
  - the office host is unchanged.
- **The legal pages stay on 360** (their layout has the office "Sign in"; Telnyx registered them there). AP3b's form
  links to them with addresses the API gives it.
- **No CORS change**: the page calls `/api/public/careers` on its own origin, as the application page does.
- **Owner's part, written into AP5**:
  - one GoDaddy message with two A rows, sent now. Measured first: both names are free, there is no wildcard and no
    CAA, and the addresses are the live EIPs;
  - two Turnstile widgets, one per environment.
- The Q-AP5 Telnyx draft now names the careers address; `optInWorkflow` is 479 characters, under the 500 limit.
- Q-AP6 is new: what the bare `careers.silvicominc.com/` shows. It recommends a `custom_host` column later.

**Before DNS lands** the new site block waits: Caddy validates the config, and it retries the certificate in the
background. Restart Caddy once after GoDaddy publishes. Until then `publicUrl` names a host that does not resolve yet.
The careers page is off in production (no row), and on staging the walk waits for the name.

**Tests and mutation.**
- `applyChecks.test.ts` (+1): a careers host is expected, and the office host then fails.
- `careersPage.test.ts` (+1): the link uses the careers host, with no doubled slash.
- Four mutants were planted in the origin, the slash, the Turnstile host and the link; all four were killed.
- One Caddy mutant (the `/api/*` 404 removed) let `/api/x.js` reach the web container, which is the same Express app.
  The block stays.
