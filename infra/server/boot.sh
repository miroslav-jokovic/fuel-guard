#!/bin/bash
# silvicom-boot.service's body: the last deploy's environment and images (release.env, written by
# deploy.sh) with fresh settings. Never pulls or changes the release — that is deploy.sh's job.
set -euo pipefail
STACK=/opt/silvicom
[ -f "$STACK/release.env" ] || { echo "nothing deployed on this server yet"; exit 0; }
# shellcheck disable=SC1091
. "$STACK/release.env"
"$STACK/fetch-settings.sh" "$ENV_NAME"
cd "$STACK"
docker compose --env-file "$ENV_NAME.env" --env-file release.env up -d --wait --wait-timeout 300
