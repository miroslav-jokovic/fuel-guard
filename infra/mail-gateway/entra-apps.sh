#!/bin/bash
# The gateway's two Entra app registrations ("badge 2" and its staging twin), with no secret
# (docs/plans/dispatch-loads/BROKER-MAIL-READER-PLAN.md, Q-BMR1–3, P0). OWNER-RUN with `!`, signed in
# to Microsoft 365 with Azure CLI:
#
#   az login --allow-no-subscriptions        (once; the tenant has no Azure subscription)
#   bash infra/mail-gateway/entra-apps.sh --check     read-only report, changes nothing
#   bash infra/mail-gateway/entra-apps.sh             create / repair both
#
# What it makes, per environment: an app registration (single tenant, no redirect URI, NO API
# permission, NO secret, NO certificate), its service principal ("enterprise application"), and one
# federated credential trusting exactly the gateway's AWS role (issuer + subject + audience).
# It never grants consent and never touches another app. All mailbox access comes later from
# Exchange role assignments that Simo makes (V1/V2). This script cannot grant any of that.
#
# Refusals, not repairs: a secret or certificate found on either app stops the script. So do an
# API permission that is not ours to remove silently, and two apps with the same name. Each is
# printed for a person to look at. An extra permission is removed only when it is the portal's
# default `User.Read`, the one thing a new registration may carry.
#
# The issuer is this AWS account's outbound-federation issuer (setup.sh prints it). It and the role
# ARNs identify AWS resources, not Microsoft ones. The tenant and client ids are printed at the end
# for the owner, and never written to the repository.
set -euo pipefail

CHECK=false
for a in "$@"; do case "$a" in --check) CHECK=true ;; *) echo "unknown option: $a" >&2; exit 2 ;; esac; done

ISSUER="https://a14a335c-4f80-4f8f-9dd1-dd5a24d30c89.tokens.sts.global.api.aws"
AUDIENCE="api://AzureADTokenExchange"
ACCOUNT=891568748437
OUR_DOMAIN=silvicominc.com
GRAPH_APP=00000003-0000-0000-c000-000000000000      # Microsoft Graph
USER_READ=e1fe6dd8-ba31-4d61-89e7-88639da4683d     # its delegated User.Read (the portal's default)

say() { echo "• $*"; }
todo() { if $CHECK; then echo "✘ would: $*"; else echo "→ $*"; fi; }
stop() { echo "STOP: $*" >&2; exit 3; }
command -v az >/dev/null || stop "Azure CLI not installed (brew install azure-cli)"
command -v jq >/dev/null || stop "jq not installed"
az account show >/dev/null 2>&1 || stop "not signed in — run: az login --allow-no-subscriptions"

# The wrong tenant is the one mistake nothing later would catch, so it is checked first, from Graph.
TENANT=$(az account show --query tenantId -o tsv)
domains=$(az rest --method get --url "https://graph.microsoft.com/v1.0/organization?\$select=verifiedDomains" \
  --query "value[0].verifiedDomains[].name" -o tsv)
grep -qix "$OUR_DOMAIN" <<<"$domains" || stop "signed in to a tenant without $OUR_DOMAIN — run az login again with the Silvicom account"
say "tenant verified ($OUR_DOMAIN is one of its domains)"
$CHECK && say "CHECK MODE — nothing will be changed"

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
declare -a REPORT=()

