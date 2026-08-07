# certs

`certificate.pem` — the PUBLIC code-signing certificate for over-the-air updates. It is committed
deliberately: `expo-updates` compiles it into the binary and verifies every update manifest against
it, so an attacker who reaches the update server still cannot push JavaScript to a fleet phone.

Get it from the xprem dashboard (app page → download certificate) and save it here as
`certificate.pem`, or generate a pair with `npx eoas generate-certs`.

The matching PRIVATE key never belongs in this repository. In the Railway deployment the server holds
it, sealed in Postgres with `DB_KEYS_MASTER_KEY_B64`.

Until `certificate.pem` exists, `app.config.ts` omits `codeSigningCertificate` and builds are
unsigned-update builds — fine for a first smoke test, not for anything a driver installs.
