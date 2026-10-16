#!/usr/bin/env bash
# ci.yml's `build` verdict, run against every kind of `needs` it can be handed (2026-10-16).
#
#   bash scripts/check-ci-verdict.sh [path/to/ci.yml]
#
# WHY. `build` is main's ONE required check, and since CI-FEEDBACK-LOOP-V2-PLAN.md step 2 it may
# pass with the heavy jobs SKIPPED — when `plan` proved main's tree was already tested green by its
# PR. A mistake in that rule is the one place a skip could merge or deploy untested code, and no
# other test would ever see it: the rule only runs inside GitHub Actions. So this extracts the
# step's script from ci.yml itself (not a copy of it) and runs it against fixture `needs` objects.
# Proven by four mutants on the day: native-android skippable, reuse honoured from a failed plan,
# any skip accepted, plan's own result made a verdict — each turns at least one case WRONG.
#
# Ruby is used only to parse YAML: it ships on GitHub's ubuntu image and on macOS, and this repo
# has no YAML parser among its Node dependencies.
set -u
yml="${1:-.github/workflows/ci.yml}"
script=$(ruby -ryaml -e 'w = YAML.load_file(ARGV[0]); print w["jobs"]["build"]["steps"].find { |s| s["name"] == "Require every CI job to have succeeded" }["run"]' "$yml")
# An empty script runs green against every fixture, so a failed extraction must not look like a pass.
if [ -z "$script" ] || ! grep -q "bad=" <<<"$script"; then
  echo "FATAL: could not extract the verdict step from $yml"
  exit 2
fi

heavy="gates typecheck bundle test-api test-web test-packages matrices"
needs() { # plan_result heavy_result native_result [override_job override_result]
  local j='{' first=1
  for k in plan $heavy native-android; do
    r=$2; [ "$k" = plan ] && r=$1; [ "$k" = native-android ] && r=$3
    [ "${4:-}" = "$k" ] && r=$5
    [ $first = 1 ] || j+=','; first=0
    j+="\"$k\":{\"result\":\"$r\",\"outputs\":{}}"
  done
  echo "$j}"
}
pass=0 fail=0
check() { # name expected_exit reuse needs_json
  GITHUB_STEP_SUMMARY=/dev/null NEEDS="$4" REUSE="$3" PROOF="https://x/run/1" bash -c "$script" >/dev/null 2>&1
  got=$?; [ $got -ne 0 ] && got=1
  if [ "$got" = "$2" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "WRONG: $1 (expected $2, got $got)"; fi
}
check "PR, all green, plan skipped"                0 ""     "$(needs skipped success success)"
check "push, no proof, all green"                  0 ""     "$(needs success success success)"
check "push, reused proof, heavy skipped"          0 true   "$(needs success skipped success)"
check "heavy skipped WITHOUT reuse"                1 ""     "$(needs skipped skipped success)"
check "heavy skipped, reuse=false"                 1 false  "$(needs success skipped success)"
check "reuse, but native skipped"                  1 true   "$(needs success skipped skipped)"
check "reuse, but native failed"                   1 true   "$(needs success skipped failure)"
check "reuse, one heavy job FAILED"                1 true   "$(needs success skipped success test-web failure)"
check "reuse, one heavy job cancelled"             1 true   "$(needs success skipped success matrices cancelled)"
check "no reuse, one shard failed"                 1 ""     "$(needs success success success test-api failure)"
check "plan failed, everything else green"         0 ""     "$(needs failure success success)"
check "plan cancelled, heavy ran green"            0 ""     "$(needs cancelled success success)"
check "plan FAILED yet says reuse, heavy skipped"   1 true   "$(needs failure skipped success)"
check "plan skipped yet reuse=true, heavy skipped"  1 true   "$(needs skipped skipped success)"
check "PR, one job skipped"                        1 ""     "$(needs skipped success success bundle skipped)"
echo "verdict cases: $pass passed, $fail wrong"
[ $fail = 0 ]
