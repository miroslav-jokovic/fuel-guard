# SMS parity fixture — frozen 2026-10-10/11

FMCSA open data for USDOT 1864495, trimmed to the fields `@silvicom/sms-engine` reads. Fetched from
data.transportation.gov (dataset ids in `docs/regulatory/fmcsa/SOURCES.md`):

| File | Dataset | Fetched |
|---|---|---|
| `feed-inspections.json` | `fx4q-ay7w` Vehicle Inspection File | 2026-10-10 |
| `feed-violations.json` | `876r-jsdb` Vehicle Inspections and Violations | 2026-10-10 |
| `feed-citations.json` | `qbt8-7vic` Inspections and Citations | 2026-10-10 |
| `sms-inspections.json` | `rbkj-cgst` SMS Input – Inspection (published 2026-09-13) | 2026-10-10 |
| `sms-violations.json` | `8mt8-2mdr` SMS Input – Violation (published 2026-09-13) | 2026-10-10 |

The two SMS files are FMCSA's own answer: what its 2026-08-28 snapshot scored, weight by weight.
The three feed files are the inputs. `parity.test.ts` computes the first from the second (D-IC6).

Never refresh these in place. A later snapshot is a new fixture set beside this one, so this
comparison stays reproducible.
