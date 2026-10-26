#!/bin/bash
# Deploy one commit's images onto this server (AWS-MIGRATION-PLAN.md D-AWS7/D-AWS10, AWS6).
#
#   deploy.sh <staging|production> <app-image-tag> <console-image-tag>
#
# Run as root through SSM Run Command — never over SSH (port 22 is closed). CI calls it with the
# tags it just pushed (image.yml `deploy-staging`); by hand it is the same command through
# `aws ssm send-command`. The script is not installed on the server: the caller extracts it from the
# app image of the commit being deployed (see the bootstrap below), so the stack definition, this
# script and the code are always the same commit, and rolling back is deploying an older tag.
#
# Secrets: fetch-settings.sh reads each service's settings from Parameter Store
# /silvicom/<env>/<service>/ with the server's own role (it can read only its environment's path)
# into the /run/silvicom tmpfs, and compose.yml bind-mounts each file read-only into its container,
# where dotenv loads it (Q-AWS14 (b)). Docker stores only the path, so the values are never in the
# image, never in GitHub and never on this server's disk. silvicom-boot.service repeats the fetch
# after a reboot, when the tmpfs is empty.
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
chmod 0755 "$STACK"/*.sh

# The host's own hardening (automatic security updates, no sshd, volume ownership for the
# unprivileged containers) — idempotent, so every deploy asserts it (host.sh says why each step).
"$STACK/host.sh"

"$STACK/fetch-settings.sh" "$ENV_NAME"
# compose.yml labels each app container with this, so changed settings recreate it (fetch-settings.sh).
SETTINGS_HASH=$(cat /run/silvicom/settings.hash)
export SETTINGS_HASH

# The worker runs only where this server holds the schedulers (compose.yml says why it cannot be
# told by RUN_SCHEDULERS_IN_PROCESS). Derived from the one switch, so the two cannot disagree.
run_schedulers=$(sed -n 's/^RUN_SCHEDULERS=//p' "$STACK/$ENV_NAME.env")
case "$run_schedulers" in true) worker_replicas=1 ;; false) worker_replicas=0 ;;
  *) echo "RUN_SCHEDULERS in $ENV_NAME.env must be true or false, is '$run_schedulers'" >&2; exit 2 ;; esac

# What silvicom-boot.service brings back after a reboot: this release, nothing newer or older.
# CADDYFILE_HASH labels the caddy container (compose.yml): the Caddyfile is a bind-mounted file, which
# Caddy reads once at start, so a release that changes it must recreate the container to be heard.
cat > "$STACK/release.env" <<EOF
ENV_NAME=$ENV_NAME
APP_IMAGE=$APP_IMAGE
CONSOLE_IMAGE=$CONSOLE_IMAGE
WORKER_REPLICAS=$worker_replicas
CADDYFILE_HASH=$(sha256sum "$STACK/Caddyfile" | cut -c1-16)
EOF
install -m 0644 "$STACK/silvicom-boot.service" /etc/systemd/system/silvicom-boot.service
systemctl daemon-reload
systemctl enable silvicom-boot.service >/dev/null 2>&1

# The Supabase key watcher (AWS6a) runs on one server only — two would page twice for every stranger.
# <env>.env says which; a server that no longer should runs it no more.
if grep -qx 'KEYWATCH=true' "$STACK/$ENV_NAME.env"; then
  install -m 0644 "$STACK/silvicom-keywatch.service" "$STACK/silvicom-keywatch.timer" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now silvicom-keywatch.timer >/dev/null 2>&1
else
  systemctl disable --now silvicom-keywatch.timer >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/silvicom-keywatch.service /etc/systemd/system/silvicom-keywatch.timer
  systemctl daemon-reload
fi

cd "$STACK"
# --wait returns only when every container reports healthy, so a bad commit fails this command
# (and the CI job that ran it) instead of being discovered by a person.
#   When it fails, Caddy's own last lines go into the SSM output, which is where the CI job shows
# them: on 2026-10-26 the reason Caddy would not start sat on the production host, which no one in
# the release could read. Caddy's only, never the app's — this output lands in a public Actions log,
# and Caddy logs host names and errors, nothing a request carried.
if ! docker compose --env-file "$ENV_NAME.env" --env-file release.env up -d --remove-orphans --wait --wait-timeout 300; then
  docker compose --env-file "$ENV_NAME.env" --env-file release.env ps -a --format '{{.Service}} {{.State}} {{.Health}}' >&2
  docker compose --env-file "$ENV_NAME.env" --env-file release.env logs --no-color --tail 30 caddy >&2 || true
  exit 1
fi
docker compose --env-file "$ENV_NAME.env" --env-file release.env ps --format '{{.Service}} {{.State}} {{.Health}}'
# Every image the new containers do not use (ssm-deploy.sh says why `-a`): the release before this one
# is in ECR, not on this disk.
docker image prune -af >/dev/null
echo "deployed $APP_TAG to $ENV_NAME"
