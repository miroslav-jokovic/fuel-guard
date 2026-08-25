# SheetJS (xlsx) 0.20.3 — vendored

Reads genuine **Excel 97-2003 binary `.xls`** (BIFF8). Nothing else in the repo can: ExcelJS is
xlsx-only and Papa is CSV, so the daily Pilot price report — which the carrier receives as a real
binary `.xls` — was rejected at the dropzone with a convert-to-xlsx prompt.

## Why it is vendored rather than installed

There is no version of this library that is BOTH current and installable with integrity checking:

| Source | Version | Integrity | Known advisories |
|---|---|---|---|
| npm `xlsx` | 0.18.5 (frozen) | yes | **2 high** — prototype pollution (<0.19.3), ReDoS (<0.20.2) |
| `cdn.sheetjs.com` tarball | 0.20.3 | **no** — pnpm refuses: `ERR_PNPM_MISSING_TARBALL_INTEGRITY` | none |
| this directory | 0.20.3 | yes, by being in git | none |

SheetJS stopped publishing to npm after 0.18.5, so npm's "latest" carries two unpatched high-severity
advisories. The vendor's own CDN serves the patched build but cannot be integrity-verified by pnpm,
and a build that depends on a third-party CDN being up is a build that breaks without a commit.

Committing the file makes the exact bytes reviewable, pins them, and removes the install-time network
dependency. `xls.test.ts` asserts the digest below, so a silent edit fails CI.

## Provenance

    source   https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
    file     package/xlsx.mjs
    sha256   1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db
    licence  Apache-2.0 (see LICENSE)

## Upgrading

Download the tarball, copy `package/xlsx.mjs` here, and update the digest in `xls.test.ts`. Check
the advisory list first — the reason this is vendored is that npm's copy is not safe to use.
