#!/bin/bash
# Deploy one commit's images onto this server (AWS-MIGRATION-PLAN.md D-AWS7/D-AWS10, AWS6).
#
#   deploy.sh <staging|production> <app-image-tag> <console-image-tag>
#
# Run as root through SSM Run Command — never over SSH (port 22 is closed). CI calls it with the
# tags it just pushed (AWS7); by hand it is the same command through `aws ssm send-command`.
# The script is not installed on the server: the caller extracts it from the app image of the commit
# being deployed (see the bootstrap at the end of this header), so the stack definition, this script
# and the code are always the same commit, and rolling back is deploying an older tag.
#
# Secrets: each service's settings are read from Parameter Store /silvicom/<env>/<service>/ with the
# server's own role (it can read only its environment's path) into /run/silvicom, a tmpfs, mode 0600.
# ⚠ D-AWS7 asks for "never onto the disk"; Docker itself stores a container's environment in its
# config under /var/lib/docker on the (encrypted) root volume. Q-AWS14 records that gap and the
# options; until it is answered the honest claim is "never in the image, never in GitHub, at rest
# only on this server's encrypted disk".
#
# Bootstrap, as the SSM command runs it:
#   aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin <registry>
#   docker pull <registry>/silvicom/app:<tag>
#   cid=$(docker create <registry>/silvicom/app:<tag>)
#   docker cp "$cid":/app/infra/server/deploy.sh /opt/silvicom/deploy.sh; docker rm "$cid"
#   bash /opt/silvicom/deploy.sh <env> <tag> <console-tag>
set -euo pipefail

ENV_NAME="${1:?environment: staging or production}"
APP_TAG="${2:?app image tag}"
CONSOLE_TAG="${3:?console image tag}"
case "$ENV_NAME" in staging|production) ;; *) echo "unknown environment: $ENV_NAME" >&2; exit 2 ;; esac

REGION=us-west-2
REGISTRY=891568748437.dkr.ecr.us-west-2.amazonaws.com
APP_IMAGE="$REGISTRY/silvicom/app:$APP_TAG"
CONSOLE_IMAGE="$REGISTRY/silvicom/console:$CONSOLE_TAG"
STACK=/opt/silvicom
SECRETS=/run/silvicom

# Fail before touching the running stack: the server must be the one this environment's role allows.
mountpoint -q "$SECRETS" || { echo "$SECRETS is not a tmpfs mount — refusing to write secrets" >&2; exit 3; }

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
docker pull -q "$APP_IMAGE" >/dev/null
docker pull -q "$CONSOLE_IMAGE" >/dev/null

# The stack files come out of the image being deployed.
cid=$(docker create "$APP_IMAGE")
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
install -d -m 0755 "$STACK"
docker cp "$cid":/app/infra/server/. "$STACK"/
docker rm -f "$cid" >/dev/null
trap - EXIT

# One env file per service, from its own Parameter Store path. A service with no parameters is an
# error, not an empty file: a container started without its settings fails in confusing ways.
umask 077
for svc in api web console; do
  tmp="$SECRETS/.$svc.env.new"
  aws ssm get-parameters-by-path --region "$REGION" --path "/silvicom/$ENV_NAME/$svc" \
    --with-decryption --recursive --query 'Parameters[].[Name,Value]' --output text \
    | awk -F'\t' '{ n = $1; sub(/.*\//, "", n); print n "=" $2 }' > "$tmp"
  [ -s "$tmp" ] || { echo "no parameters under /silvicom/$ENV_NAME/$svc" >&2; rm -f "$tmp"; exit 4; }
  mv "$tmp" "$SECRETS/$svc.env"
  echo "$svc: $(wc -l < "$SECRETS/$svc.env") settings"
done

cd "$STACK"
export APP_IMAGE CONSOLE_IMAGE
# --wait returns only when every container reports healthy, so a bad commit fails this command
# (and the CI job that ran it) instead of being discovered by a person.
docker compose --env-file "$ENV_NAME.env" up -d --remove-orphans --wait --wait-timeout 300
docker compose --env-file "$ENV_NAME.env" ps --format '{{.Service}} {{.State}} {{.Health}}'
docker image prune -f >/dev/null
echo "deployed $APP_TAG to $ENV_NAME"
