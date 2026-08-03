# EFS SOAP — mutual TLS (client certificate)

**Status:** implemented, uncommitted. Inert until a certificate is installed.
**Migration:** `0106_efs_soap_client_certs.sql`
**New env var:** `SECRETS_ENCRYPTION_KEY` (required only to store a certificate in the database)

---

## 1. What this is for

EFS may require FuelGuard to present a client certificate on their `CardManagementWS` endpoint. We
don't have their answer yet. Rather than wait and then rush it, the capability is built, tested and
shipped **inert**: with nothing configured, `efsTlsOptions()` returns null, every request goes over
ordinary TLS through `fetch`, and the transport behaves byte-for-byte as it did before. When EFS
confirms, an admin installs the certificate through the UI and it takes effect — no code change, no
deploy, no risk to the working path.

Two supply routes, in precedence order:

1. **Per-org**, the `active` row in `efs_soap_client_certs`, private key sealed at rest. This is the
   path the settings UI drives and the one to use.
2. **Deploy-wide**, the `EFS_SOAP_CLIENT_*` env vars. Single-tenant fallback and the escape hatch for
   when the database isn't reachable or `SECRETS_ENCRYPTION_KEY` isn't set yet.

---

## 2. Design decisions, and why

### The private key is encrypted before it reaches Postgres

Every other secret in this system (`integration_credentials.samsara_api_token`,
`efs_soap_credentials.soap_password`) sits in a plaintext column behind "service-role only, no RLS
policies". For a revocable API token that is defensible. For a **TLS private key** it is not: a key is
a long-lived cryptographic identity, and "only the service role can SELECT it" says nothing about
`pg_dump`, logical replicas, PITR snapshots, or a read-only analytics grant added six months from now.

So `lib/secretBox.ts` seals it — AES-256-GCM, random 96-bit IV per seal, 128-bit tag — under
`SECRETS_ENCRYPTION_KEY`, which lives in the deploy environment and never in the database.
**Compromising the database alone does not yield a usable client certificate.**

The GCM *additional authenticated data* binds each ciphertext to `(org_id, purpose)`. Lifting a sealed
key out of one org's row into another's fails authentication rather than decrypting — closing the
"copy the ciphertext, impersonate the tenant" move that plain encryption leaves open.

The envelope carries a short key id (`v1.<keyid>.<iv>.<tag>.<ct>`). When the KEK is rotated, the
failure reads *"sealed with key a1b2c3d4 but this deploy holds e5f6a7b8 — restore the previous key or
re-enter the credential"* instead of an opaque `unable to authenticate data`.

If `SECRETS_ENCRYPTION_KEY` is unset, upload is **refused**. It does not fall back to plaintext.

### Rotation is stage → test → activate, never a column swap

A TLS identity cannot be swapped by writing a column and hoping. If the new certificate is wrong —
wrong issuer, missing intermediate, not yet enrolled on EFS's side — every subsequent call fails,
*including the call you'd use to diagnose it*. So a certificate lands as `pending`, is proven against
the live endpoint with a real `login()`, and only then becomes `active`; the incumbent becomes
`retired` and is one call away from being restored.

Two partial unique indexes (`one active per org`, `one pending per org`) make the invariant a database
constraint rather than something the application has to remember. `retired` rows are kept: they are
the audit trail of which certificate was presenting on which date, installed by whom.

### Upload validation is strict, because the alternative is a 03:00 handshake failure

`lib/x509.ts` runs the full pre-flight before anything is stored:

