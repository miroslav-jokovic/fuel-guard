**2026-11-14 · Track owner · platform-v2-plan**

The owner asked for an audit of ads and lead collection, then for research, then for the plan to be updated
with the solutions proposed. Written: [`ADS-PLATFORM-V2-PLAN.md`](../ADS-PLATFORM-V2-PLAN.md) — four parts
(control, agents, orchestration, lead engine), steps V1–V8, questions Q-APX1–5 in a series of their own, and a
pointer at the head of `ADS-AGENT-PLAN.md` §9.

Measured for it, on main `0d8113f`: production holds no ad connection, campaign, creative, generation, lead, kit,
preset or settings version; no certification record exists, so every real launch is refused; no still model is
chosen; all six Claude workers run on `claude-sonnet-4-6` behind a forced tool call; the key answers 200 on
`claude-fable-5-2`, `claude-opus-5-5` and `claude-sonnet-5-5` (three one-line calls); no ads worker reads a
lead's name, phone or e-mail.

Not built: everything. No code changed. Not measured: the servers' settings (the AWS session had expired) and
staging's rows.

Opened: Q-APX1 (automation by kind of risk; asks to reverse Q-AD2 for one case), Q-APX2 (Fable's 30-day
retention), Q-APX3 (the judge's ground truth), Q-APX4 (which video first), Q-APX5 (speech-to-text, research
owed). Each carries what was read and a recommendation; none is ruled.

Next: V1, the AI rail, which needs no ruling; its recordings are asked for first.
