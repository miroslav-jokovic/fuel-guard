/**
 * The EFS write check's verdict in plain words — one sentence per `recommendation` code.
 *
 * ── Why this exists (CCF3, D-CCF6, 2026-10-28) ──────────────────────────────────────────────────
 * `writeProbeJudge.ts` returns two things: a `recommendation` code and a `verdict` paragraph. The
 * verdict is the engineering record — it is archived in `probe_result`, the CLI prints it, and it names
 * file paths, "Phase B", `write_entitlement`, `readOnly=false` and `POST /api/fuel-cards/diagnose`.
 * The settings page showed it verbatim to the admin who ran the check (plan W4), which is a support
 * engineer's paragraph in front of a fleet owner.
 *
 * The server's text stays exactly as it is. The page leads with the sentence below, chosen by the code
 * the judge ALREADY returns, and moves the verdict under "Technical details — for support". Keyed by
 * the code rather than parsed out of the verdict, so rewording the record cannot change what an admin
 * is told, and typed as a `Record` over the code list so a new code without a sentence fails the build
 * (`writeProbeJudge.ts` returns `WriteCheckRecommendation`, not `string`).
 *
 * Where the next step is the operator CLI, the sentence says "your Silvicom 360 administrator" and
 * stops (D-CCF8) — no screen in the app approves or diagnoses, so naming one would be a dead end.
 */

export const WRITE_CHECK_RECOMMENDATIONS = [
  "fix_credentials",
  "fix_read_access",
  "fix_echo",
  "no_action",
  "run_write_half",
  "ask_wex_for_write_entitlement",
  "investigate_write_failure",
  "investigate_real_change_failure",
  "no_change_investigate",
  "restore_card_manually",
  "run_real_change_half",
  "enable_for_pilot_org",
] as const;

export type WriteCheckRecommendation = (typeof WRITE_CHECK_RECOMMENDATIONS)[number];

const SEND_DETAILS = "Send the technical details below to your Silvicom 360 administrator.";

export const WRITE_CHECK_PLAIN_VERDICT: Readonly<Record<WriteCheckRecommendation, string>> = {
  fix_credentials:
    "Silvicom 360 could not sign in to EFS. Check the username and password in Settings → EFS Integration, then run the check again.",
  fix_read_access:
    `Silvicom 360 signed in to EFS but could not read this card, so nothing else could be checked. ${SEND_DETAILS}`,
  // Steps 4 and 6 share this code: our copy of the card was not exact, before or after the write.
  fix_echo:
    "Silvicom 360 did not copy this card exactly as EFS holds it, so a card change could alter settings "
    + `nobody asked to change. Card actions must stay off. The fault is ours, not WEX's. ${SEND_DETAILS}`,
  no_action:
    "The read-only check passed. Nothing was changed, and write access stays confirmed.",
  run_write_half:
    "The read-only check passed. Write access is not proven yet: run the check again with “Read only” "
    + "unticked, on a spare card WEX has agreed you may test with.",
  ask_wex_for_write_entitlement:
    // The vendor operation names WEX will ask for are in the technical details, not in this sentence.
    "EFS refused to let Silvicom 360 change cards on this account. Ask WEX to allow card changes "
    + "through its web service for this account. Viewing cards keeps working.",
  investigate_write_failure:
    `EFS did not accept the change, and not because of permissions. Card actions must stay off until the cause is known. ${SEND_DETAILS}`,
  investigate_real_change_failure:
    `EFS did not accept the test change, and not because of permissions. Card actions must stay off until the cause is known. ${SEND_DETAILS}`,
  no_change_investigate:
    `EFS accepted the test change but did not apply it to the card. Card actions must stay off. ${SEND_DETAILS}`,
  restore_card_manually:
    "The test change reached the card, but putting the card back did not finish. Check this card's status "
    + "in the WEX portal and set it back to what it was, then run the check again.",
  run_real_change_half:
    "The first checks passed, but the test change did not run, so write access is not proven yet. Run the "
    + "check again with “Read only” unticked.",
  enable_for_pilot_org:
    "All ten checks passed. Silvicom 360 can change this company's cards safely, and card actions can be switched on.",
};

/**
 * The sentence for a code read off the wire, or null for one this build does not know.
 *
 * Null rather than a guess: an older or newer API can send a code this page has no sentence for, and
 * the page then shows the server's own verdict instead — accurate, if technical, beats plain and wrong.
 */
export const writeCheckPlainVerdict = (recommendation: string | null | undefined): string | null =>
  (recommendation && Object.hasOwn(WRITE_CHECK_PLAIN_VERDICT, recommendation)
    ? WRITE_CHECK_PLAIN_VERDICT[recommendation as WriteCheckRecommendation]
    : null);
