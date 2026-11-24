#!/bin/bash
# AWS for the broker-mail gateway (docs/plans/dispatch-loads/BROKER-MAIL-READER-PLAN.md §6, D-BMR15).
# OWNER-RUN with `!` — it creates IAM roles, a Lambda and parameters, which the auto-mode classifier
# refuses Claude. Claude wrote it; `--check` changes nothing and is safe to run any time.
#
#   AWS_PROFILE=silvicom bash infra/mail-gateway/setup.sh <staging|production> --check   read-only report
#   AWS_PROFILE=silvicom bash infra/mail-gateway/setup.sh <staging|production>           create / repair
#        … --probe-code   (P0 only) put the probe in the function again after editing probe/index.mjs
#        … --live         (P1, after PR-c's first deploy) the one-minute schedule + "no run" alarm
#        … --stop         the kill switch: schedule DISABLED; nothing else is touched
#
# Inputs (environment, optional; written to Parameter Store when set, reported when missing):
#   MAILGW_TENANT_ID  MAILGW_CLIENT_ID  MAILGW_CANARY_MAILBOX   — from Simo's answers (P0 list).
# None of them is a secret, but none belongs in this public repo either, so they are typed at run time.
# Badge 2 has NO Microsoft secret: nothing like a client secret or certificate is ever written here.
#
# Idempotent: every step looks first and says what it found. Re-running repairs drift (a policy edited
# by hand is put back) but never replaces the function's CODE — after P1 that belongs to the deploy
# jobs (image.yml for staging, aws-production.yml for production), so production runs only released
# bytes (D-BMR15). `--probe-code` is the one exception, for P0, and refuses once `--live` has run.
set -euo pipefail

ENV_NAME="${1:?environment: staging or production}"
shift
case "$ENV_NAME" in staging|production) ;; *) echo "unknown environment: $ENV_NAME" >&2; exit 2 ;; esac
CHECK=false PROBE_CODE=false LIVE=false STOP=false
for a in "$@"; do case "$a" in
  --check) CHECK=true ;; --probe-code) PROBE_CODE=true ;; --live) LIVE=true ;; --stop) STOP=true ;;
  *) echo "unknown option: $a" >&2; exit 2 ;; esac; done

ACCOUNT=891568748437
REGION=us-west-2
export AWS_DEFAULT_REGION="$REGION" AWS_PAGER=""
NAME="silvicom-mailgw-$ENV_NAME"                 # function, its role, its log group's suffix
FN_ARN="arn:aws:lambda:$REGION:$ACCOUNT:function:$NAME"
ROLE_ARN="arn:aws:iam::$ACCOUNT:role/$NAME"
SCHED_ROLE="silvicom-mailgw-scheduler-$ENV_NAME"
PARAMS="/silvicom-mailgw/$ENV_NAME"
LOGS="/aws/lambda/$NAME"
BUCKET="silvicom360-mailgw-artifacts-$ACCOUNT"  # one bucket; zips are per commit, shared by both envs
TOPIC=silvicom-alarms                             # made by infra/aws-account-hardening.sh
AUDIENCE="api://AzureADTokenExchange"             # Entra's fixed audience for a federated credential
# Who may move this environment's code (§6): staging = every merge's role, production = the release
# role behind the approved `aws-production` GitHub environment. The two server roles must NOT (D-BMR15).
if [ "$ENV_NAME" = production ]; then DEPLOY_ROLE=silvicom-github-release; else DEPLOY_ROLE=silvicom-github-deploy; fi
SERVER_ROLES=(silvicom-production-server silvicom-staging-server)
HERE=$(cd "$(dirname "$0")" && pwd)

say() { echo "• $*"; }
warn() { echo "⚠ $*"; }
todo() { if $CHECK; then echo "✘ would: $*"; else echo "→ $*"; fi; }
run() { $CHECK || "$@"; }   # a write: skipped under --check
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
jsonfile() { local f; f="$WORK/$1"; cat > "$f"; echo "file://$f"; }

