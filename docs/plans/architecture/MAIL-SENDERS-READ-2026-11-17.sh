#!/bin/bash
# READ-ONLY. Prints which address every Silvicom 360 mail path sends from today, and what Brevo
# accepts as a sender — addresses only; no key is ever printed. OWNER-RUN: Claude is refused
# decrypting Parameter Store values (correctly — the same paths hold API keys).
#   bash docs/plans/architecture/MAIL-SENDERS-READ-2026-11-17.sh
set -euo pipefail
export AWS_PROFILE=silvicom AWS_REGION=us-west-2
get() { aws ssm get-parameter --name "$1" --with-decryption --query Parameter.Value --output text 2>/dev/null || echo "(unset)"; }

for e in production staging; do
  echo "== $e api"
  echo "  MAIL_PROVIDER      $(get /silvicom/$e/api/MAIL_PROVIDER)"
  echo "  MAIL_FROM          $(get /silvicom/$e/api/MAIL_FROM)"
  echo "  OUTBOUND_ALLOWLIST $(get /silvicom/$e/api/OUTBOUND_ALLOWLIST | sed -E 's/[^,@]+@/…@/g')"
done

echo "== Brevo (production key) — senders and domain"
key=$(get /silvicom/production/api/BREVO_API_KEY)
curl -fsS -H "api-key: $key" -H 'accept: application/json' https://api.brevo.com/v3/senders \
  | jq -r '.senders[] | "  sender  \(.email)  name=\(.name)  active=\(.active)"'
curl -fsS -H "api-key: $key" -H 'accept: application/json' https://api.brevo.com/v3/senders/domains/silvicominc.com \
  | jq -r '"  domain  silvicominc.com authenticated=\(.authenticated) verified=\(.verified)"'
echo "== Brevo — last 7 days, events for the two new mailboxes (does Proofpoint accept them?)"
for a in no-reply@silvicominc.com 360@silvicominc.com; do
  curl -fsS -H "api-key: $key" -H 'accept: application/json' "https://api.brevo.com/v3/smtp/statistics/events?limit=20&days=7&email=$a" \
    | jq -r --arg a "$a" '"  \($a): \(.events // [] | length) events \([.events[]?.event] | unique | join(", "))"'
done
unset key
echo "== GitHub secret MAIL_FROM (release notices, platform-health): value not readable; last set:"
gh secret list | grep -E '^MAIL_FROM' || echo "  (absent)"
