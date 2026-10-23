#!/bin/bash
# Write each service's settings from Parameter Store into /run/silvicom (a tmpfs) — Q-AWS14 (b).
#
#   fetch-settings.sh <staging|production> [service ...]     (default: api web console)
#
# Called by deploy.sh on every deploy and by silvicom-boot.service after every reboot (a tmpfs is
# empty after one), and by keywatch.sh for `keywatch` at every pass. Each file is bind-mounted read-only into its container at /run/settings.env and
# read by the `import "dotenv/config"` every entry point already starts with, pointed there by
# DOTENV_CONFIG_PATH (compose.yml). Docker therefore stores only the path in its container config on
# disk — the values exist in this tmpfs and in the process, nowhere else on the server.
#
# Values are single-quoted, which dotenv reads literally (no comment, `$` or escape handling), so a
# value means the same here as it does on Railway. The only values that cannot be written that way
# are refused rather than mangled. Files belong to uid 1000 — the image's `node` user — mode 0400.
set -euo pipefail

ENV_NAME="${1:?environment: staging or production}"
case "$ENV_NAME" in staging|production) ;; *) echo "unknown environment: $ENV_NAME" >&2; exit 2 ;; esac
REGION=us-west-2
SECRETS=/run/silvicom
APP_UID=1000

mountpoint -q "$SECRETS" || { echo "$SECRETS is not a tmpfs mount — refusing to write secrets" >&2; exit 3; }
umask 077
# The key watcher sends its alerts with the app's own mail and SMS credentials. They are read from
# api's path, not copied into keywatch's, so a rotation (AWS0) changes one value, not two.
KEYWATCH_FROM_API=(BREVO_API_KEY MAIL_FROM TELNYX_API_KEY TELNYX_FROM)

params() { # <service> → one JSON array of {Name, Value}
  local svc=$1
  # JSON, not text output: a value is taken whole, whatever characters it holds.
  aws ssm get-parameters-by-path --region "$REGION" --path "/silvicom/$ENV_NAME/$svc" \
    --with-decryption --recursive --query Parameters --output json
  if [ "$svc" = keywatch ]; then
    aws ssm get-parameters --region "$REGION" --with-decryption --query Parameters --output json \
      --names "${KEYWATCH_FROM_API[@]/#//silvicom/$ENV_NAME/api/}"
  fi
}

services=("${@:2}")
[ "${#services[@]}" -gt 0 ] || services=(api web console)
for svc in "${services[@]}"; do
  case "$svc" in api|web|console|keywatch) ;; *) echo "unknown service: $svc" >&2; exit 2 ;; esac
  tmp="$SECRETS/.$svc.env.new"
  params "$svc" | python3 -c '
import json, sys
out = []
# One JSON array per aws call (keywatch makes two), so read every array on stdin.
text, i, found = sys.stdin.read(), 0, []
while text[i:].strip():
    i += len(text[i:]) - len(text[i:].lstrip())
    arr, i = json.JSONDecoder().raw_decode(text, i)
    found += arr
for p in found:
    name, value = p["Name"].rsplit("/", 1)[1], p["Value"]
    if "\x27" in value or "\n" in value or "\r" in value:
        sys.exit(f"{name}: a single quote or line break cannot be written literally for dotenv")
    out.append(f"{name}=\x27{value}\x27")
print("\n".join(sorted(out)))
' > "$tmp"
  [ -s "$tmp" ] || { echo "no parameters under /silvicom/$ENV_NAME/$svc" >&2; rm -f "$tmp"; exit 4; }
  chown "$APP_UID:$APP_UID" "$tmp"
  chmod 0400 "$tmp"
  mv -f "$tmp" "$SECRETS/$svc.env"
  echo "$svc: $(wc -l < "$SECRETS/$svc.env" | tr -d ' ') settings"
done
