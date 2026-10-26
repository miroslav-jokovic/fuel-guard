#!/bin/bash
# Runs one supabase-key-watch.mjs pass on a Mac, from launchd every 5 minutes (AWS-MIGRATION-PLAN §5).
# This is the INTERIM home: the watcher moves to the AWS production server once it exists, where the
# same script runs from a systemd timer with a read-only analytics token from Parameter Store.
#
# Secrets come from the macOS Keychain, never a file:
#   - the Supabase CLI's own login token (service "Supabase CLI"), for the logs and the recipient list;
#   - service "silvicom-keywatch", one item per variable: BREVO_API_KEY, MAIL_FROM, TELNYX_API_KEY,
#     TELNYX_FROM, RELEASE_NOTIFY_EMAILS, RELEASE_NOTIFY_PHONES (the last two are the fallback when
#     the console's Alert recipients list is empty — release-notify.mjs's rule).
# Configuration (project refs, office addresses) lives in config.env beside this script.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
kc() { security find-generic-password -s "$1" -a "$2" -w 2>/dev/null; }
tok=$(security find-generic-password -s "Supabase CLI" -w 2>/dev/null)
case "$tok" in go-keyring-base64:*) tok=$(printf %s "${tok#go-keyring-base64:}" | base64 -d) ;; esac
export SUPABASE_ACCESS_TOKEN="$tok"
for v in BREVO_API_KEY MAIL_FROM TELNYX_API_KEY TELNYX_FROM RELEASE_NOTIFY_EMAILS RELEASE_NOTIFY_PHONES; do
  export "$v=$(kc silvicom-keywatch "$v")"
done
# shellcheck disable=SC1091
set -a; . "$DIR/config.env"; set +a
export STATE_FILE="$DIR/state.json" KEYWATCH_DESKTOP=1
exec /opt/homebrew/bin/node "$DIR/supabase-key-watch.mjs" "${1:-check}"
