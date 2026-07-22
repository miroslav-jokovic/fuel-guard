#!/usr/bin/env bash
#
# FuelGuard EFS mailbox diagnostic — mirrors exactly what apps/api/src/lib/graphMail.ts does,
# one step at a time, so you can see WHERE the flow breaks (token / folder / listing /
# attachments / mark-as-read). It does NOT import anything and does NOT mark any email read.
#
# HOW TO RUN (in any terminal with internet — your laptop is fine):
#   export EFS_GRAPH_TENANT_ID=...        # same values you set in Railway
#   export EFS_GRAPH_CLIENT_ID=...
#   export EFS_GRAPH_CLIENT_SECRET=...
#   export EFS_GRAPH_MAILBOX=...          # e.g. the mailbox address the reports arrive in
#   export EFS_GRAPH_FOLDER='FuelGuard EFS'
#   bash scripts/graph-efs-diag.sh
#
# Share the OUTPUT with me (it does not print your token or secret). Requires: curl, python3.

set -u
# Auto-load real values from scripts/efs-diag.env when present (copy efs-diag.env.example and fill it in).
DIAG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [ -f "$DIAG_DIR/efs-diag.env" ]; then set -a; . "$DIAG_DIR/efs-diag.env"; set +a; fi
: "${EFS_GRAPH_TENANT_ID:?set EFS_GRAPH_TENANT_ID}"
: "${EFS_GRAPH_CLIENT_ID:?set EFS_GRAPH_CLIENT_ID}"
: "${EFS_GRAPH_CLIENT_SECRET:?set EFS_GRAPH_CLIENT_SECRET}"
: "${EFS_GRAPH_MAILBOX:?set EFS_GRAPH_MAILBOX}"
FOLDER="${EFS_GRAPH_FOLDER:-FuelGuard EFS}"

jqpy() { python3 -c "import sys,json;$1" 2>/dev/null; }

echo "=== 1) App-only token (client_credentials) ==="
TOKRES=$(curl -s -X POST "https://login.microsoftonline.com/$EFS_GRAPH_TENANT_ID/oauth2/v2.0/token" \
  --data-urlencode "client_id=$EFS_GRAPH_CLIENT_ID" \
  --data-urlencode "client_secret=$EFS_GRAPH_CLIENT_SECRET" \
  --data-urlencode "scope=https://graph.microsoft.com/.default" \
  --data-urlencode "grant_type=client_credentials")
TOKEN=$(printf '%s' "$TOKRES" | jqpy 'print(json.load(sys.stdin).get("access_token",""))')
if [ -z "$TOKEN" ]; then
  echo "  X No token. Response (secrets not shown):"
  printf '%s' "$TOKRES" | jqpy 'd=json.load(sys.stdin);print({k:d[k] for k in d if k!="access_token"})'
  exit 1
fi
echo "  OK Token acquired. Roles granted to the app:"
printf '%s' "$TOKEN" | awk -F. '{print $2}' | tr '_-' '/+' | base64 -d 2>/dev/null | jqpy 'print(json.load(sys.stdin).get("roles","<none>"))'
echo "    (You want to see Mail.ReadWrite in that list -- Mail.Read alone cannot mark emails read.)"

AUTH=(-H "Authorization: Bearer $TOKEN")
BASE="https://graph.microsoft.com/v1.0/users/$EFS_GRAPH_MAILBOX"

echo
echo "=== 2) Resolve folder '$FOLDER' (top-level, then under Inbox) ==="
FID=$(curl -s -G "$BASE/mailFolders" "${AUTH[@]}" \
  --data-urlencode "\$filter=displayName eq '$FOLDER'" --data-urlencode '$select=id' --data-urlencode '$top=1' \
  | jqpy 'v=json.load(sys.stdin).get("value",[]);print(v[0]["id"] if v else "")')
if [ -z "$FID" ]; then
  FID=$(curl -s -G "$BASE/mailFolders/inbox/childFolders" "${AUTH[@]}" \
    --data-urlencode "\$filter=displayName eq '$FOLDER'" --data-urlencode '$select=id' --data-urlencode '$top=1' \
    | jqpy 'v=json.load(sys.stdin).get("value",[]);print(v[0]["id"] if v else "")')
  [ -n "$FID" ] && echo "  OK Found as a SUBFOLDER of Inbox."
fi
if [ -z "$FID" ]; then
  echo "  X Folder not found top-level or under Inbox. All folder names in the mailbox:"
  curl -s -G "$BASE/mailFolders" "${AUTH[@]}" --data-urlencode '$select=displayName' --data-urlencode '$top=100' \
    | jqpy 'print([f["displayName"] for f in json.load(sys.stdin).get("value",[])])'
  exit 1
fi
echo "  OK Folder id resolved."

echo
echo "=== 3) List UNREAD messages WITH attachments in that folder (what the sync sees) ==="
MSGS=$(curl -s -G "$BASE/mailFolders/$FID/messages" "${AUTH[@]}" \
  --data-urlencode "\$filter=isRead eq false and hasAttachments eq true" \
  --data-urlencode '$select=id,subject,receivedDateTime,isRead,hasAttachments' --data-urlencode '$top=50')
printf '%s' "$MSGS" | jqpy 'd=json.load(sys.stdin);v=d.get("value",[]);print(f"  count={len(v)}");[print("   -",m.get("receivedDateTime"),"|",m.get("subject")) for m in v]' \
  || { echo "  X Listing error:"; printf '%s' "$MSGS"; exit 1; }
MID=$(printf '%s' "$MSGS" | jqpy 'v=json.load(sys.stdin).get("value",[]);print(v[0]["id"] if v else "")')
if [ -z "$MID" ]; then
  echo "  ! Zero unread-with-attachment messages in the folder. Check: are the reports actually IN this folder, still UNREAD, and do they carry a real file attachment?"
  echo "    For comparison, ALL messages in the folder (any read state):"
  curl -s -G "$BASE/mailFolders/$FID/messages" "${AUTH[@]}" --data-urlencode '$select=subject,isRead,hasAttachments' --data-urlencode '$top=25' \
    | jqpy 'print([(m.get("subject"),"read" if m.get("isRead") else "unread","att" if m.get("hasAttachments") else "no-att") for m in json.load(sys.stdin).get("value",[])])'
  exit 0
fi

echo
echo "=== 4) Attachments on the first message (the sync only takes .csv/.xlsx/.xls) ==="
curl -s -G "$BASE/messages/$MID/attachments" "${AUTH[@]}" --data-urlencode '$select=id,name,size,contentType' \
  | jqpy 'print([(a.get("name"),a.get("size"),a.get("@odata.type")) for a in json.load(sys.stdin).get("value",[])])'
echo "    (Want a *.xlsx with @odata.type = #microsoft.graph.fileAttachment. A referenceAttachment/itemAttachment or link cannot be read.)"

echo
echo "=== 5) WRITE test -- can the app mark a message read? (Mail.ReadWrite) ==="
echo "    Setting isRead=false on the first message (leaves it UNREAD; just tests write access):"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/messages/$MID" "${AUTH[@]}" \
  -H "Content-Type: application/json" -d '{"isRead": false}')
echo "    HTTP $CODE   -> 200/204 = write OK (Mail.ReadWrite active).  403 = no write permission (still Mail.Read)."
echo
echo "=== done ==="
