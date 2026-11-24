#!/bin/bash
# The mail gateway's database login (docs/plans/dispatch-loads/BROKER-MAIL-READER-PLAN.md, D-BMR3).
# OWNER-RUN with `!`: it changes a database role and writes Parameter Store, which the auto-mode
# classifier refuses Claude (memory: fuelguard-prod-db-access, aws-migration-position).
#
#   bash infra/mail-gateway/db-login.sh <staging|production> check        read-only: role + parameter state
#   bash infra/mail-gateway/db-login.sh <staging|production> probe        P0: throwaway login, pooler proof
#   bash infra/mail-gateway/db-login.sh <staging|production> probe-drop   P0: remove the throwaway login
#   bash infra/mail-gateway/db-login.sh <staging|production> login        after PR-a: turn mail_gateway on
#                                                                          (re-running it = rotating it)
# Needs: AWS_PROFILE=silvicom, `supabase login` done, psql, python3, jq.
# Inputs (environment): MAILGW_PROJECT_REF — REQUIRED for staging (Supabase dashboard → Project
# Settings → General → Reference ID); production's is public in the repo already.
# MAILGW_POOLER_HOST — the "Transaction pooler" host from the dashboard's Connect panel; defaults to
# production's, aws-1-us-west-2.pooler.supabase.com. A wrong host fails the connection test loudly.
#
# Why each choice:
# - **No password ever reaches the database in clear.** The script makes a SCRAM-SHA-256 verifier
#   locally and sends `alter role … password 'SCRAM-SHA-256$…'`, which Postgres stores as given. The
#   Management API request, any statement log and pg_authid hold only the verifier. The password
#   itself exists in this shell's memory and in one SecureString parameter — never in argv (`ps`),
#   never on screen, never in a migration (D-BMR3).
# - **SQL goes through `supabase db query --project-ref` in an EMPTY workdir.** Run from the main
#   checkout, `--linked` without the flag would target whatever that checkout is linked to
#   (production). With an empty workdir a missing ref is refused, not defaulted — checked 2026-11-24:
#   "LegacyProjectNotLinkedError: Cannot find project ref".
# - **`probe` uses a throwaway role, not mail_gateway.** P0 must prove the pooler accepts a custom
#   login (V8: the user name form `role.<project>` is inferred, not documented) BEFORE PR-a creates the
#   real role; creating the real role here would put a second author on what the migration owns.
#   The throwaway has no grant at all, so it also shows a table is refused.
set -euo pipefail

ENV_NAME="${1:?environment: staging or production}"
MODE="${2:?mode: check | probe | probe-drop | login}"
case "$ENV_NAME" in staging|production) ;; *) echo "unknown environment: $ENV_NAME" >&2; exit 2 ;; esac
case "$MODE" in check|probe|probe-drop|login) ;; *) echo "unknown mode: $MODE" >&2; exit 2 ;; esac

ACCOUNT=891568748437
export AWS_DEFAULT_REGION=us-west-2
PROD_REF=nsjszqnfppczbnligxll
if [ "$ENV_NAME" = production ]; then REF="${MAILGW_PROJECT_REF:-$PROD_REF}"; else
  REF="${MAILGW_PROJECT_REF:?set MAILGW_PROJECT_REF to the STAGING project ref}"
  [ "$REF" != "$PROD_REF" ] || { echo "MAILGW_PROJECT_REF is production's ref — refusing for staging" >&2; exit 2; }
fi
POOLER_HOST="${MAILGW_POOLER_HOST:-aws-1-us-west-2.pooler.supabase.com}"
PARAMS="/silvicom-mailgw/$ENV_NAME"
for t in aws supabase psql python3 jq openssl; do command -v "$t" >/dev/null || { echo "missing tool: $t" >&2; exit 2; }; done
who=$(aws sts get-caller-identity --query Account --output text)
[ "$who" = "$ACCOUNT" ] || { echo "AWS: signed in to account $who, not $ACCOUNT — stop" >&2; exit 2; }

