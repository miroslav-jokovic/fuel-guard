# Security review — Silvicom 360 / FuelGuard

Reviewed September 6, 2026, against checkout `ff0618f`. Analysis only; application code and configuration were not changed.

This is a source review and targeted local verification, not a production penetration test or a guarantee that every vulnerability has been found. Scope: customer API/web app, platform API/admin app, driver app, distribution service, database migrations, CI, and locked production dependencies. Production Supabase/Railway settings, running binaries, external backup jobs, historical secret rotation, and access logs were not inspected. Unrelated pre-existing untracked files were left alone.

**Priority:** P1 = fix first; P2 = next security release; P3 = defense in depth. “Confirmed” describes code behavior, not evidence of exploitation. Recommendations are separated from proven defects.

## Existing controls verified

- Customer JWT verification pins issuer/audience; tenant and section gates are present. Platform routes enforce MFA/AAL2 and a fresh platform-admin allowlist lookup, with step-up checks on sensitive platform actions.
- RLS lint found **147 created tables with RLS enabled**. The local RLS matrix passed **474 assertions**, including cross-tenant/anonymous checks on **129 tables**, **11 documented exemptions**, and no reported leaks in its modeled cases. RLS being enabled alone does not prove every policy is correct.
- **125 targeted API tests** and **32 platform API tests** passed. Initial API tests could not bind sockets in the restricted sandbox; rerunning with localhost access passed.
- Gitleaks scanned the tracked HEAD snapshot (~50.7 MB): **no leaks found**. This does not scan all Git history, ignored files, or previous source archives.
- Signed inbound webhooks, AES-GCM secret sealing with tenant/purpose binding, private applicant-capture storage, request validation, CSP/security headers, and scoped upload paths already exist. Basic EFS SSRF/redirect protection and the customer API's rate-limiter ordering were fixed since the older audit.
- The separate McLeod agent's production dependency audit reported **zero known vulnerabilities**.
- The workspace production dependency audit reported **14 high and 10 moderate findings, zero critical**. These are registry counts, not 24 confirmed exploitable application bugs; the production graph also contains Expo/compiler/build packages.

## Confirmed fixes and implementation gaps

### 1. P1 — Bind offline work to the driver who created it

The outbox uses one database and has no owner user/org fields. Sign-out does not isolate its pending rows. The next ready session drains the same queue using its current token. For example, a queued shift-start payload has vehicle/time/session IDs but no original driver identity, and the API attributes it to the current caller. On a shared phone, A's unsent work can therefore be replayed as B's work when otherwise valid. This flow is confirmed by source; it was not exercised on a physical device.

**Fix:** Persist user/org ownership on every queued record, partition storage, stop and cancel drains on identity changes, and require an owner match before sending. Preserve A's pending work for A rather than deleting it on logout. Quarantine legacy unowned rows.

**Acceptance:** A queues a shift offline, signs out, B signs in and reconnects: B never sends A's record; A can later recover it.

Evidence: [apps/driver/src/data/db.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/driver/src/data/db.ts:16), [apps/driver/src/data/outbox.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/driver/src/data/outbox.ts:61), [apps/driver/src/data/handlers.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/driver/src/data/handlers.ts:102), [apps/driver/src/lib/api.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/driver/src/lib/api.ts:62), [apps/api/src/modules/driver-app/routes/me.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/driver-app/routes/me.ts:191).

### 2. P1 — Isolate and clear cached data between accounts

The persisted cache has one global key, lasts seven days, and uses query keys such as `['me', 'shift']` without user/org identity. Sign-out clears session state but does not clear the query cache or persisted client. Another driver can receive the prior driver's cached loads/shift/profile data, especially while offline.

**Fix:** Partition query keys and persistence by principal; cancel in-flight queries and clear visible state on every identity change. Do not restore another user's cache.

**Acceptance:** Switch A → B while offline and during an in-flight fetch; no A data appears under B.

