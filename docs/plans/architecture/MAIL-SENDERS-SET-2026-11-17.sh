#!/bin/bash
# System mail leaves from no-reply@silvicominc.com; replies reach a person (2026-11-17).
#   office mail (invites, resets, alerts, digests) → Reply-To 360@silvicominc.com
#   applicant mail (links, reminders, questions, approval) → Reply-To recruiting@silvicominc.com
# The Reply-To code is envMail.ts MAIL_REPLY_TO / MAIL_REPLY_TO_RECRUITING (PR claude/mail-no-reply).
#
# OWNER-RUN: Claude is refused Parameter Store and GitHub secret writes.
#   bash docs/plans/architecture/MAIL-SENDERS-SET-2026-11-17.sh
#
# 1. PROVES Brevo sends from no-reply@ before changing anything: one test message to 360@ with
#    Reply-To recruiting@. A refusal stops the script with nothing changed.
# 2. Writes MAIL_FROM / MAIL_REPLY_TO / MAIL_REPLY_TO_RECRUITING for the api on staging and
#    production (printing the old MAIL_FROM — an address, not a secret).
# 3. GitHub secret MAIL_FROM (release notices, platform health) → the bare no-reply@ address.
#
# Settings reach a server only when it deploys: staging at the PR's merge, production at the next
# release — the same deploy that brings the Reply-To code, so production never sends from no-reply@
# without a Reply-To. Do not hotfix a commit older than the PR's merge in between.
set -euo pipefail
export AWS_PROFILE=silvicom AWS_REGION=us-west-2
FROM_NAME="Silvicom Inc"
FROM=no-reply@silvicominc.com
OFFICE=360@silvicominc.com
RECRUITING=recruiting@silvicominc.com

key=$(aws ssm get-parameter --name /silvicom/production/api/BREVO_API_KEY --with-decryption --query Parameter.Value --output text)
echo "== 1. Brevo test: $FROM → $OFFICE (Reply-To $RECRUITING)"
body=$(jq -n --arg n "$FROM_NAME" --arg f "$FROM" --arg t "$OFFICE" --arg r "$RECRUITING" '{
  sender: {name: $n, email: $f}, to: [{email: $t}], replyTo: {email: $r},
  subject: "Silvicom 360 sender test — no-reply@",
  textContent: "Sent by MAIL-SENDERS-SET-2026-11-17.sh to prove Brevo sends from no-reply@silvicominc.com. Pressing Reply should address recruiting@silvicominc.com."}')
resp=$(curl -sS -w '\n%{http_code}' -H "api-key: $key" -H 'content-type: application/json' -H 'accept: application/json' \
  https://api.brevo.com/v3/smtp/email -d "$body")
unset key
code=$(tail -n1 <<<"$resp"); echo "  HTTP $code $(head -n1 <<<"$resp" | cut -c1-200)"
[ "$code" = 201 ] || { echo "Brevo refused no-reply@ — nothing was changed. Paste the line above to Claude." >&2; exit 1; }

for e in staging production; do
  p=/silvicom/$e/api
  old=$(aws ssm get-parameter --name "$p/MAIL_FROM" --with-decryption --query Parameter.Value --output text 2>/dev/null || echo "(unset)")
  echo "== 2. $e api: MAIL_FROM $old  →  $FROM_NAME <$FROM>"
  aws ssm put-parameter --name "$p/MAIL_FROM" --type SecureString --overwrite --value "$FROM_NAME <$FROM>" --query Version --output text
  aws ssm put-parameter --name "$p/MAIL_REPLY_TO" --type SecureString --overwrite --value "$OFFICE" --query Version --output text
  aws ssm put-parameter --name "$p/MAIL_REPLY_TO_RECRUITING" --type SecureString --overwrite --value "$RECRUITING" --query Version --output text
done

echo "== 3. GitHub secret MAIL_FROM → $FROM"
gh secret set MAIL_FROM --body "$FROM"
echo "Done. Check 360@'s inbox for the test message (and that Reply addresses recruiting@)."
