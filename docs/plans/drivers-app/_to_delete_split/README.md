# FuelGuard Driver App — Planning

Living plan for the native **React Native + Expo** app for drivers. Enterprise-grade, offline-first,
built inside the existing monorepo, reusing `@fuelguard/shared`. Written incrementally — the master +
Phase 0 + Phase 1 are complete; later phases are written after these are verified.

| # | Doc | State |
|---|-----|-------|
| 00 | [Master Plan](./00-DRIVERS-APP-MASTER-PLAN.md) — vision, scope, architecture, identity, design-system port, phase map, conventions, open items | ✅ |
| 01 | [Phase 0 — Foundation & Design System](./01-PHASE-0-FOUNDATION.md) | ✅ |
| 02 | [Phase 1 — Identity, Auth & Access Control](./02-PHASE-1-IDENTITY-AUTH.md) | ✅ |
| 03 | [Phase 2 — Offline-first Data Layer & Home](./03-PHASE-2-OFFLINE-DATA-HOME.md) | ✅ |
| 04 | [Phase 3 — Fuel Capture](./04-PHASE-3-FUEL-CAPTURE.md) | ✅ |
| 05 | Phase 4 — My Fuel Log & My Performance | ⏳ |

**Locked decisions:** driver login = personal email + password · styling = NativeWind (locked token
config + token linter) · v1 = Foundation only · robust offline-first · full-stack (app + backend).

**Start here:** read `00` end-to-end, then `01`, then `02`. Every decision is LOCKED (with rationale)
or tracked as an OPEN item in `00 §12`.
