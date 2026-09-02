#!/bin/zsh
# Two conditions must both be met before PR #489 may merge:
#   1. CI green on the PR
#   2. migration 0297 APPLIED in production — `fuel_range_totals` returning `fills_with_vehicle`
# Emits one line per condition as it lands, then exits. Deleted once the PR is merged.
q="select pg_get_function_result(p.oid) as returns from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='fuel_range_totals';"
ci_done=0
schema_done=0
tries=0
while true; do
  tries=$((tries + 1))
  if [[ $ci_done -eq 0 ]]; then
    st=$(gh pr checks 489 2>&1 | head -1)
    case "$st" in
      *pending*) ;;
      *error*connecting*) ;;
      *) echo "CI: $st"; ci_done=1 ;;
    esac
  fi
  if [[ $schema_done -eq 0 ]]; then
    out=$(supabase db query --linked "$q" 2>&1)
    case "$out" in
      *fills_with_vehicle*) echo "SCHEMA: 0297 applied — fuel_range_totals now returns fills_with_vehicle"; schema_done=1 ;;
      *) ;;
    esac
  fi
  if [[ $ci_done -eq 1 && $schema_done -eq 1 ]]; then
    echo "BOTH GATES MET — #489 may merge"
    exit 0
  fi
  if [[ $tries -ge 40 ]]; then
    echo "GIVING UP after $tries polls — ci_done=$ci_done schema_done=$schema_done"
    exit 1
  fi
  sleep 45
done
