#!/bin/bash
# Staging's web address becomes https://staging.360.silvicominc.com (AWS10), the twin of
# production's 360.silvicominc.com. GoDaddy published the A record on 2026-11-17 (SOA 2026111700);
# infra/server/staging.env has named it as WEB_HOST since 10-22, so the Caddyfile needs no change.
#
# OWNER-RUN: Claude is refused Parameter Store writes and SSM commands on the server.
#   bash docs/plans/architecture/STAGING-WEB-HOST-2026-11-17.sh
#
# 1. api + web settings: WEB_APP_URL → staging.360; ALLOWED_ORIGINS gains staging.360, keeps
#    staging-api.360, drops the dead Railway uat hosts (frozen since 10-28). Origins and URLs are
#    printed — they are public host names, not secrets.
# 2. Restarts Caddy on the staging server: it backed off fetching a certificate for a name that
#    did not resolve for weeks; a restart makes it try now (same fix as 2026-10-27).
# 3. Waits for the certificate and prints /api/version from the new name.
# Settings reach the containers at the next staging deploy (Claude dispatches it afterwards).
set -euo pipefail
export AWS_PROFILE=silvicom AWS_REGION=us-west-2
NEW=https://staging.360.silvicominc.com

for svc in api web; do
  p=/silvicom/staging/$svc
  old_url=$(aws ssm get-parameter --name "$p/WEB_APP_URL" --with-decryption --query Parameter.Value --output text)
  old_origins=$(aws ssm get-parameter --name "$p/ALLOWED_ORIGINS" --with-decryption --query Parameter.Value --output text)
  new_origins=$(python3 -I -c '
import sys
old, new = sys.argv[1], sys.argv[2]
keep = [o.strip() for o in old.split(",") if o.strip() and "railway.app" not in o]
if new not in keep:
    keep.insert(0, new)
print(",".join(keep))' "$old_origins" "$NEW")
  echo "== $svc"
  echo "  WEB_APP_URL     $old_url  →  $NEW"
  echo "  ALLOWED_ORIGINS $old_origins  →  $new_origins"
  aws ssm put-parameter --name "$p/WEB_APP_URL" --type SecureString --overwrite --value "$NEW" --query Version --output text
  aws ssm put-parameter --name "$p/ALLOWED_ORIGINS" --type SecureString --overwrite --value "$new_origins" --query Version --output text
done

instance=$(aws ec2 describe-instances \
  --filters Name=tag:Environment,Values=staging Name=tag:Project,Values=silvicom360 Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].InstanceId' --output text)
[ "$(wc -w <<<"$instance")" -eq 1 ] || { echo "expected one running staging server, got: $instance" >&2; exit 1; }
echo "== restarting Caddy on $instance"
cmd=$(aws ssm send-command --instance-ids "$instance" --document-name AWS-RunShellScript \
  --comment "Caddy restart for staging.360 certificate (2026-11-17)" \
  --parameters '{"commands":["docker restart $(docker ps -q --filter label=com.docker.compose.service=caddy)","sleep 30","docker logs --since 2m $(docker ps -q --filter label=com.docker.compose.service=caddy) 2>&1 | grep -F staging.360.silvicominc.com | tail -n 6 | cut -c1-300"]}' \
  --query Command.CommandId --output text)
aws ssm wait command-executed --command-id "$cmd" --instance-id "$instance" || true
aws ssm get-command-invocation --command-id "$cmd" --instance-id "$instance" --query '[Status,StandardOutputContent,StandardErrorContent]' --output text

echo "== https://staging.360.silvicominc.com/api/version"
for i in 1 2 3 4 5 6; do
  if curl -fsS --max-time 15 "$NEW/api/version" | head -c 200; then echo; echo "certificate OK"; exit 0; fi
  sleep 20
done
echo "staging.360 still has no certificate — paste the Caddy lines above to Claude" >&2
exit 1
