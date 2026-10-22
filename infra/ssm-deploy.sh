#!/bin/bash
# Deploy one commit's images onto the AWS server of one environment, from CI, through SSM Run Command
# (AWS-MIGRATION-PLAN.md D-AWS10, AWS7) — no SSH, no key. image.yml's `deploy-staging` and
# aws-production.yml both call it, so the two environments are deployed by the same steps.
#
#   ssm-deploy.sh <staging|production> <image-tag>
#
# Runs with the caller's AWS credentials (OIDC). Which server a role may reach is IAM's decision, not
# this script's: silvicom-github-deploy may send commands only to Environment=staging, and
# silvicom-github-release only to Environment=production (both proven by simulate-principal-policy,
# 2026-10-22). The script finds the one running server tagged for the environment and refuses
# anything other than exactly one.
#
# The command is deploy.sh's documented bootstrap: the script and stack files come out of the image
# being deployed, so the commit decides everything and a rollback is deploying an older tag. deploy.sh
# runs `docker compose up --wait`, so a commit whose containers do not become healthy fails this
# script — and the server keeps whatever was healthy before for every container compose did not have
# to replace.
set -euo pipefail

ENV_NAME="${1:?environment: staging or production}"
TAG="${2:?image tag}"
case "$ENV_NAME" in staging|production) ;; *) echo "unknown environment: $ENV_NAME" >&2; exit 2 ;; esac
REGISTRY=891568748437.dkr.ecr.us-west-2.amazonaws.com
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

instance=$(aws ec2 describe-instances \
  --filters "Name=tag:Environment,Values=$ENV_NAME" Name=tag:Project,Values=silvicom360 \
            Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].InstanceId' --output text)
read -ra found <<<"$instance"
[ "${#found[@]}" -eq 1 ] || { echo "::error::expected one running $ENV_NAME server, found: '$instance'"; exit 1; }

image="$REGISTRY/silvicom/app:$TAG"
params=$(jq -n --arg r "$REGISTRY" --arg i "$image" --arg t "$TAG" --arg e "$ENV_NAME" '{commands: [
  "set -euo pipefail",
  "aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin \($r) >/dev/null",
  "docker pull -q \($i) >/dev/null",
  "cid=$(docker create \($i))",
  "install -d -m 0755 /opt/silvicom",
  "docker cp $cid:/app/infra/server/deploy.sh /opt/silvicom/deploy.sh",
  "docker rm $cid >/dev/null",
  "bash /opt/silvicom/deploy.sh \($e) \($t) \($t) 2>&1"
], executionTimeout: ["900"]}')
cmd=$(aws ssm send-command --instance-ids "$instance" --document-name AWS-RunShellScript \
  --comment "deploy $TAG (run ${GITHUB_RUN_ID:-manual})" --timeout-seconds 900 \
  --parameters "$params" --query Command.CommandId --output text)
echo "SSM command $cmd on $instance"
while :; do
  status=$(aws ssm get-command-invocation --command-id "$cmd" --instance-id "$instance" --query Status --output text 2>/dev/null || echo Pending)
  case "$status" in Pending|InProgress|Delayed) sleep 10 ;; *) break ;; esac
done
aws ssm get-command-invocation --command-id "$cmd" --instance-id "$instance" \
  --query StandardOutputContent --output text | grep -v -i 'password\|credential' | tail -25
echo "AWS $ENV_NAME deploy of \`$TAG\`: $status" >> "$SUMMARY"
[ "$status" = Success ] || { echo "::error::$ENV_NAME deploy $status"; exit 1; }
