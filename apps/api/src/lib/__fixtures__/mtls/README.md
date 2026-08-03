# Test PKI for mutual TLS

⚠️ **These are throwaway test keys.** They are generated for this repository's test suite, they
protect nothing, and they are committed on purpose so the mTLS tests run with no setup. Never reuse
any of this material anywhere else.

`soapClientMtls.test.ts` stands up a real HTTPS server that requires a client certificate and drives
the SOAP client against it over a real socket. That is only possible with a self-contained PKI, so
here it is.

## Contents

| File | What it is |
|---|---|
| `ca.crt` / `ca.key` | The test root CA. Signs the server and the valid client certificates. |
| `server.crt` / `server.key` | Server certificate for `localhost` / `127.0.0.1` (SAN set, `serverAuth` EKU). |
| `client.crt` / `client.key` | The happy-path client identity (`CN=fuelguard-efs-client`, `clientAuth` EKU). |
| `client.enc.key` | The same key, AES-256-CBC encrypted. Passphrase: `testpass`. |
| `client.p12.b64` | Base64 PKCS#12 of `client.crt` + `client.key` + `ca.crt`. Passphrase: `testpfx`. |
| `client2.crt` / `client2.key` | A second valid identity — rotation and key-mismatch tests. |
| `rogue-ca.crt`, `rogue-client.crt` / `rogue-client.key` | Signed by an untrusted CA — the "server refuses us" case. |
| `expired-client.crt` / `expired-client.key` | Valid 2020-01-01 → 2021-01-01. Exercises the expiry rejection. |
| `expiring-soon.crt` | Valid 2026-01-01 → 2026-09-01. Exercises the expiry *warning* band. |

Every certificate except the two dated ones is issued for 36500 days, so the suite cannot start
failing because a fixture lapsed.

## Regenerating

Only needed if you change the shape of what is tested (a different key algorithm, an EC key, an extra
intermediate). Requires OpenSSL 3.

```bash
cd apps/api/src/lib/__fixtures__/mtls

# Root CA
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 36500 \
  -subj "/O=FuelGuard Test/CN=FuelGuard Test Root CA"

# Server (localhost)
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr \
  -subj "/O=FuelGuard Test/CN=localhost"
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' > server.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 36500 -extfile server.ext

# Client
printf 'extendedKeyUsage=clientAuth\nkeyUsage=digitalSignature,keyEncipherment\n' > client.ext
openssl req -newkey rsa:2048 -nodes -keyout client.key -out client.csr \
  -subj "/O=Silvi Logistics/CN=fuelguard-efs-client"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out client.crt -days 36500 -extfile client.ext
openssl pkey -in client.key -aes-256-cbc -passout pass:testpass -out client.enc.key
openssl pkcs12 -export -inkey client.key -in client.crt -certfile ca.crt \
  -passout pass:testpfx -out client.p12
base64 -w0 client.p12 > client.p12.b64

# Second client (rotation tests) — same as above with CN=fuelguard-efs-client-2 → client2.*
# Rogue CA + client — same as above signed by rogue-ca.* instead of ca.*

# Dated certificates need `openssl ca` (the `x509` app only grew -not_before/-not_after in 3.2):
mkdir -p demoCA/newcerts && touch demoCA/index.txt && echo 1000 > demoCA/serial
# ...with a minimal ca.cnf pointing at ./ca.crt + ./ca.key, then:
openssl ca -batch -config ca.cnf -in expired-client.csr -out expired-client.crt \
  -startdate 20200101000000Z -enddate 20210101000000Z -extensions client_ext -notext
```

Delete the intermediate `*.csr`, `*.ext`, `*.srl` and `demoCA/` artefacts afterwards — only the files
in the table above belong in the repository.

If you regenerate, check `x509.test.ts`'s `NOW` constant: it must fall after the fixtures'
`notBefore` and inside the `expiring-soon` warning band.