one_app() { # <env> <display name>
  local env=$1 name=$2 subject="arn:aws:iam::$ACCOUNT:role/silvicom-mailgw-$1" cred="aws-mailgw-$1"
  echo; say "== $env: \"$name\""

  # 1. The registration — found by exact name; two of them is a person's question, not ours.
  local apps n app_id obj_id
  apps=$(az ad app list --filter "displayName eq '$name'" --query "[].{appId:appId,id:id}" -o json)
  n=$(jq length <<<"$apps")
  [ "$n" -le 1 ] || stop "$n apps are named \"$name\" — delete the extra one(s) by hand first"
  if [ "$n" = 1 ]; then
    app_id=$(jq -r '.[0].appId' <<<"$apps"); obj_id=$(jq -r '.[0].id' <<<"$apps"); say "app exists"
  else
    todo "create app registration (single tenant, no redirect URI)"
    if $CHECK; then REPORT+=("$env: not created yet"); return; fi
    read -r app_id obj_id < <(az ad app create --display-name "$name" --sign-in-audience AzureADMyOrg \
      --query "[appId,id]" -o tsv | paste -sd' ' -)
    say "app created"
  fi

  # 2. Its contents, read back from Graph (not from what we just asked for).
  local app
  app=$(az rest --method get --url "https://graph.microsoft.com/v1.0/applications/$obj_id?\$select=signInAudience,passwordCredentials,keyCredentials,requiredResourceAccess,web,spa,publicClient")
  [ "$(jq '.passwordCredentials | length' <<<"$app")" = 0 ] || stop "$env app HAS A CLIENT SECRET — this app must never have one. Delete it in the portal (Certificates & secrets), then re-run"
  [ "$(jq '.keyCredentials | length' <<<"$app")" = 0 ] || stop "$env app HAS A CERTIFICATE — remove it in the portal, then re-run"
  [ "$(jq -r .signInAudience <<<"$app")" = AzureADMyOrg ] || stop "$env app is not single-tenant ($(jq -r .signInAudience <<<"$app"))"
  [ "$(jq '[.web.redirectUris[]?, .spa.redirectUris[]?, .publicClient.redirectUris[]?] | length' <<<"$app")" = 0 ] \
    || stop "$env app has redirect URIs — it must have none"
  local perms only_user_read
  perms=$(jq -c '.requiredResourceAccess' <<<"$app")
  only_user_read=$(jq --arg g "$GRAPH_APP" --arg u "$USER_READ" \
    'length == 1 and .[0].resourceAppId == $g and (.[0].resourceAccess | length == 1) and .[0].resourceAccess[0].id == $u' <<<"$perms")
  if [ "$perms" = "[]" ]; then say "API permissions: none"
  elif [ "$only_user_read" = true ]; then
    todo "remove the default User.Read permission"
    $CHECK || { az rest --method patch --url "https://graph.microsoft.com/v1.0/applications/$obj_id" \
      --headers Content-Type=application/json --body '{"requiredResourceAccess":[]}' >/dev/null; say "API permissions: none"; }
  else stop "$env app carries API permissions other than the default — look in the portal: $perms"; fi

  # 3. The service principal (the "enterprise application" Exchange's role assignment names).
  local sp_id
  sp_id=$(az ad sp list --filter "appId eq '$app_id'" --query "[0].id" -o tsv)
  if [ -n "$sp_id" ]; then say "enterprise application exists"; else
    todo "create the enterprise application (service principal)"
    $CHECK || sp_id=$(az ad sp create --id "$app_id" --query id -o tsv)
  fi
  # No consent, ever: any app-role assignment on it is an Entra-consented permission (V2).
  if [ -n "$sp_id" ]; then
    local grants
    grants=$(az rest --method get --url "https://graph.microsoft.com/v1.0/servicePrincipals/$sp_id/appRoleAssignments" --query "value | length(@)" -o tsv)
    [ "$grants" = 0 ] || stop "$env enterprise application has $grants consented permission(s) — remove them (Enterprise applications → Permissions)"
    say "consented permissions: none"
  fi

  # 4. The federated credential: exactly one, exactly these three values.
  local creds mine
  creds=$(az ad app federated-credential list --id "$app_id" -o json)
  mine=$(jq --arg n "$cred" '[.[] | select(.name == $n)]' <<<"$creds")
  [ "$(jq length <<<"$creds")" -le 1 ] || stop "$env app has $(jq length <<<"$creds") federated credentials — it must have only $cred"
  if [ "$(jq length <<<"$mine")" = 1 ]; then
    jq -e --arg i "$ISSUER" --arg s "$subject" --arg a "$AUDIENCE" \
      '.[0].issuer == $i and .[0].subject == $s and .[0].audiences == [$a]' <<<"$mine" >/dev/null \
      || stop "$env credential $cred exists with DIFFERENT values: $(jq -c '.[0] | {issuer,subject,audiences}' <<<"$mine") — delete it in the portal and re-run"
    say "federated credential $cred: issuer, subject and audience match exactly"
  elif [ "$(jq length <<<"$creds")" = 1 ]; then
    stop "$env app has a federated credential with another name: $(jq -c '.[0] | {name,issuer,subject}' <<<"$creds")"
  else
    todo "add federated credential $cred (subject $subject)"
    if ! $CHECK; then
      jq -n --arg n "$cred" --arg i "$ISSUER" --arg s "$subject" --arg a "$AUDIENCE" \
        '{name:$n, issuer:$i, subject:$s, audiences:[$a], description:"Silvicom 360 mail gateway Lambda (AWS outbound federation). No secret exists for this app."}' > "$WORK/fic.json"
      az ad app federated-credential create --id "$app_id" --parameters "@$WORK/fic.json" >/dev/null
      say "federated credential $cred added (Entra may take a few minutes to honour it)"
    fi
  fi

  local owners
  owners=$(az ad app owner list --id "$app_id" --query "[].userPrincipalName" -o tsv | paste -sd, -)
  say "owners: ${owners:-none} (Simo removes all but himself after his step — an owner could add a secret)"
  REPORT+=("$env client ID:                 $app_id" "$env enterprise-app object ID:  ${sp_id:-<not created>}")
}

one_app production "Silvicom 360 Mail Gateway"
one_app staging "Silvicom 360 Mail Gateway (staging)"

echo
echo "=== for Claude (paste back): ==="
echo "Directory (tenant) ID:                $TENANT"
printf '%s\n' "${REPORT[@]}"