| Check | Why |
|---|---|
| Key matches certificate | The highest-value check here. A mismatched pair fails deep inside the handshake as `ERR_OSSL_X509_KEY_VALUES_MISMATCH`, which reads like a network fault. |
| Not expired / not yet valid | **Rejected**, not warned. Storing an expired certificate guarantees an outage and there is no reading of the operator's intent under which it's what they meant. |
| `extendedKeyUsage` permits clientAuth | Catches a server certificate uploaded by mistake — a common issuer mix-up. |
| Encrypted key without a passphrase | Detected before OpenSSL sees it, otherwise the error is `interrupted or cancelled` (it tried to prompt on a terminal that doesn't exist). |
| Chain order, missing intermediates, self-signed CA | Warnings, not blocks. They parse and may work; the operator should just know. |

### Connections are pooled by certificate identity

One keep-alive `https.Agent` per TLS identity. A fresh agent per request would mean a fresh handshake
per request — an RSA signature every time, session resumption defeated. The pool key is the
certificate **fingerprint**, never key material, and it is LRU-bounded at 32 so a multi-tenant deploy
can't leak sockets.

Activation calls `invalidateTlsAgents()`. Without it, the next request rides a socket established
under the *old* certificate — which is exactly how a rotation appears to "not take effect".

### TLS floor and the insecure escape hatch

`minVersion: TLSv1.2` on every agent. `EFS_SOAP_TLS_INSECURE=true` disables server verification for a
self-signed staging endpoint, and is **refused outright when `NODE_ENV=production`** — a thrown error,
not a logged warning, because disabling verification turns mutual TLS into theatre (it authenticates
us to EFS while accepting any server that answers) and a warning would be ignored.

### Handshake errors are translated

`classifyTlsError()` maps OpenSSL/Node codes to the action that fixes them. `EPROTO ... alert
handshake failure` becomes *"EFS rejected the TLS handshake. Most often this means our client
certificate is not enrolled on their side, or they expected one and none was presented — confirm the
fingerprint with EFS."* The outcome is recorded against the certificate row, so the settings page
shows *"Last handshake FAILED 04:12 — …"* on the specific certificate rather than a generic
integration error.

### Expiry is watched, because it fails closed with no warning

A client certificate is the one credential here that expires on somebody else's schedule and takes the
feed down silently at midnight. Issuers do send renewal notices — to whoever's address was on the
order, rarely the person watching this dashboard. `services/efsSoapCertExpiry.ts` sweeps daily,
emails the org's notification addresses once per certificate per band (30 days out, then again when it
actually lapses), and logs loudly even when there is nobody to email. An **expired** certificate is
mailed even if routine notifications are switched off — turning off the daily digest is not consent to
miss an integration going dark.

---

## 3. Operating it

### One-time setup

```bash
# Generate the sealing key and set it on BOTH the API and worker services.
openssl rand -base64 32
# → SECRETS_ENCRYPTION_KEY=<that value>
```

Back it up wherever you keep deploy secrets. Losing it makes stored certificates unreadable — they'd
have to be re-uploaded, which is recoverable but annoying. Apply migration `0106`. The boot schema
check probes `efs_soap_client_certs.fingerprint_sha256` and logs loudly if it's missing.

### Installing a certificate (Settings → Integrations → EFS)

1. **Install** — paste the certificate (leaf first, then intermediates) and its private key. Passphrase
   and CA bundle only if applicable. It validates and stages as **pending**; nothing changes yet.
2. Send EFS the displayed **SHA-256 fingerprint** if they enrol certificates on their side. Do this
   *before* activating — unenrolled is the usual cause of a rejected handshake.
3. **Test against EFS** — a real `login()`/`logout()` using the pending certificate. The working
   certificate keeps serving traffic throughout.
4. **Activate** — stays disabled until the test passes. Pooled sockets are dropped so the next call
   presents the new identity.
5. **Roll back** if anything goes wrong — one click, restores the previous certificate.

### Renewal

Identical to installation. The expiry email arrives 30 days out with the fingerprint and these steps.

### API surface

| Method | Route | Notes |
|---|---|---|
| `GET` | `/api/integrations/efs-soap/client-cert` | active + pending + history. Metadata only. |
| `POST` | `/api/integrations/efs-soap/client-cert` | upload; `{"activate":true}` to skip staging |
| `POST` | `/api/integrations/efs-soap/client-cert/test` | real EFS login with the pending certificate |
| `POST` | `/api/integrations/efs-soap/client-cert/activate` | pending → active |
| `POST` | `/api/integrations/efs-soap/client-cert/rollback` | restore the previous |
| `DELETE` | `/api/integrations/efs-soap/client-cert` | withdraw; falls back to env, then plain TLS |