who=$(aws sts get-caller-identity --query Account --output text)
[ "$who" = "$ACCOUNT" ] || { echo "signed in to account $who, not $ACCOUNT — stop" >&2; exit 2; }
$CHECK && say "CHECK MODE — nothing will be changed"

if $STOP; then
  aws scheduler update-schedule --name "$NAME" --schedule-expression 'rate(1 minute)' --state DISABLED \
    --flexible-time-window Mode=OFF --target "$(aws scheduler get-schedule --name "$NAME" --query Target --output json)" >/dev/null
  say "schedule $NAME DISABLED — the gateway runs no more cycles. Re-enable with --live."; exit 0
fi

# ---- 1. Outbound identity federation (account-wide switch, V7) ------------------------------------
# Turning it on lets a principal that ALSO holds sts:GetWebIdentityToken get a signed token naming
# itself. Entra trusts only a token whose subject is exactly this role's ARN (the federated credential
# Simo adds), so another principal's token opens nothing in Microsoft 365.
fed=$(aws iam get-outbound-web-identity-federation-info --output json 2>/dev/null || echo '{}')
if [ "$(jq -r '.JwtVendingEnabled // false' <<<"$fed")" = true ]; then say "outbound federation is on"; else
  todo "enable outbound identity federation for the account"
  $CHECK || fed=$(aws iam enable-outbound-web-identity-federation --output json)
fi
ISSUER=$(jq -r '.IssuerIdentifier // empty' <<<"$fed")

# ---- 2. Artifact bucket (§6: written once per commit, never overwritten) -------------------------
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then say "bucket $BUCKET exists"; else
  todo "create bucket $BUCKET"
  run aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