Evidence: [apps/driver/src/lib/persist.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/driver/src/lib/persist.ts:16), [apps/driver/src/features/duty/useDuty.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/driver/src/features/duty/useDuty.ts:33), [apps/driver/src/session/SessionProvider.tsx](/Users/miroslavjokovic/Projects/FuelGuard/apps/driver/src/session/SessionProvider.tsx:177), [apps/driver/app/_layout.tsx](/Users/miroslavjokovic/Projects/FuelGuard/apps/driver/app/_layout.tsx:79).

### 3. P1 — Make offboarding and permission reductions take effect immediately

Customer authorization trusts role/org/section claims in an already-issued JWT. Membership deletion, demotion, and section changes do not invalidate those claims. The code explicitly documents a window up to the configured token lifetime, locally 3,600 seconds. Some driver routes independently check active status, but this is not a universal customer API/RLS revocation control.

**Fix:** Introduce a current membership/session or authorization-version check for protected access, covering both Express and direct Supabase/RLS paths. Revoke refresh sessions and invalidate clients as supporting measures; reducing JWT lifetime alone only shortens the gap. Protect privilege-management changes with fresh authentication.

**Acceptance:** A previously captured token cannot read or mutate protected data after removal/demotion, via either API or PostgREST.

Evidence: [apps/api/src/modules/org/routes/members.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/org/routes/members.ts:95), [apps/api/src/middleware/auth.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/middleware/auth.ts:16), [apps/api/src/modules/org/routes/sectionAccess.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/org/routes/sectionAccess.ts:286), [supabase/config.toml](/Users/miroslavjokovic/Projects/FuelGuard/supabase/config.toml:165). Supabase confirms that signed access tokens remain valid until expiry without additional session checks: [session documentation](https://supabase.com/docs/guides/auth/sessions).

### 4. P1 — Make permission changes atomic

Both section and screen override writers delete the current row, then insert its replacement in another request. If insertion fails, the original restriction is gone even though the API reports failure. Concurrent readers/token refreshes can observe the unrestricted default in the interval.

**Fix:** Use a full-row upsert for explicit values and delete only for “inherit,” or put the mutation plus audit in a database transaction/RPC. Serialize conflicting updates and preserve the prior policy on failure.

**Acceptance:** Inject an insert failure while changing an existing deny; the deny remains. Concurrent refreshes never receive an intermediate broader permission.

Evidence: [apps/api/src/modules/org/routes/sectionAccess.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/org/routes/sectionAccess.ts:230), [apps/api/src/modules/org/routes/sectionAccess.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/org/routes/sectionAccess.ts:326), [apps/api/src/modules/org/routes/surfaceAccess.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/org/routes/surfaceAccess.ts:267), [apps/api/src/modules/org/routes/surfaceAccess.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/org/routes/surfaceAccess.ts:352).

### 5. P2 — Honor individual screen restrictions in the backend

`requireSurface` calls `surfaceClaimFor(admin, orgId, role)` without the user ID. Individual overrides therefore never participate in inspector create/update/delete authorization, although `/api/me` includes them for the UI. This bypasses that individual's screen restriction within an already-authorized section; it is not a cross-tenant or section-role bypass.

**Fix:** Pass the authenticated user ID and test the middleware through real routes.

**Acceptance:** A technician with maintenance management permission and a personal inspector-screen deny gets 403 on direct inspector writes. A personal allow over a role deny behaves consistently too.

Evidence: [apps/api/src/middleware/requireSurface.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/middleware/requireSurface.ts:54), [apps/api/src/modules/org/routes/surfaceAccess.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/org/routes/surfaceAccess.ts:113), [apps/api/src/modules/maintenance/routes/inspectors.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/maintenance/routes/inspectors.ts:86). Local synthetic probe: with user ID → deny; without user ID → empty/default claim.

### 6. P2 — Fail closed when a write-authorization lookup fails

`surfaceClaimFor` turns database errors into empty/default claims. That may be appropriate for cosmetic navigation but silently removes explicit restrictions when the same resolver protects writes.

**Fix:** Separate optional navigation loading from authoritative backend authorization. On authorization-read failure return a retriable 503, or use a deliberately designed last-known policy that cannot broaden access.

**Acceptance:** A failed screen-policy read never lets a restricted inspector mutation proceed.

Evidence: [apps/api/src/modules/org/routes/surfaceAccess.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/org/routes/surfaceAccess.ts:100), [apps/api/src/middleware/requireSurface.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/middleware/requireSurface.ts:54). Synthetic error probe returned an empty claim.

### 7. P1 — Close credential and sensitive-data gaps in telemetry scrubbing

The shared scrubber removes request bodies and cookie objects, but its key patterns do not cover Authorization, Cookie headers, passwords, access/refresh tokens, or step-up tokens. It also leaves query strings, URLs, and exception values untreated. A synthetic event retained all tested secret headers and exception text. This proves the scrubber gap; actual Sentry exposure depends on SDK collection and deployed configuration.

**Fix:** Redact secret keys case-insensitively; scrub URL/query/path credentials, exception chains, breadcrumbs, tags, and tracing events. Prefer allowlisted request metadata and apply the same policy to console/structured logs. Audit existing telemetry before deciding whether rotation is needed.

**Acceptance:** Canary tokens/passwords never appear in captured error, trace, request, or log output.

Evidence: [packages/shared/src/sentryScrub.ts](/Users/miroslavjokovic/Projects/FuelGuard/packages/shared/src/sentryScrub.ts:14), [packages/shared/src/sentryScrub.ts](/Users/miroslavjokovic/Projects/FuelGuard/packages/shared/src/sentryScrub.ts:68), [apps/api/src/instrument.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/instrument.ts:18). [OWASP logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) recommends excluding authentication secrets from logs.

### 8. P1 — Update vulnerable dependencies and enforce advisory review in CI

The current advisory registry reports affected dependencies in the API and mobile/frontend tooling. Upgrade direct parents where possible, apply compatible overrides where necessary, and document reachability for advisories without a usable patch. Do not force incompatible major versions into transitive dependencies just to silence an audit.

**Acceptance:** A fresh lockfile audit has no untriaged high/critical entries; imports/exports, EFS SOAP, API parsing, and Android build/update checks pass. Add dependency review and scheduled updates to CI.

Exact package versions, patch ranges, paths and advisory links are included in the companion JSON and dependency table below.

### 9. P2 — Enforce mobile encryption and recover without destroying evidence

SQLCipher configuration is present, but `assertEncrypted` only warns if encryption is unavailable. The app then continues. The recovery paths delete an unreadable outbox, which can destroy unsynced evidence after a key mismatch or damaged file.

**Fix:** In release builds refuse sensitive writes without verified encryption. Preserve/quarantine unreadable data, distinguish locked keychain/missing key/corruption, and show a visible recovery state. Never report an empty repaired queue as proof everything synced.

**Acceptance:** A non-SQLCipher release build cannot store the outbox in plaintext; missing-key simulation preserves the old file and surfaces recovery.

Evidence: [apps/driver/src/data/db.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/driver/src/data/db.ts:35), [apps/driver/src/data/db.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/driver/src/data/db.ts:120), [apps/driver/src/data/db.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/driver/src/data/db.ts:152).

### 10. P2 — Close the remaining EFS DNS-rebinding window

The SSRF guard validates resolved IPs, but the HTTP transport resolves the hostname again when connecting. An attacker-controlled DNS answer can change between those resolutions. Existing HTTPS and TLS validation constrain exploitability; no deployed exploit was demonstrated.

**Fix:** Prefer a narrow vendor-host allowlist. Otherwise connect only to a validated address using a controlled lookup/dispatcher while preserving hostname verification/SNI. Keep redirect refusal and egress network restrictions.

**Acceptance:** A synthetic DNS sequence returning public then private addresses never opens a private connection.

Evidence: [apps/api/src/lib/ssrfGuard.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/lib/ssrfGuard.ts:32), [apps/api/src/modules/efs/lib/soapClient.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/efs/lib/soapClient.ts:123).

### 11. P3 — Pin issuer and audience in platform JWT verification

The customer verifier does this; the platform verifier calls `jwtVerify` without issuer/audience checks. A local signed test token with deliberately wrong issuer/audience was accepted by that verifier. Production still requires the configured project's signing key and a platform allowlist match, so this is not an arbitrary-token admin takeover.

**Fix:** Pin expected issuer and `authenticated` audience; require expected claims and allowed algorithms. Reject nonsensical future MFA timestamps in step-up checks.

**Acceptance:** Wrong issuer/audience and malformed claims fail while valid platform MFA sessions pass.

Evidence: [apps/admin-api/src/lib/auth.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/admin-api/src/lib/auth.ts:70), [apps/admin-api/src/middleware/platformAuth.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/admin-api/src/middleware/platformAuth.ts:118).

### 12. P2 — Verify uploaded evidence from its bytes

Applicant capture confirmation checks that the storage object exists, then trusts the client's content type and SHA-256. The capture bucket sets an 8 MB limit but no MIME allowlist in its creation migration. The API never verifies those bytes before promoting them into compliance evidence. This is an integrity/unsafe-file-processing gap, not proof of browser script execution.

**Fix:** Quarantine uploads; enforce accepted formats and resource limits; identify/decode content safely; recompute hashes server-side before promotion. Scan document formats that can carry active content. Keep private buckets and safe download headers.

**Acceptance:** A false hash, mismatched MIME, malformed image, or disallowed file cannot become trusted evidence.

Evidence: [apps/api/src/modules/recruiting/applicationCapture.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/recruiting/applicationCapture.ts:157), [supabase/migrations/0230_application_captures.sql](/Users/miroslavjokovic/Projects/FuelGuard/supabase/migrations/0230_application_captures.sql:190).

### 13. P2 — Guarantee audit durability for sensitive changes

`writeAudit` retries, logs failure, then returns false. Member and permission writers await it without checking the result, after the mutation has committed. Privilege changes can succeed without an audit row.

**Fix:** Commit security mutations and their audit event atomically, or use a durable transactional outbox. Avoid returning failure after a successful irreversible mutation unless the client can identify/reconcile the outcome.

**Acceptance:** An audit-storage failure cannot silently produce an unaudited role/permission change.

Evidence: [apps/api/src/lib/audit.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/lib/audit.ts:35), [apps/api/src/modules/org/routes/members.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/org/routes/members.ts:192), [apps/api/src/modules/org/routes/sectionAccess.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/org/routes/sectionAccess.ts:348).

### 14. P2 — Make release-signature checks fail closed

OTA configuration can enable updates without the signing certificate if the certificate file is absent. The Android workflow also swallows `apksigner verify` failure with `|| true` and rejects only the text “CN=Android Debug”; an empty/unexpected result passes that gate.

**Fix:** Require the certificate whenever release OTA is enabled; verify the built artifact's update-signing configuration. Require successful APK verification and compare the signer fingerprint with the approved release identity.

**Acceptance:** Missing OTA certificate, failed APK verification, or wrong signer blocks publication. The checked-in certificate existing today does not remove the need for these guards.

Evidence: [apps/driver/app.config.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/driver/app.config.ts:122), [.github/workflows/driver-android.yml](/Users/miroslavjokovic/Projects/FuelGuard/.github/workflows/driver-android.yml:158).

## Security features to add or strengthen

These are design improvements, not claims of a demonstrated compromise.

| ID | Priority | Feature/update | Required result and evidence |
|---|---|---|---|
| 15 | P1 | Customer-admin MFA and step-up | Platform MFA exists; the customer authorization context does not enforce AAL2. Require MFA for customer admins and sensitive finance/card/identity actions across API **and RLS**, with secure enrollment/recovery. Add step-up to role grants, permission changes and credential issuance. [apps/api/src/middleware/auth.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/middleware/auth.ts:16); [apps/api/src/modules/org/routes/members.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/org/routes/members.ts:151). |
| 16 | P2 | Distributed abuse protection | Main/admin/driver-login limits are process-local; the custom username/IP Map never evicts distinct expired keys. Add bounded shared counters, per-account and per-invitation attempts, endpoint cost limits and tested proxy configuration. Put the admin limiter before JSON parsing. [apps/api/src/routes/auth.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/routes/auth.ts:41); [apps/api/src/app.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/app.ts:332); [apps/admin-api/src/app.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/admin-api/src/app.ts:46). |
| 17 | P2 | Sensitive local-storage protection | The driver read cache is plaintext AsyncStorage and staged media are ordinary sandbox files. Encrypt sensitive cached records/media as required by the device threat model, bound retention, and explicitly verify OS backup exclusions on built artifacts. The staging comment claims backup exclusion, but no app-specific exclusion was found. [apps/driver/src/lib/persist.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/driver/src/lib/persist.ts:19); [apps/driver/src/data/fileStaging.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/driver/src/data/fileStaging.ts:13). |
| 18 | P2 | Strong applicant-session recovery | Draft unlock uses date of birth after possession of a live link, with no per-invitation attempt counter. DOB is not a secret. Use verified-channel OTP or another proof for sensitive draft resumption; add per-link throttles and short session lifetimes. Remove bearer-link tokens from telemetry/history exposure where practical, and send no-store on sensitive responses. [apps/api/src/modules/recruiting/applicationDraft.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/recruiting/applicationDraft.ts:165); [apps/api/src/modules/recruiting/routes/publicApplication.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/recruiting/routes/publicApplication.ts:91). |
| 19 | P2 | Storage backup and restore coverage | Backup helpers exist but have no caller in the reviewed app/scripts and cover only hazmat/load-photos. Wire a scheduled independent backup, include compliance/applicant and other evidence buckets according to retention policy, and verify restores of DB **plus actual objects**. External backups may already exist; verify before replacing them. [apps/api/src/modules/org/storageBackup.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/org/storageBackup.ts:50). |
| 20 | P2 | CI and distribution hardening | Pin third-party Actions to commit SHAs, verify downloaded binaries, set explicit least-privilege workflow permissions, protect deployment environments, and scan history/PR dependency changes. Distribution uses a shared tester password with no built-in throttling: prefer individual expiring access, rate limits and logged downloads. [.github/workflows/ci.yml](/Users/miroslavjokovic/Projects/FuelGuard/.github/workflows/ci.yml:58); [apps/driver-dist/server.mjs](/Users/miroslavjokovic/Projects/FuelGuard/apps/driver-dist/server.mjs:85). |
| 21 | P2 | Managed secret rotation | AES-GCM sealing is present, but decryption supports only the current key and rejects old key IDs. Add a controlled keyring/re-encryption rotation path, encrypted key backups and rotation rehearsals. Confirm legacy plaintext credential rows are fully migrated. [apps/api/src/lib/secretBox.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/lib/secretBox.ts:127); [apps/api/src/modules/samsara/lib/samsaraToken.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/modules/samsara/lib/samsaraToken.ts:37). |
| 22 | P3 | Browser-session and CSP hardening | Web/admin persist JS-readable sessions. Consider a server session/HttpOnly-cookie design for the admin plane, with CSRF protection if cookies become the credential. Restrict CSP connections/images to actual project/vendor origins rather than wildcard Supabase tenants. This reduces impact of future XSS; no exploitable XSS was found in the inspected code. [apps/admin/src/lib/supabase.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/admin/src/lib/supabase.ts:9); [apps/api/src/app.ts](/Users/miroslavjokovic/Projects/FuelGuard/apps/api/src/app.ts:78). |

MFA must be enforced by backend/database authorization, not merely by adding an enrollment screen: [Supabase MFA guidance](https://supabase.com/docs/guides/auth/auth-mfa).

## Production verification checklist

These cannot be established from the checkout:

1. **Auth configuration:** verify invite-only signup, verified email requirements, stronger password length/leaked-password protection, MFA enforcement/recovery, JWT lifetime and inactivity/session limits. Local config currently allows email signup, disables email confirmation and permits six-character passwords; this is not proof the hosted project uses those values. [supabase/config.toml](/Users/miroslavjokovic/Projects/FuelGuard/supabase/config.toml:176).
2. **Live database/storage:** verify deployed migrations, grants on every exposed SECURITY DEFINER function/view, actual RLS policies and bucket privacy using real anon/member tokens in a staging project. The offline matrix models Supabase and does not replace this.
3. **Historical credentials:** the August audit records secrets included in a working-directory archive. Confirm the relevant credentials were rotated and exposed copies removed; a clean HEAD scan cannot answer this. [docs/AUDIT-2026-08-09.md](/Users/miroslavjokovic/Projects/FuelGuard/docs/AUDIT-2026-08-09.md:444).
4. **Hosting/network:** verify TLS, trusted proxy behavior, allowed origins, egress restrictions, environment separation, production debug flags and least-privilege Supabase/Railway/GitHub access.
5. **Monitoring and response:** confirm alerts for failed logins, access changes, denied operations, unusual exports, audit failures and backup failures; assign an incident owner and rehearse account/credential containment.
6. **Device/release state:** inspect the currently distributed APK for release identity, SQLCipher, OTA signing, backup rules and minimum supported version; source settings alone do not prove what drivers installed.

## Recommended sequence

- **First:** 1–4 and 7–8: shared-device isolation, revocation, atomic permissions, telemetry protection and dependency triage.
- **Next security release:** 5–6, 9–10, 12–18: authorization consistency, evidence protection, MFA, abuse controls and release checks.
- **Operational completion:** 19–21 and production verification; then 11 and 22 as defense-in-depth work.

No production changes or credential rotations were performed. The next implementation work should preserve existing tenant isolation and add regression cases for the specific failures above rather than relying on the currently passing suites.


## Dependency update inventory

Full registry evidence, including every dependency path: [SECURITY-DEPENDENCIES-2026-09-06.json](/Users/miroslavjokovic/Projects/FuelGuard/docs/SECURITY-DEPENDENCIES-2026-09-06.json). The registry metadata reports 24 findings; its advisory map contains 23 records because counts and affected-package records are not interchangeable. Multiple records concern the same package/advisory across version branches.

| Package | Installed versions flagged | Highest severity | Reported patch target | Advisory evidence |
|---|---|---|---|---|
| uuid | 7.0.3, 8.3.2 | Moderate | 11.1.1+ (major upgrade; upgrade parent/test compatibility) | [advisory 1](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |
| brace-expansion | 2.1.1, 1.1.15, 5.0.7 | High | 1.1.18+ / 2.1.4+ / 5.0.9+, according to installed major | [advisory 1](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp), [advisory 2](https://github.com/advisories/GHSA-mh99-v99m-4gvg), [advisory 3](https://github.com/advisories/GHSA-rgw5-rvv9-x895) |
| postcss | 8.5.16 | High | 8.5.23+ | [advisory 1](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [advisory 2](https://github.com/advisories/GHSA-r28c-9q8g-f849) |
| ip-address | 10.2.0 | High | 10.3.1+ | [advisory 1](https://github.com/advisories/GHSA-mwp4-54f8-5fhr), [advisory 2](https://github.com/advisories/GHSA-4xrf-jv44-h6hh), [advisory 3](https://github.com/advisories/GHSA-22jq-vg5j-6vgg) |
| image-size | 1.2.1 | High | No patched release reported for these advisories; assess supported replacement/mitigation | [advisory 1](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [advisory 2](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) |
| nanoid | 3.3.15 | High | 3.3.18+ | [advisory 1](https://github.com/advisories/GHSA-28wg-ghj8-5hjv), [advisory 2](https://github.com/advisories/GHSA-2v37-7h3g-55p8) |
| decode-uri-component | 0.2.2 | Moderate | 0.5.0+ | [advisory 1](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) |
| qs | 6.15.3 | Moderate | 6.16.0+ | [advisory 1](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [advisory 2](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) |
| @xmldom/xmldom | 0.9.10, 0.8.13 | Moderate | 0.8.15+ / 0.9.12+, according to installed branch | [advisory 1](https://github.com/advisories/GHSA-6gmq-8vp8-gcm6) |

These targets reflect the registry on the review date. Prefer supported parent-package updates and re-audit; they are not instructions to force incompatible transitive majors. In particular, image-size findings occur through Expo/Metro build tooling, while xml parsing and HTTP dependencies deserve API reachability review.
