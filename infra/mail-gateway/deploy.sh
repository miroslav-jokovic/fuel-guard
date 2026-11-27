#!/bin/bash
# Put one commit's mail gateway on one environment's Lambda (BROKER-MAIL-READER-PLAN §6). Run by
# image.yml (staging, every merge) and aws-production.yml (production, the released commit) — never
# by hand, though it is safe to: it only moves code, and only to a commit's own stored zip.
#
#   bash infra/mail-gateway/deploy.sh <staging|production> <commit> check    → prints needed=true|false
#   bash infra/mail-gateway/deploy.sh <staging|production> <commit> [zip]
#
# `check` (run before anything is built): a new version is needed only when the gateway's inputs —
# apps/mail-gateway, packages/shared, pnpm-lock.yaml — differ between the deployed commit (the live
# version's description) and this one. Otherwise every merge to main would publish a version and store
# a zip for code that did not change. Needs a full-history checkout; an unknown deployed commit (the P0
# probe, or history the runner lacks) counts as "needed".
#
# 1. The zip is `s3://<bucket>/mail-gateway/<commit>.zip`, written once. If it is not there and a
#    [zip] was built, it is stored with `If-None-Match: *` — the bucket refuses any other write
#    (setup.sh), so two runs racing for one commit end with one object, and nothing can replace it.
#    Production normally finds the object staging stored, and so runs exactly those bytes; a hotfix
#    commit staging never built is built by the production job and stored the same way.
# 2. `update-function-code` from that object, `--publish`, then the `live` alias moves to the new
#    version — the schedule invokes `live`, so a cycle runs the old code or the new, never a mix.
# 3. The version's description is the commit, which is how the next run (and a person) knows what
#    is deployed. The heartbeat row carries the same commit (§6 Verify).
set -euo pipefail

ENV_NAME="${1:?environment: staging or production}"
COMMIT="${2:?commit sha}"
ZIP="${3:-}"
INPUTS=(apps/mail-gateway packages/shared pnpm-lock.yaml)
case "$ENV_NAME" in staging|production) ;; *) echo "unknown environment: $ENV_NAME" >&2; exit 2 ;; esac
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "commit must be a full 40-character sha" >&2; exit 2; }
export AWS_DEFAULT_REGION=us-west-2 AWS_PAGER=""
ACCOUNT=891568748437
NAME="silvicom-mailgw-$ENV_NAME"
BUCKET="silvicom360-mailgw-artifacts-$ACCOUNT"
KEY="mail-gateway/$COMMIT.zip"
summary() { echo "$*"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$*" >> "$GITHUB_STEP_SUMMARY"; return 0; }
deployed_commit() {
  local v
  v=$(aws lambda get-alias --function-name "$NAME" --name live --query FunctionVersion --output text)
  aws lambda get-function-configuration --function-name "$NAME" --qualifier "$v" --query Description --output text 2>/dev/null || true
}

if [ "$ZIP" = check ]; then
  was=$(deployed_commit)
  needed=true
  if [[ "$was" =~ ^[0-9a-f]{40}$ ]] && git cat-file -e "$was^{commit}" 2>/dev/null && git diff --quiet "$was" "$COMMIT" -- "${INPUTS[@]}"; then
    needed=false
    summary "$NAME runs ${was::7}; nothing the gateway is built from changed up to ${COMMIT::7} — no new version"
  fi
  echo "needed=$needed"
  [ -n "${GITHUB_OUTPUT:-}" ] && echo "needed=$needed" >> "$GITHUB_OUTPUT"
  exit 0
fi

if aws s3api head-object --bucket "$BUCKET" --key "$KEY" >/dev/null 2>&1; then
  summary "zip for ${COMMIT::7} already stored — deploying those bytes"
else
  [ -n "$ZIP" ] && [ -f "$ZIP" ] || { echo "no stored zip for ${COMMIT::7} and none built — cannot deploy" >&2; exit 3; }
  if aws s3api put-object --bucket "$BUCKET" --key "$KEY" --body "$ZIP" --if-none-match '*' >/dev/null 2>&1; then
    summary "stored zip for ${COMMIT::7} (write-once)"
  else
    # 412: another run stored it a moment ago. Anything else is a real failure.
    aws s3api head-object --bucket "$BUCKET" --key "$KEY" >/dev/null 2>&1 || { echo "could not store the zip" >&2; exit 4; }
    summary "zip for ${COMMIT::7} was stored by a parallel run — deploying those bytes"
  fi
fi

current=$(aws lambda get-alias --function-name "$NAME" --name live --query FunctionVersion --output text)
current_commit=$(deployed_commit)
if [ "$current_commit" = "$COMMIT" ]; then summary "$NAME already runs ${COMMIT::7} (version $current) — nothing to do"; exit 0; fi

aws lambda update-function-code --function-name "$NAME" --s3-bucket "$BUCKET" --s3-key "$KEY" >/dev/null
aws lambda wait function-updated-v2 --function-name "$NAME"
version=$(aws lambda publish-version --function-name "$NAME" --description "$COMMIT" --query Version --output text)
aws lambda update-alias --function-name "$NAME" --name live --function-version "$version" >/dev/null
summary "$NAME: live → version $version (${COMMIT::7}); was version $current (${current_commit:0:7})"