fi
if ! $CHECK || aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  run aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  run aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  # "Production runs the bytes staging ran" (§6) is enforced here, not trusted to the workflows: a
  # PutObject without `If-None-Match: *` is refused, so a zip, once written, cannot be replaced —
  # not by a hotfix build, not by a re-run. The deploy jobs (PR-c) upload with --if-none-match '*'.
  run aws s3api put-bucket-policy --bucket "$BUCKET" --policy "$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"WriteOnce","Effect":"Deny","Principal":"*","Action":"s3:PutObject","Resource":"arn:aws:s3:::$BUCKET/*",
  "Condition":{"Null":{"s3:if-none-match":"true"}}},
 {"Sid":"DenyInsecureTransport","Effect":"Deny","Principal":"*","Action":"s3:*",
  "Resource":["arn:aws:s3:::$BUCKET","arn:aws:s3:::$BUCKET/*"],"Condition":{"Bool":{"aws:SecureTransport":"false"}}}
]}
JSON
)"
  $CHECK && say "bucket policy: $(aws s3api get-bucket-policy --bucket "$BUCKET" --query Policy --output text 2>/dev/null | jq -c '[.Statement[].Sid]' || echo none)" \
         || say "bucket $BUCKET: private, SSE-S3, write-once, TLS only"
fi

# ---- 3. Log group (30 days) + the canary metric -------------------------------------------------
if aws logs describe-log-groups --log-group-name-prefix "$LOGS" --query "logGroups[?logGroupName=='$LOGS'].logGroupName" --output text | grep -qx "$LOGS"; then
  say "log group $LOGS exists (retention: $(aws logs describe-log-groups --log-group-name-prefix "$LOGS" --query "logGroups[?logGroupName=='$LOGS'].retentionInDays|[0]" --output text) days)"
else todo "create log group $LOGS"; run aws logs create-log-group --log-group-name "$LOGS"; fi
run aws logs put-retention-policy --log-group-name "$LOGS" --retention-in-days 30
# The gateway (and the P0 probe) prints the bare word CANARY_OPENED when the canary mailbox opens
# (D-BMR14); the alarm in step 7 watches this metric. A pattern, not a parser: nothing else is logged.
if ! $CHECK || aws logs describe-log-groups --log-group-name-prefix "$LOGS" --query 'logGroups[0]' --output text | grep -qv None; then
  run aws logs put-metric-filter --log-group-name "$LOGS" --filter-name canary-opened --filter-pattern '"CANARY_OPENED"' \
    --metric-transformations "metricName=CanaryOpened-$ENV_NAME,metricNamespace=Silvicom/MailGateway,metricValue=1,defaultValue=0"
fi

# ---- 4. The function's role: logs, its own parameters, one kind of token. Nothing else (§6) ------
trust=$(cat <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},
 "Action":"sts:AssumeRole","Condition":{"StringEquals":{"aws:SourceAccount":"$ACCOUNT"}}}]}
JSON
)
# The token conditions are the V7 traps made impossible rather than remembered: only Entra's audience,
# only RS256 (Entra rejects ES384), at most five minutes, and only the role's own ARN as subject.
policy=$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"Logs","Effect":"Allow","Action":["logs:CreateLogStream","logs:PutLogEvents"],
  "Resource":"arn:aws:logs:$REGION:$ACCOUNT:log-group:$LOGS:*"},
 {"Sid":"OwnSettings","Effect":"Allow","Action":["ssm:GetParameter","ssm:GetParameters","ssm:GetParametersByPath"],
  "Resource":["arn:aws:ssm:$REGION:$ACCOUNT:parameter$PARAMS","arn:aws:ssm:$REGION:$ACCOUNT:parameter$PARAMS/*"]},
 {"Sid":"EntraToken","Effect":"Allow","Action":"sts:GetWebIdentityToken","Resource":"*",
  "Condition":{"ForAllValues:StringEquals":{"sts:IdentityTokenAudience":"$AUDIENCE"},
   "Null":{"sts:IdentityTokenAudience":"false"},"NumericLessThanEquals":{"sts:DurationSeconds":"300"},
   "StringEquals":{"sts:SigningAlgorithm":"RS256","sts:SubjectMode":"AWSIdentity"}}}
]}
JSON
)
if aws iam get-role --role-name "$NAME" >/dev/null 2>&1; then say "role $NAME exists"; else
  todo "create role $NAME"
  run aws iam create-role --role-name "$NAME" --assume-role-policy-document "$trust" \
    --description "Broker-mail gateway Lambda ($ENV_NAME): logs, $PARAMS/*, an Entra token. Nothing else." >/dev/null
fi
if $CHECK; then
  cur=$(aws iam get-role-policy --role-name "$NAME" --policy-name mailgw --query PolicyDocument --output json 2>/dev/null || echo null)
  [ "$(jq -S -c . <<<"$cur")" = "$(jq -S -c . <<<"$policy")" ] && say "role policy mailgw: as written" || echo "✘ role policy mailgw differs or is missing"
  others=$(aws iam list-attached-role-policies --role-name "$NAME" --query 'AttachedPolicies[].PolicyName' --output text 2>/dev/null || true)
  [ -z "$others" ] || warn "managed policies attached to $NAME (there must be none): $others"
else
  aws iam update-assume-role-policy --role-name "$NAME" --policy-document "$trust"
  aws iam put-role-policy --role-name "$NAME" --policy-name mailgw --policy-document "$policy"
  say "role $NAME: trust = Lambda in this account; policy = logs, $PARAMS/*, Entra token (RS256, ≤300 s)"
fi

# ---- 5. Parameters (no Microsoft secret exists for badge 2) -------------------------------------
put_param() { # name value — SecureString via a 0600 file, so the value is never an argument
  jq -n --arg n "$PARAMS/$1" --arg v "$2" '{Name:$n,Value:$v,Type:"SecureString",Overwrite:true}' > "$WORK/p.json"
  aws ssm put-parameter --cli-input-json "file://$WORK/p.json" >/dev/null; rm -f "$WORK/p.json"
}
for p in TENANT_ID CLIENT_ID CANARY_MAILBOX; do
  var="MAILGW_$p"
  if [ -n "${!var:-}" ] && ! $CHECK; then put_param "$p" "${!var}"; say "parameter $PARAMS/$p written"
  elif aws ssm describe-parameters --parameter-filters "Key=Name,Values=$PARAMS/$p" --query 'Parameters[0].Name' --output text | grep -qv None; then
    say "parameter $PARAMS/$p exists (value not read)"
  else warn "parameter $PARAMS/$p missing — re-run with $var=… once Simo has answered"; fi
done

# ---- 6. The function ----------------------------------------------------------------------------
build_probe() { # → path of a zip of probe/ with its locked dependencies (npm ci: exact bytes)
  cp "$HERE/probe/index.mjs" "$HERE/probe/package.json" "$HERE/probe/package-lock.json" "$WORK/"
  (cd "$WORK" && npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null && zip -qr probe.zip index.mjs package.json node_modules)
  echo "$WORK/probe.zip"
}
config_args=(--runtime nodejs22.x --handler index.handler --memory-size 512 --timeout 50 --role "$ROLE_ARN"
  --environment "Variables={MAILGW_ENV=$ENV_NAME,MAILGW_PARAM_PATH=$PARAMS}")
if aws lambda get-function --function-name "$NAME" >/dev/null 2>&1; then
  say "function $NAME exists: $(aws lambda get-function-configuration --function-name "$NAME" \
    --query '[Runtime, Architectures[0], MemorySize, Timeout, Role]' --output text)"
  run aws lambda update-function-configuration --function-name "$NAME" "${config_args[@]}" >/dev/null
  if $PROBE_CODE && ! $CHECK; then
    aws scheduler get-schedule --name "$NAME" >/dev/null 2>&1 && { echo "--probe-code refused: the schedule exists, the code belongs to the deploy jobs now" >&2; exit 3; }
    aws lambda wait function-updated-v2 --function-name "$NAME"
    aws lambda update-function-code --function-name "$NAME" --zip-file "fileb://$(build_probe)" >/dev/null
    aws lambda wait function-updated-v2 --function-name "$NAME"
    v=$(aws lambda publish-version --function-name "$NAME" --description "P0 probe" --query Version --output text)
    aws lambda update-alias --function-name "$NAME" --name live --function-version "$v" >/dev/null
    say "probe code put in $NAME, version $v, alias live → $v"
  fi
else
  todo "create function $NAME with the P0 probe (nodejs22.x, arm64, 512 MB, 50 s, no VPC)"
  if ! $CHECK; then
    zip=$(build_probe)
    # A just-created role takes a few seconds to be assumable by Lambda; retry rather than sleep blind.
    for i in 1 2 3 4 5 6; do
      aws lambda create-function --function-name "$NAME" "${config_args[@]}" --architectures arm64 \
        --zip-file "fileb://$zip" --description "Silvicom 360 broker-mail gateway ($ENV_NAME)" >/dev/null 2>"$WORK/err" && break
      grep -q "cannot be assumed" "$WORK/err" && [ "$i" -lt 6 ] && { sleep 5; continue; }
      cat "$WORK/err" >&2; exit 4
    done
    aws lambda wait function-active-v2 --function-name "$NAME"
    v=$(aws lambda publish-version --function-name "$NAME" --description "P0 probe" --query Version --output text)
    aws lambda create-alias --function-name "$NAME" --name live --function-version "$v" >/dev/null
    say "function $NAME created, version $v, alias live → $v"
  fi
fi
# One run at a time (§6). An account still at the default concurrency quota cannot reserve any (AWS
# keeps 100 unreserved); the database lease (mailgw_begin_cycle) refuses an overlap either way.
if ! $CHECK && aws lambda get-function --function-name "$NAME" >/dev/null 2>&1; then
  aws lambda put-function-concurrency --function-name "$NAME" --reserved-concurrent-executions 1 >/dev/null 2>&1 \
    && say "reserved concurrency 1" \
    || warn "reserved concurrency refused (account quota $(aws lambda get-account-settings --query AccountLimit.ConcurrentExecutions --output text)) — the database lease is the only overlap guard; a quota raise is free (Service Quotas → Lambda → Concurrent executions)"
fi

# ---- 7. Deploy rights: exactly one role may move this function's code ---------------------------
deploy=$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"MoveCode","Effect":"Allow","Action":["lambda:UpdateFunctionCode","lambda:PublishVersion","lambda:UpdateAlias",
   "lambda:GetAlias","lambda:GetFunction","lambda:GetFunctionConfiguration"],"Resource":["$FN_ARN","$FN_ARN:*"]},
 {"Sid":"Artifacts","Effect":"Allow","Action":["s3:GetObject","s3:PutObject"],"Resource":"arn:aws:s3:::$BUCKET/mail-gateway/*"},
 {"Sid":"ArtifactsList","Effect":"Allow","Action":"s3:ListBucket","Resource":"arn:aws:s3:::$BUCKET",
  "Condition":{"StringLike":{"s3:prefix":"mail-gateway/*"}}}
]}
JSON
)
if aws iam get-role --role-name "$DEPLOY_ROLE" >/dev/null 2>&1; then
  if $CHECK; then
    aws iam get-role-policy --role-name "$DEPLOY_ROLE" --policy-name "$NAME-deploy" >/dev/null 2>&1 \
      && say "$DEPLOY_ROLE has policy $NAME-deploy" || echo "✘ $DEPLOY_ROLE lacks policy $NAME-deploy"
  else aws iam put-role-policy --role-name "$DEPLOY_ROLE" --policy-name "$NAME-deploy" --policy-document "$deploy"
    say "$DEPLOY_ROLE may move $NAME's code and read/write mail-gateway/ zips (write-once)"; fi
else warn "deploy role $DEPLOY_ROLE not found — expected from the AWS migration (AWS7)"; fi

# ---- 8. Alarms → SNS $TOPIC ---------------------------------------------------------------------
topic_arn="arn:aws:sns:$REGION:$ACCOUNT:$TOPIC"
aws sns get-topic-attributes --topic-arn "$topic_arn" >/dev/null 2>&1 || warn "SNS topic $TOPIC not found — run infra/aws-account-hardening.sh first"
alarm() { run aws cloudwatch put-metric-alarm --alarm-actions "$topic_arn" --ok-actions "$topic_arn" "$@"; }
alarm --alarm-name "$NAME-errors" --alarm-description "Mail gateway ($ENV_NAME): 3+ failed runs in 15 minutes" \
  --namespace AWS/Lambda --metric-name Errors --dimensions Name=FunctionName,Value="$NAME" \
  --statistic Sum --period 900 --evaluation-periods 1 --threshold 3 --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching
alarm --alarm-name "$NAME-canary-opened" --alarm-description "Mail gateway ($ENV_NAME): the CANARY mailbox opened — the scope is wrong; the gateway has switched itself off (D-BMR14). Tell Simo." \
  --namespace Silvicom/MailGateway --metric-name "CanaryOpened-$ENV_NAME" \
  --statistic Sum --period 300 --evaluation-periods 1 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching
$CHECK && say "alarms: $(aws cloudwatch describe-alarms --alarm-name-prefix "$NAME" --query 'MetricAlarms[].[AlarmName,StateValue]' --output text | tr '\n\t' '; ')" || say "alarms $NAME-errors, $NAME-canary-opened → $TOPIC"

# ---- 9. --live: the one-minute schedule (P1, after the real gateway is deployed) ----------------
if $LIVE && ! $CHECK; then
  aws iam get-role --role-name "$SCHED_ROLE" >/dev/null 2>&1 || aws iam create-role --role-name "$SCHED_ROLE" \
    --assume-role-policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"scheduler.amazonaws.com\"},\"Action\":\"sts:AssumeRole\",\"Condition\":{\"StringEquals\":{\"aws:SourceAccount\":\"$ACCOUNT\"}}}]}" >/dev/null
  aws iam put-role-policy --role-name "$SCHED_ROLE" --policy-name invoke --policy-document \
    "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"lambda:InvokeFunction\",\"Resource\":\"$FN_ARN:live\"}]}"
  target="{\"Arn\":\"$FN_ARN:live\",\"RoleArn\":\"arn:aws:iam::$ACCOUNT:role/$SCHED_ROLE\",\"Input\":\"{}\",\"RetryPolicy\":{\"MaximumRetryAttempts\":0}}"
  verb=create; aws scheduler get-schedule --name "$NAME" >/dev/null 2>&1 && verb=update
  # No retries: the next minute is the retry. ENABLED is set explicitly so --live also undoes --stop.
  aws scheduler "$verb-schedule" --name "$NAME" --schedule-expression 'rate(1 minute)' --state ENABLED \
    --flexible-time-window Mode=OFF --target "$target" >/dev/null
  alarm --alarm-name "$NAME-not-running" --alarm-description "Mail gateway ($ENV_NAME): no run for 10 minutes" \
    --namespace AWS/Lambda --metric-name Invocations --dimensions Name=FunctionName,Value="$NAME" \
    --statistic Sum --period 600 --evaluation-periods 1 --threshold 1 --comparison-operator LessThanThreshold --treat-missing-data breaching
  say "schedule $NAME: every minute → $NAME:live; alarm $NAME-not-running"
else
  s=$(aws scheduler get-schedule --name "$NAME" --query State --output text 2>/dev/null || echo "none (P0: expected until --live)")
  say "schedule: $s"
fi

# ---- 10. D-BMR15: the app servers can neither move the gateway nor read its settings ------------
# Simulated, not assumed. `allowed` on any line is a finding: whoever controls the app server would
# then control what reads the dispatchers' mail.
for r in "${SERVER_ROLES[@]}"; do
  aws iam get-role --role-name "$r" >/dev/null 2>&1 || { warn "role $r not found"; continue; }
  out=$(aws iam simulate-principal-policy --policy-source-arn "arn:aws:iam::$ACCOUNT:role/$r" \
    --action-names lambda:UpdateFunctionCode lambda:UpdateFunctionConfiguration lambda:UpdateAlias iam:PassRole ssm:GetParameter ssm:GetParametersByPath \
    --resource-arns "$FN_ARN" "$ROLE_ARN" "arn:aws:ssm:$REGION:$ACCOUNT:parameter$PARAMS/DATABASE_URL" \
    --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text | sort -u)
  if grep -q allowed <<<"$out"; then echo "✘ D-BMR15 FAILS for $r:"; grep allowed <<<"$out"; else say "D-BMR15: $r is denied every gateway action"; fi
done
if [ "$ENV_NAME" = production ]; then
  out=$(aws iam simulate-principal-policy --policy-source-arn "arn:aws:iam::$ACCOUNT:role/silvicom-github-deploy" \
    --action-names lambda:UpdateFunctionCode lambda:UpdateAlias --resource-arns "$FN_ARN" --query 'EvaluationResults[].EvalDecision' --output text)
  grep -q allowed <<<"$out" && echo "✘ D-BMR15 FAILS: the staging deploy role can move the PRODUCTION gateway" || say "D-BMR15: the staging deploy role cannot move the production gateway"
fi

# ---- 11. What Simo needs (P0 list, item 3) ------------------------------------------------------
cat <<TXT

Federated credential for the $ENV_NAME badge (Entra → the app → Certificates & secrets → Federated
credentials → Add → "Other issuer"):
  Issuer:              ${ISSUER:-<not yet — outbound federation is off; run without --check>}
  Subject identifier:  $ROLE_ARN
  Audience:            $AUDIENCE
After Simo saves it, allow ~10 minutes, then: bash infra/mail-gateway/prove.sh $ENV_NAME <test mailbox>
TXT