All admin-only, all audited (`integration.efs_soap.client_cert_*` with fingerprint + subject + expiry
— never key material). `GET /efs-soap/config` gained a `tls` block describing what is presenting.

### Deploy-wide alternative

If you'd rather not use the database path, or need it before `SECRETS_ENCRYPTION_KEY` exists:

```bash
EFS_SOAP_CLIENT_CERT_PEM="-----BEGIN CERTIFICATE-----\n…"   # or _B64
EFS_SOAP_CLIENT_KEY_PEM="-----BEGIN PRIVATE KEY-----\n…"    # or _B64
EFS_SOAP_CLIENT_KEY_PASSPHRASE=…        # only if the key is encrypted
EFS_SOAP_CLIENT_PFX_B64=…               # or PKCS#12 instead of the PEM pair
EFS_SOAP_CLIENT_PFX_PASSPHRASE=…
EFS_SOAP_CA_PEM=…                       # only for a private/enterprise root
```

Literal newlines or `\n` both work. Setting a cert without its key throws at request time with an
explicit message rather than silently falling back to anonymous TLS.

---

## 4. What to ask EFS

Ask all of these at once — each answer changes the configuration.

1. **Is a client certificate required** on the production `CardManagementWS` endpoint, or is the
   source-IP allowlist the only access control?
2. **Who issues it** — do they issue it to us, or do we submit a CSR? In what format (PEM pair or
   PKCS#12)?
3. **Do they enrol the certificate** on their side (pin the fingerprint / subject DN), or do they just
   verify it chains to a public CA? If they enrol, we need to send the fingerprint before each
   rotation — that is what the staged-rotation flow is built around.
4. **Is their server certificate chained to a public root**, or do we need their CA bundle?
5. **What is the renewal cadence and lead time**, and what address do renewal notices go to? We watch
   expiry ourselves, but it's worth knowing whose calendar it's on.
6. Does the certificate carry any **authorisation meaning** (per-account identity), or is it purely
   transport-level? This decides whether one certificate covers all orgs — the implementation supports
   per-org certificates either way, but it changes what you order.

---

## 5. Verification

```
apps/api  ·  tsc --noEmit clean  ·  251 tests pass
  soapClientMtls.test.ts  26 tests — REAL handshakes against a live client-cert-requiring HTTPS server
  x509.test.ts            21 tests — validation, expiry arithmetic, mismatch detection
  secretBox.test.ts       15 tests — round trip, AAD tenant binding, tampering, KEK rotation
  efsSoapClientCerts      16 tests — staged rotation, rollback, "no plaintext key anywhere"
```

The mTLS suite does not mock the transport. It stands up an HTTPS server that demands a client
certificate signed by a known CA — EFS's posture — and drives the real SOAP client against it over a
real socket, asserting things only an actual handshake can show: that the server reads our subject
from the certificate, that an unknown-CA client is refused, that an untrusted *server* is refused,
that encrypted keys and PKCS#12 work, that three SOAP calls produce **one** handshake, and that
activation forces a new connection.

Two tests worth knowing about by name:

- *"never writes the private key in plaintext"* — serialises the whole stored row and asserts no key
  material appears anywhere in it.
- *"history is metadata only"* — serialises every API-returned certificate object and asserts the same.
  Should someone later add a field that leaks the key, this fails.

Test PKI lives in `apps/api/src/lib/__fixtures__/mtls/` with a README covering regeneration. Those are
throwaway keys, committed on purpose so the suite runs with no setup, and dated to 2126 so it can't
rot.

Run on the Mac before committing:

```bash
pnpm -r typecheck && pnpm --filter @fuelguard/api test && pnpm lint && pnpm lint:boundaries
```
