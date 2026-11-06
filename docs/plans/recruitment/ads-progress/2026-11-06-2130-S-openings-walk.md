**2026-11-06 · Track S · openings-editor, staging walk (5) — partly walked; BLOCKED at line 11 → Q-AD46**

Staging at `f00a30d` (#2114), through the UI only:

- **[Admin]** Recruitment › Openings → New opening: the owner's starting requirements are shown read-only →
  "Class A regional" → **Save as the first hiring profile** (`201 POST /api/recruitment/hiring-profiles`); the
  profile is then picked. Nothing seeded it.
- **[Manager]** New opening "Staging walk — Class A regional": the place search gave HERE's "Joliet, IL, United
  States" (and two more) for a recruiter-section member; 50 mi, 62–70¢ a mile, Home weekly, Dry van →
  `201 POST /api/recruitment/openings`; row Open · v1 · "Staging Test — Fleet Manager".
- **G-walk 10 (start):** home → Recruitment group → Applicants → Campaigns tab → New campaign = 4 clicks. The opening
  is offered → Start campaign → `201 POST /api/ads/campaigns` (`7f40f13e-…`). The brief snapshot is right.
- **Stopped:** the campaign stayed **Starting** (`draft`) for 15 min and no job failed. `ADS_ENABLED` is unset on
  both uat services, so the orchestrator is braked and `compose` is null: designed behaviour, not a bug. Recorded as
  **Q-AD46** (rec: the owner sets it on the uat `general`-lane service; it also starts real AI spend under the v1
  caps). Lines 11–16 and the four-click done-when wait on it; nothing was forced by hand.
- G-walk updated: 9a/9b added and walked, 10 split ✅/⛔, 11–16 re-pointed from Q-AD43 to Q-AD46.
