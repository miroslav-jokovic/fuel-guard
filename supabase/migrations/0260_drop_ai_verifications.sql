-- Silvicom 360 — 0260 drop ai_verifications
--
-- 0008 created `ai_verifications` for an AI-assisted anomaly review that was never wired: in 252
-- migrations since, no application code has written or read a row. The 2026-08-26 audit flagged
-- it, `lint:table-producers` waived it pending this decision, and the anomalies carve-out is
-- where docs/ARCHITECTURE.md §4 parked the build-or-drop call. Measured against production
-- before writing this file: zero rows. Nothing is lost, and the gate's waiver retires with the
-- table — 6 waivers become 5. If AI verification returns, it ships WITH its producer, the
-- ordering the gate now guarantees (same rationale as 0259's terminals drop).

drop table if exists ai_verifications;
