#!/bin/bash
# One Supabase key watcher pass on this server (AWS-MIGRATION-PLAN AWS6a), run every 5 minutes by
# silvicom-keywatch.timer. It replaces the interim launchd job on the owner's Mac, which saw nothing
# while the Mac slept.
#
# The script is the deployed release's own copy (scripts/supabase-key-watch.mjs inside APP_IMAGE from
# release.env), so the watcher and the app are always the same commit.
#
# Secrets are fetched from Parameter Store at EVERY run, not only at deploy: a key rotated at Brevo or
# Telnyx (AWS0) reaches the watcher on its next pass with no deploy. fetch-settings.sh writes them to
# the /run/silvicom tmpfs and the container reads them with Node's --env-file, which takes the
# single-quoted values literally, as dotenv does. Its own path, /silvicom/<env>/keywatch/, holds only
# what the app has no copy of: SUPABASE_ACCESS_TOKEN (a Supabase access token for the management
# API's logs) and the fallback recipients RELEASE_NOTIFY_EMAILS / RELEASE_NOTIFY_PHONES. Email and SMS
# credentials are read from the api's own path instead of being copied (fetch-settings.sh), so there
# is one value to rotate, not two.
set -euo pipefail
STACK=/opt/silvicom
STATE=/var/lib/silvicom-keywatch
# shellcheck disable=SC1091
. "$STACK/release.env"

"$STACK/fetch-settings.sh" "$ENV_NAME" keywatch >/dev/null
# The image runs as uid 1000 (`node`); the state (addresses already paged, network lookups) survives
# deploys and reboots here.
install -d -m 0700 -o 1000 -g 1000 "$STATE"

exec docker run --rm --name silvicom-keywatch \
  --log-driver awslogs --log-opt awslogs-region=us-west-2 \
  --log-opt "awslogs-group=/silvicom/$ENV_NAME" --log-opt tag=keywatch \
  --mount type=bind,source=/run/silvicom/keywatch.env,target=/run/settings.env,readonly \
  --mount type=bind,source="$STATE",target=/state \
  --env-file "$STACK/keywatch.env" -e STATE_FILE=/state/state.json \
  "$APP_IMAGE" node --env-file=/run/settings.env scripts/supabase-key-watch.mjs check
