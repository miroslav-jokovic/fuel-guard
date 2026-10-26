#!/bin/bash
# What the HOST must have for the stack, as code (AWS-MIGRATION-PLAN.md D-AWS14, AWS6). deploy.sh runs
# it on every deploy, before `compose up`, so the staging server gets it with the next merge and the
# production server with the next release — through SSM, like everything else here, never by hand.
# Every step is idempotent: a second run changes nothing and says so.
#
# The 2026-10-24 audit of the staging host (production was built the same way, by hand, with no
# code to check against) found the three gaps this closes:
#
#   1. Security updates were NOT automatic although D-AWS14 says they are — dnf-automatic was never
#      installed. It is installed here and set to apply SECURITY updates only (upgrade_type), daily,
#      with no automatic reboot: a kernel update on a one-server environment is applied at a
#      planned reboot (silvicom-boot.service brings the stack back, proven 2026-10-22), not at
#      06:00 UTC by a timer. ⚠ A security update to docker or containerd restarts the daemon and
#      with it every container (~1 min, restart: unless-stopped brings them back) — accepted: it
#      lands in the 06:00–07:00 UTC window (01:00–02:00 Central), when the office is closed.
#   2. sshd listened on 22. The security group blocks the port (80/443 only, D-AWS14) and every
#      command reaches the server through SSM Run Command (ssm-deploy.sh), so there is no key and
#      no reason for a listener. Disabled and stopped, not removed: a person who needs it back on
#      an isolated host can start it from the serial console.
#   3. Caddy ran as root inside its container and the app containers had the default capability set
#      and a writable root (compose.yml's x-hardened). compose.yml now runs Caddy as uid 10001, so
#      the two certificate volumes it has been writing as root since 2026-10-22 are given to that
#      uid here, before the first hardened start — without this the hardened Caddy could not read
#      its own certificates (keys are mode 0600) and would re-issue every one, into Let's Encrypt's
#      rate limits. The OCR model directory (compose.yml, api/worker) is created for uid 1000 (the
#      image's `node`) for the same reason: a bind mount Docker creates belongs to root.
#
# Port 80 stays open, on purpose. Closing it would not remove a listener (Caddy owns 80 and 443) and
# would cost two things: the http→https redirect — a person typing `360.silvicominc.com` into a
# browser would get a timeout instead of the site — and the ACME HTTP-01 challenge, leaving only
# TLS-ALPN-01 on 443 (Caddy tries both; one less way to renew is one more way to end up with
# outage 1 of the 2026-10-23 cutover). The security group is the owner's, outside this repo.
set -euo pipefail

changed=0
note() { echo "host: $*"; }

# 1. dnf-automatic, security updates applied daily, no automatic reboot.
if ! rpm -q dnf-automatic >/dev/null 2>&1; then
  dnf install -q -y dnf-automatic >/dev/null
  note "installed dnf-automatic"; changed=1
fi
conf=/etc/dnf/automatic.conf
want_conf() { # <key> <value>: set key under its section, once
  local key=$1 value=$2
  if grep -Eq "^${key}\s*=\s*${value}\s*$" "$conf"; then return; fi
  if grep -Eq "^${key}\s*=" "$conf"; then
    sed -i -E "s|^${key}\s*=.*|${key} = ${value}|" "$conf"
  else
    echo "${key} = ${value}" >> "$conf"
  fi
  note "automatic.conf: ${key} = ${value}"; changed=1
}
want_conf upgrade_type security
want_conf apply_updates yes
want_conf reboot never
if [ "$(systemctl is-enabled dnf-automatic.timer 2>/dev/null)" != enabled ] || ! systemctl is-active --quiet dnf-automatic.timer; then
  systemctl enable --now dnf-automatic.timer >/dev/null 2>&1
  note "enabled dnf-automatic.timer"; changed=1
fi

# 2. No SSH listener.
if systemctl is-enabled --quiet sshd 2>/dev/null || systemctl is-active --quiet sshd; then
  systemctl disable --now sshd >/dev/null 2>&1
  note "disabled sshd"; changed=1
fi

# 3. Directories and volumes owned by the unprivileged uids the containers run as.
#    Bind-mounted into api and worker; Docker would create it for root and `node` could not write.
if [ ! -d /var/lib/silvicom/ocr-models ]; then
  install -d -m 0750 -o 1000 -g 1000 /var/lib/silvicom/ocr-models
  note "created /var/lib/silvicom/ocr-models for uid 1000"; changed=1
fi
#    Caddy's volumes. `docker volume inspect` sees them only once compose has created them (the
#    first deploy of a new server), so each is chowned when it exists and is not yet uid 10001's;
#    on a server where it does not exist yet, compose creates it from the image's /data and /config,
#    which Caddy as 10001 can write because the image leaves them world-writable (mode 1777).
#    EVERY file is checked, not only the mount point: production was rolled back to 3f517ed (Caddy
#    as root) from 2026-10-24 to 10-26, and root wrote certificates and locks INSIDE volumes whose
#    top directory was already 10001's. The next hardened start (release run 40382803078) exited
#    with "loading initial config ... caching" for every host, ports 80/443 refused, and the web was
#    down until 3f517ed went back. Reproduced locally with exactly that layout.
for vol in silvicom_caddy_data silvicom_caddy_config; do
  if docker volume inspect "$vol" >/dev/null 2>&1; then
    mp=$(docker volume inspect "$vol" --format '{{.Mountpoint}}')
    if [ -n "$(find "$mp" \( ! -uid 10001 -o ! -gid 10001 \) -print -quit)" ]; then
      chown -R 10001:10001 "$mp"
      note "chowned $vol to uid 10001"; changed=1
    fi
  fi
done

[ "$changed" = 1 ] || note "nothing to change"
