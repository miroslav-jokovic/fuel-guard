#!/usr/bin/env bash
# Installs Playwright's Chromium for @silvicom/web, time-boxed and retried.
#
#   bash scripts/install-chromium.sh [--with-deps]
#
# On 2026-10-27 `playwright install --with-deps chromium` hung for ~40 minutes on a GitHub runner,
# twice, with no output: once holding PR CI, once holding main's CI while a production release waited
# on it (require-ci-green). A healthy install takes about a minute (the browser is cached; --with-deps
# is apt), so each attempt gets 5 minutes and a hang costs one retry instead of the job's whole
# timeout. In smoke.yml that difference is a failed smoke and an auto-rollback of a healthy release.
#
# The time box alone made a slow mirror fatal. `timeout` ends pnpm, but the apt-get that Playwright started
# through sudo outlives it and keeps the dpkg lock, so attempts 2 and 3 died in seconds on "Could not get lock"
# and the retries retried nothing: 7 of the 20 newest failed CI runs on 2026-11-06, the last with the Azure
# mirror at ~50 kB/s (#2086). So a failed attempt now waits for that apt-get, which is usually still making
# progress, and ends it only after a further 5 minutes. The .deb files it finished stay in apt's cache, so the
# next attempt carries on from there.
set -uo pipefail
deps="${1:-}"
# GNU timeout is on every Linux runner; a runner without it (macOS) runs the install unbounded, as before.
bound=(timeout 300)
command -v timeout >/dev/null || bound=()

apt_busy() { pgrep -x apt-get >/dev/null || pgrep -x dpkg >/dev/null; }

# Only --with-deps runs apt. dpkg is never killed, because ending it mid-unpack breaks the package database;
# `dpkg --configure -a` finishes whatever an ended apt-get left half done.
settle_apt() {
  [ -n "$deps" ] && command -v apt-get >/dev/null || return 0
  for _ in $(seq 1 60); do
    apt_busy || return 0
    sleep 5
  done
  echo "::warning::apt was still running 5 minutes after the attempt ended, so it is being stopped."
  sudo pkill -x apt-get
  sleep 5
  sudo dpkg --configure -a
}

for attempt in 1 2 3; do
  echo "Chromium install, attempt ${attempt}/3"
  # shellcheck disable=SC2086 # $deps is empty or one flag
  if ${bound[@]+"${bound[@]}"} pnpm --filter @silvicom/web exec playwright install $deps chromium; then
    exit 0
  fi
  echo "::warning::Chromium install attempt ${attempt} failed or exceeded 5 minutes."
  settle_apt
done
echo "::error::Chromium install failed 3 times."
exit 1