say() { echo "• $*"; }
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT; chmod 700 "$WORK"
q() { # <sql> → the rows as a JSON array (Management API, as the dashboard's `postgres` user)
  supabase --workdir "$WORK" db query --linked --project-ref "$REF" --output-format json "$1" 2>/dev/null \
    | sed -n '/^{/,$p' | jq -c '.rows'
}
verifier() { # password on stdin → a SCRAM-SHA-256 verifier in Postgres's own format (RFC 5802/7677)
  python3 -c '
import base64, hashlib, hmac, os, sys
pw = sys.stdin.read().encode(); salt = os.urandom(16); it = 4096
salted = hashlib.pbkdf2_hmac("sha256", pw, salt, it)
ck = hmac.new(salted, b"Client Key", "sha256").digest()
sk = hmac.new(salted, b"Server Key", "sha256").digest()
b = lambda x: base64.b64encode(x).decode()
print(f"SCRAM-SHA-256${it}:{b(salt)}${b(hashlib.sha256(ck).digest())}:{b(sk)}")'
}
put_secret() { # <name> <value> — via a 0600 file, so the value is never an argument
  local f="$WORK/p.json"
  jq -n --arg n "$1" --arg v "$2" '{Name:$n,Value:$v,Type:"SecureString",Overwrite:true}' > "$f"
  aws ssm put-parameter --cli-input-json "file://$f" >/dev/null; rm -f "$f"
}
connect_test() { # <role> <password> <port> → prints "ok <current_user>" or the error's first line
  PGPASSWORD="$2" PGCONNECT_TIMEOUT=10 psql "host=$POOLER_HOST port=$3 dbname=postgres user=$1.$REF sslmode=require" \
    -XAtqc "select 'ok ' || current_user" 2>&1 | head -1
}
role_state() { q "select rolname, rolcanlogin, rolconnlimit, rolinherit from pg_roles where rolname = '$1'"; }

say "environment $ENV_NAME, project $REF, pooler $POOLER_HOST"
case "$MODE" in
check)
  for r in mail_gateway mailgw_probe; do say "role $r: $(role_state "$r")   ([] = does not exist)"; done
  for p in DATABASE_URL DATABASE_URL_PROBE; do
    if aws ssm describe-parameters --parameter-filters "Key=Name,Values=$PARAMS/$p" --query 'Parameters[0].LastModifiedDate' --output text | grep -qv None; then
      say "parameter $PARAMS/$p exists (value not read)"; else say "parameter $PARAMS/$p: none"; fi
  done
  ;;
probe)
  pw=$(openssl rand -hex 32)
  v=$(printf %s "$pw" | verifier)
  # A plain CREATE (not guarded): a leftover throwaway from an earlier run is dropped first, so the
  # proof always runs against a role this run made.
  q "drop role if exists mailgw_probe" >/dev/null
  q "create role mailgw_probe login noinherit connection limit 2 password '$v'" >/dev/null
  say "throwaway role mailgw_probe created: $(role_state mailgw_probe)"
  for port in 6543 5432; do say "pooler port $port, user mailgw_probe.<project>: $(connect_test mailgw_probe "$pw" "$port")"; done
  refused=$(PGPASSWORD="$pw" psql "host=$POOLER_HOST port=6543 dbname=postgres user=mailgw_probe.$REF sslmode=require" \
    -XAtqc "select 1 from public.organizations limit 1" 2>&1 | head -1 || true)
  say "table read as mailgw_probe (must be 'permission denied'): $refused"
  put_secret "$PARAMS/DATABASE_URL_PROBE" "postgresql://mailgw_probe.$REF:$pw@$POOLER_HOST:6543/postgres?sslmode=require"
  say "wrote $PARAMS/DATABASE_URL_PROBE (transaction pooler) — now run prove.sh $ENV_NAME, then: $0 $ENV_NAME probe-drop"
  ;;
probe-drop)
  q "drop role if exists mailgw_probe" >/dev/null
  aws ssm delete-parameter --name "$PARAMS/DATABASE_URL_PROBE" 2>/dev/null && say "deleted $PARAMS/DATABASE_URL_PROBE" || say "no $PARAMS/DATABASE_URL_PROBE to delete"
  say "role mailgw_probe: $(role_state mailgw_probe)   ([] = gone)"
  ;;
login)
  state=$(role_state mail_gateway)
  [ "$state" != "[]" ] || { echo "role mail_gateway does not exist on $ENV_NAME — its migration (PR-a) has not been applied here yet" >&2; exit 3; }
  pw=$(openssl rand -hex 32)
  v=$(printf %s "$pw" | verifier)
  # LOGIN and the password only. Everything else about the role (noinherit, connection limit,
  # statement_timeout, its EXECUTE grants) belongs to the migration, where the gates can see it.
  q "alter role mail_gateway with login password '$v'" >/dev/null
  result=$(connect_test mail_gateway "$pw" 6543)
  say "login test through the transaction pooler: $result"
  case "$result" in "ok mail_gateway") ;; *) echo "login failed — parameter NOT written. The role now has a password nobody holds: fix the cause and re-run" >&2; exit 4 ;; esac
  put_secret "$PARAMS/DATABASE_URL" "postgresql://mail_gateway.$REF:$pw@$POOLER_HOST:6543/postgres?sslmode=require"
  say "wrote $PARAMS/DATABASE_URL; the gateway reads it at its next cold start"
  ;;
esac
