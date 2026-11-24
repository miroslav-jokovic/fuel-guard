#!/bin/bash
# Run the P0 proofs from the gateway's own Lambda (probe/index.mjs) and print the verdicts.
# OWNER-RUN with `!` (invoking the function needs the owner's AWS session):
#
#   AWS_PROFILE=silvicom bash infra/mail-gateway/prove.sh <staging|production> <test mailbox> [--expect-body]
#
# The test mailbox goes in the invoke payload, which AWS does not log; the canary is read by the
# function from Parameter Store. `--expect-body` is for the day-4 switch to Mail.Read (Q-BMR9): the
# body check then passes only if a body CAN be read. Paste the printed block back into the chat — it
# holds verdicts, statuses and error codes only (the probe masks ids and never returns content).
set -euo pipefail
ENV_NAME="${1:?environment: staging or production}"
MAILBOX="${2:?a test mailbox address (staging: one of the two test mailboxes)}"
EXPECT=false; [ "${3:-}" = "--expect-body" ] && EXPECT=true
case "$ENV_NAME" in staging|production) ;; *) echo "unknown environment: $ENV_NAME" >&2; exit 2 ;; esac
export AWS_DEFAULT_REGION=us-west-2 AWS_PAGER=""
NAME="silvicom-mailgw-$ENV_NAME"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
jq -n --arg m "$MAILBOX" --argjson e "$EXPECT" '{mailbox:$m, expectBody:$e}' > "$WORK/in.json"
aws lambda invoke --function-name "$NAME:live" --cli-binary-format raw-in-base64-out \
  --payload "file://$WORK/in.json" "$WORK/out.json" --query FunctionError --output text > "$WORK/fe"
if grep -qv None "$WORK/fe"; then echo "the function itself failed:"; jq -r '.errorType + ": " + (.errorMessage // "")' "$WORK/out.json"; exit 1; fi
echo "=== mail gateway P0 proof — $ENV_NAME — $(date -u +%FT%TZ)"
jq -r '.steps[] | (if .ok then "PASS " else "FAIL " end) + .step + "  " + (del(.step, .ok) | tostring)' "$WORK/out.json"
if jq -e '.ok' "$WORK/out.json" >/dev/null; then echo "=== ALL PASS"; else
  echo "=== NOT YET"
  jq -e '.steps[] | select(.step=="entra_exchange" and (.codes // [] | index(70021)))' "$WORK/out.json" >/dev/null 2>&1 && cat <<'TXT'
Hint: AADSTS70021 = no federated credential matched. Compare aws_token.iss and aws_token.sub above with
what Simo typed, character for character (V7: Entra does not say which one is wrong). A credential
saved in the last ~10 minutes may simply not be live yet — wait and run again.
TXT
fi
