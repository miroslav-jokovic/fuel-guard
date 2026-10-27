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
set -uo pipefail
deps="${1:-}"
# GNU timeout is on every Linux runner; a runner without it (macOS) runs the install unbounded, as before.
bound=(timeout 300)
command -v timeout >/dev/null || bound=()
for attempt in 1 2 3; do
  echo "Chromium install, attempt ${attempt}/3"
  # shellcheck disable=SC2086 # $deps is empty or one flag
  if ${bound[@]+"${bound[@]}"} pnpm --filter @silvicom/web exec playwright install $deps chromium; then
    exit 0
  fi
  echo "::warning::Chromium install attempt ${attempt} failed or exceeded 5 minutes."
done
echo "::error::Chromium install failed 3 times."
exit 1
