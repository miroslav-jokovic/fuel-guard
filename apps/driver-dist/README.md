# driver-dist — internal Android build distribution

Serves the signed FuelGuard Driver APK to invited testers, and accepts new builds from CI.
Zero dependencies on purpose: this service holds the artifact that ends up on every fleet phone, so
every package added here is a supply-chain path onto a driver's device.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/` | tester (Basic) | Install page: latest version, commit, notes, install instructions |
| GET | `/download/latest.apk` | tester (Basic) | The newest build |
| GET | `/download/<file>` | tester (Basic) | A specific build |
| GET | `/api/releases` | tester (Basic) | JSON feed of retained builds |
| PUT | `/api/releases/<file>.apk` | CI (Bearer) | Publish a build |
| GET | `/healthz` | none | Liveness; reports `misconfigured` until both secrets are set |

Tester auth is HTTP Basic with a shared passphrase — the username is ignored. Both secrets are
compared in constant time and both fail closed: unset means every request is refused, never allowed.

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `8080` | Railway sets this |
| `DATA_DIR` | `/data` | Mount a Railway volume here — artifacts must survive a redeploy |
| `TESTER_PASSWORD` | — | Required. Shared passphrase handed out with the install link |
| `UPLOAD_TOKEN` | — | Required. Held only by GitHub Actions |
| `KEEP_RELEASES` | `10` | Older builds are deleted on each publish |
| `RETENTION_DAYS` | `90` | Matches TestFlight's build expiry |
| `MAX_UPLOAD_BYTES` | `314572800` | 300 MB ceiling on a single upload |

## Deployment

Built from `Dockerfile` (`node:22-alpine`, two files copied, no package manager). On Railway:

- **Root Directory: empty.** It prunes the build context. The Dockerfile locates its sources under
  either setting, but empty is the correct value.
- **Config path: `railway.driver-dist.json`.** Otherwise Railway falls back to `railway.json` and
  builds the API.
- **Volume mounted at `/data`.**

## Local run

```
pnpm --filter @fuelguard/driver-dist dev     # DATA_DIR=./.data, both secrets = "dev"
```
