# HazmatGuard §172.101 automated eCFR↔GovInfo cross-check (D5 v7)

- Source A: eCFR processed XML → parseHmtSection (2479 entries)
- Source B: GovInfo CFR-2025-title49-vol2, §172.101 (2025-10-01) → parseHmtGovInfoSection (2479 entries)

## Full-table triangulation (all rows)
matched: 2397 · disagreements: 3 · A-only (in eCFR, not GovInfo edition): 0 · B-only (in GovInfo edition, not eCFR): 0 · key-collisions: 76

## In-scope fuel release gate: CLEAN ✓
### UN1203 — Gasoline  [✓ match]
### UN1202 — Diesel fuel  [✓ match]
### NA1993 — Diesel fuel  [✓ match]
### NA1993 — Fuel oil  [✓ match]
### UN3475 — Ethanol and gasoline mixture  [✓ match]
### UN1170 — Ethanol  [✓ match]
### UN1987 — Alcohols, n.o.s.  [✓ match]
### UN1863 — Fuel, aviation, turbine engine  [✓ match]
### UN1268 — Petroleum distillates, n.o.s.  [✓ match]
### UN1223 — Kerosene  [✓ match]
### UN1075 — Petroleum gases, liquefied  [✓ match]
### UN1978 — Propane  [✓ match]
### UN3257 — Elevated temperature liquid, n.o.s.  [✓ match]

## All disagreements (3) — each must be explained by a cited rule (reconciliations.ts)
### UN0431 — Articles, pyrotechnic
- `pgRows[—].specialProvisions`: eCFR=["200", "381"]  GovInfo=["381"]
- `pgRows[—].quantityLimits.cargoAircraft`: eCFR="75kg"  GovInfo="75 kg"
### UN0335 — Fireworks
- `pgRows[—].specialProvisions`: eCFR=["108", "200"]  GovInfo=["108"]
### UN0101 — Fuse, non-detonating
- `pgRows[—].specialProvisions`: eCFR=["200"]  GovInfo=[]

## HMT differences explained by a cited rule: CLEAN ✓ — explained 4 · unexplained 0 · stale 0 · out of window 0 (GovInfo edition 2025-10-01, eCFR 2026-10-09)
- ✓ UN0431|articles, pyrotechnic `pgRows[—].specialProvisions`: eCFR=["200", "381"] GovInfo=["381"] — 91 FR 51098 (FR doc 2026-16111)
- ✓ UN0431|articles, pyrotechnic `pgRows[—].quantityLimits.cargoAircraft`: eCFR="75kg" GovInfo="75 kg" — 91 FR 51098 (FR doc 2026-16111)
- ✓ UN0335|fireworks `pgRows[—].specialProvisions`: eCFR=["108", "200"] GovInfo=["108"] — 91 FR 51098 (FR doc 2026-16111)
- ✓ UN0101|fuse, non-detonating `pgRows[—].specialProvisions`: eCFR=["200"] GovInfo=[] — 91 FR 51098 (FR doc 2026-16111)

## §172.504 placard tables: CLEAN ✓ — matched 23/23 · value-diffs 0 · eCFR-only 0 · GovInfo-only 0

## §177.848(d) segregation grid: CLEAN ✓ — matched 173/173 · value-diffs 0 · eCFR-only 0 · GovInfo-only 0

# TRIANGULATION VERDICT: ALL CLEAN ✓ — eCFR and the official GovInfo edition agree except 4 field difference(s), each explained by a cited Federal Register rule
