#!/usr/bin/env bash
#
# FuelGuard EFS REJECT-FEED FIELD DIAGNOSTIC — answers ONE question:
#
#   Does CardManagementEP_getTranRejects return driver identity, and under what element names?
#
# Why this exists: apps/api/src/lib/efsSoap.ts:199-214 (`rejectedRows`) maps ten fields off each
# reject record and hardcodes `"Driver ID": null, "Driver Name": null`. Those nulls were written
# from a field list, not from a live response, and the raw XML is never persisted (efsSoap.ts:268
# only hashes it) — so nothing in the database or the logs can answer this. One live call can.
#
# It mirrors exactly what the API does — same envelope (efsXml.ts buildSoapEnvelope), same
# SOAPAction header (soapClient.ts:283-284), same wrapped <search> criteria the binding requires
# (efsSoap.ts:221) — then prints the ELEMENT NAMES the vendor actually returns instead of the ten
# we happen to read.
#
# READ-ONLY. login → getTranRejects → logout. Nothing is written to EFS or to your database.
#
# Safe to run from a laptop: per docs/22-EFS-CARD-CONTROL.md (Status 2026-08-11, finding 1), WEX
# IP-gates only the card-management operations. Login and the transaction feeds pass from any
# address — which is why the feeds ran for weeks on rotating Railway egress.
#
# HOW TO RUN — just run it. It PROMPTS for anything it needs:
#
#   bash scripts/efs-rejects-diag.sh              # last 30 days
#   bash scripts/efs-rejects-diag.sh 7            # last 7 days
#
# You paste the endpoint / username / password into the console when asked. The password prompt is
# silent (nothing echoes to the screen, nothing lands in your shell history), and no credential is
# written to disk. Copy them from Railway → fleetguardapi-production → Variables.
#
# Optional, if you would rather not retype them each run: put any of the three in the environment
# beforehand, or in a gitignored scripts/efs-rejects-diag.env — anything already set is used as-is
# and not prompted for.
#
# Requires: curl, python3. Prints NO password and NO full card numbers (PANs are masked to last 4).
# Driver names ARE printed — they are the thing being tested.

set -u

DIAG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
for envfile in "$DIAG_DIR/efs-rejects-diag.env" "$DIAG_DIR/efs-diag.env"; do
  if [ -f "$envfile" ]; then set -a; . "$envfile"; set +a; echo "(loaded $(basename "$envfile"))"; fi
done

# ── Interactive credential entry ────────────────────────────────────────────────────────────────
# Read from the terminal, not stdin: the analysis stage below consumes stdin through a pipe, and a
# script that is itself piped (curl … | bash) has no usable stdin at all. /dev/tty is the console.
if [ -r /dev/tty ]; then TTY=/dev/tty; else TTY=/dev/stdin; fi

# $1 = variable name, $2 = prompt, $3 = "secret" to suppress echo.
ask() {
  local var="$1" prompt="$2" secret="${3:-}" value=""
  # Already supplied via environment or env file — never prompt, never overwrite.
  if [ -n "${!var:-}" ]; then
    printf '  %-22s using the value already set\n' "$var"
    return 0
  fi
  while [ -z "$value" ]; do
    if [ -n "$secret" ]; then
      printf '  %s: ' "$prompt" > /dev/tty 2>/dev/null || printf '  %s: ' "$prompt"
      # -s keeps the password off the screen; the newline is ours because -s eats the user's.
      read -rs value < "$TTY"
      printf '\n' > /dev/tty 2>/dev/null || printf '\n'
    else
      printf '  %s: ' "$prompt" > /dev/tty 2>/dev/null || printf '  %s: ' "$prompt"
      read -r value < "$TTY"
    fi
    [ -z "$value" ] && echo "  (required — try again)"
  done
  printf -v "$var" '%s' "$value"
}

echo "=== 0) EFS credentials (paste from Railway → fleetguardapi-production → Variables) ==="
echo "    Nothing typed here is written to disk or to your shell history."
ask EFS_SOAP_ENDPOINT_URL "SOAP endpoint URL (not the ?wsdl URL)"
ask EFS_SOAP_USERNAME     "SOAP username"
ask EFS_SOAP_PASSWORD     "SOAP password (hidden)" secret
echo

DAYS="${1:-7}"           # match the API: EFS_SOAP_MAX_DAYS_PER_REQUEST defaults to 7 (env.ts:259)
COOKIE_JAR="$(mktemp)"
LAST_HTTP=""
LAST_ERR=""
REJ_BYTES=0
trap 'rm -f "$COOKIE_JAR"' EXIT

# Optional mutual-TLS material, same env names the API uses (env.ts:299-309).
CURL_TLS=()
if [ -n "${EFS_SOAP_CLIENT_CERT_PEM_FILE:-}" ] && [ -n "${EFS_SOAP_CLIENT_KEY_PEM_FILE:-}" ]; then
  CURL_TLS=(--cert "$EFS_SOAP_CLIENT_CERT_PEM_FILE" --key "$EFS_SOAP_CLIENT_KEY_PEM_FILE")
  echo "(using client certificate $EFS_SOAP_CLIENT_CERT_PEM_FILE)"
fi
# ⚠ macOS ships bash 3.2, where "${arr[@]}" on an EMPTY array under `set -u` is an unbound-variable
# error. `${arr[@]+"${arr[@]}"}` expands to nothing when empty and to the quoted elements otherwise,
# on every bash from 3.2 up. Every expansion of CURL_TLS below must use this form.
tls_args() { printf '%s\n' ${CURL_TLS[@]+"${CURL_TLS[@]}"}; }

# Where the raw responses land, so we can inspect the actual bytes if the parser finds nothing.
RAW_DIR="${TMPDIR:-/tmp}/efs-rejects-diag.$$"
mkdir -p "$RAW_DIR"

xml_escape() { python3 -c 'import sys,xml.sax.saxutils as s;sys.stdout.write(s.escape(sys.argv[1],{"\"":"&quot;","\x27":"&apos;"}))' "$1"; }

# One SOAP call. $1 = SOAPAction / operation, $2 = operation body.
#
# Writes the response body to $RAW_DIR/<action>.xml and the HTTP status to $RAW_DIR/<action>.code,
# and prints NOTHING. Deliberately not "echo the body": callers used to wrap this in $(…), which
# runs it in a SUBSHELL — so any variable it set (the status code) was discarded the moment the
# substitution closed. Communicating through files keeps the status usable.
soap_call() {
  action="$1"; body="$2"
  curl -sS --max-time "${HTTP_TIMEOUT:-180}" ${CURL_TLS[@]+"${CURL_TLS[@]}"} \
    -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -H 'Content-Type: text/xml; charset="utf-8"' \
    -H "SOAPAction: $action" \
    -o "$RAW_DIR/$action.xml" -w '%{http_code}' \
    --data-binary "<?xml version=\"1.0\" encoding=\"UTF-8\"?><soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body>$body</soap:Body></soap:Envelope>" \
    "$EFS_SOAP_ENDPOINT_URL" > "$RAW_DIR/$action.code" 2> "$RAW_DIR/$action.err"
  LAST_HTTP="$(cat "$RAW_DIR/$action.code" 2>/dev/null || echo '?')"
  LAST_ERR="$(cat "$RAW_DIR/$action.err" 2>/dev/null || true)"
  [ -f "$RAW_DIR/$action.xml" ] || : > "$RAW_DIR/$action.xml"
}

echo "=== 0.5) connectivity to the endpoint ==="
echo "  URL: $EFS_SOAP_ENDPOINT_URL"
python3 - "$EFS_SOAP_ENDPOINT_URL" <<'PY'
import socket, ssl, sys, urllib.parse
url = sys.argv[1]
p = urllib.parse.urlparse(url)

if not p.scheme or not p.hostname:
    print(f"  ✗ not a usable URL: {url!r}")
    print("    Expected something like https://host.wexinc.com/path/CardManagementWS")
    sys.exit(0)
if "paste" in url or "example" in url or "your" in url.lower():
    print("  ✗ this still looks like the PLACEHOLDER from the .env.example.")
    print("    Put the real EFS_SOAP_ENDPOINT_URL in scripts/efs-rejects-diag.env.")
    sys.exit(0)

host = p.hostname
port = p.port or (443 if p.scheme == "https" else 80)
print(f"  host: {host}   port: {port}   scheme: {p.scheme}")

try:
    addrs = sorted({ai[4][0] for ai in socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)})
    print(f"  ✓ DNS resolves → {', '.join(addrs)}")
except Exception as e:
    print(f"  ✗ DNS FAILED: {e}")
    print("    The hostname is wrong, or this network cannot resolve it (VPN not connected?).")
    sys.exit(0)

try:
    with socket.create_connection((host, port), timeout=10):
        print(f"  ✓ TCP connect to {host}:{port}")
except Exception as e:
    print(f"  ✗ TCP connect FAILED: {e}")
    print("    Reachable name but no route/port — firewall, VPN, or WEX blocking this address.")
    sys.exit(0)

if p.scheme == "https":
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((host, port), timeout=10) as raw:
            with ctx.wrap_socket(raw, server_hostname=host) as tls:
                print(f"  ✓ TLS handshake ok ({tls.version()})")
    except ssl.SSLError as e:
        print(f"  ✗ TLS FAILED: {e}")
        print("    If this mentions a certificate being required, the endpoint wants mutual TLS —")
        print("    set EFS_SOAP_CLIENT_CERT_PEM_FILE / EFS_SOAP_CLIENT_KEY_PEM_FILE.")
    except Exception as e:
        print(f"  ✗ TLS FAILED: {e}")
PY
echo

echo "=== 1) login ==="
USER_X="$(xml_escape "$EFS_SOAP_USERNAME")"
PASS_X="$(xml_escape "$EFS_SOAP_PASSWORD")"
soap_call "login" "<CardManagementEP_login><user>$USER_X</user><password>$PASS_X</password></CardManagementEP_login>"
LOGIN_RES="$(cat "$RAW_DIR/login.xml")"

CLIENT_ID="$(printf '%s' "$LOGIN_RES" | python3 -c '
import sys,re
b=sys.stdin.read()
m=re.search(r"<(?:\w+:)?result[^>]*>([^<]*)</(?:\w+:)?result>",b)
print((m.group(1).strip() if m else ""))
')"

if [ -z "$CLIENT_ID" ]; then
  echo "LOGIN FAILED (HTTP ${LAST_HTTP:-?})."
  if [ -n "${LAST_ERR:-}" ]; then
    echo
    echo "curl said:"
    printf '  %s\n' "$LAST_ERR"
  fi
  if [ "${LAST_HTTP:-}" = "000" ]; then
    echo
    echo "HTTP 000 = the request never completed. It is a CONNECTION problem, not a credential"
    echo "problem — see section 0.5 above for which step failed."
  fi
  echo
  echo "Response body (faults are safe to share; no password is echoed back):"
  echo "----------------------------------------------------------------------"
  printf '%s\n' "$LOGIN_RES" | head -c 2000
  echo
  echo "----------------------------------------------------------------------"
  echo "raw copy: $RAW_DIR/login.xml"
  exit 1
fi
echo "ok — HTTP $LAST_HTTP, clientId acquired (${#CLIENT_ID} chars, not printed)"

# Timezone-aware; utcnow() is deprecated and printed a warning into the middle of the run.
win() { python3 -c "import datetime as d;print((d.datetime.now(d.timezone.utc)-d.timedelta(days=float('$1'))).strftime('%Y-%m-%dT%H:%M:%S.000Z'))"; }
START="$(win "$DAYS")"
END="$(win 0)"

echo
echo "=== 2) getTranRejects  ($START → $END) ==="
CID_X="$(xml_escape "$CLIENT_ID")"
# One attempt at a given window. Sets LAST_HTTP / LAST_ERR and leaves the body on disk.
fetch_rejects() {
  soap_call "getTranRejects" "<CardManagementEP_getTranRejects><clientId>$CID_X</clientId><search><startDate>$1</startDate><endDate>$2</endDate><cardNum></cardNum><invoice></invoice><locationId>0</locationId></search></CardManagementEP_getTranRejects>"
  REJ_BYTES="$(wc -c < "$RAW_DIR/getTranRejects.xml" | tr -d ' ')"
}

fetch_rejects "$START" "$END"
echo "HTTP $LAST_HTTP, $REJ_BYTES bytes"

# HTTP 000 / empty body here almost always means the query was too big for one round trip, not that
# the operation is broken — EFS streams these synchronously. Narrow the window and say so, rather
# than reporting "nothing" for what is really a timeout.
if [ "$LAST_HTTP" != "200" ] || [ "$REJ_BYTES" -eq 0 ]; then
  [ -n "${LAST_ERR:-}" ] && { echo; echo "curl said:"; printf '  %s\n' "$LAST_ERR"; }
  for narrow in 3 1; do
    echo
    echo "→ retrying with a ${narrow}-day window (the wider one did not come back)"
    NSTART="$(win "$narrow")"
    echo "   $NSTART → $END"
    fetch_rejects "$NSTART" "$END"
    echo "   HTTP $LAST_HTTP, $REJ_BYTES bytes"
    [ "$LAST_HTTP" = "200" ] && [ "$REJ_BYTES" -gt 0 ] && break
    [ -n "${LAST_ERR:-}" ] && printf '   curl said: %s\n' "$LAST_ERR"
  done
fi

if [ "$LAST_HTTP" != "200" ] || [ "$REJ_BYTES" -eq 0 ]; then
  echo
  echo "Every window failed. This is a transport problem, not a field-mapping question:"
  echo "  • timeout (curl 28)  → raise it:  HTTP_TIMEOUT=600 bash scripts/efs-rejects-diag.sh 1"
  echo "  • reset/EOF          → EFS refused this query shape or this source address"
  echo "  • the API polls this same operation every 5 min from Railway, so running it there"
  echo "    settles whether the address is the difference:"
  echo "      railway ssh --service @fleetguard/api"
  echo "      bash scripts/efs-rejects-diag.sh 1"
  exit 1
fi


echo
echo "=== 3) WHAT EFS ACTUALLY RETURNS ==="
cat > "$RAW_DIR/analyze.py" <<'PY'
import sys, re
from xml.dom.minidom import parseString

raw = open(sys.argv[1], encoding="utf-8", errors="replace").read()

fault = re.search(r"<(?:\w+:)?faultstring[^>]*>(.*?)</(?:\w+:)?faultstring>", raw, re.S)
if fault:
    print("SOAP FAULT:", fault.group(1).strip()[:500])
    print("\nIf this is 'Not Allowed <ref>', quote that reference to WEX — per")
    print("docs/22-EFS-CARD-CONTROL.md that is an IP-allowlist refusal, not an entitlement one.")
    sys.exit(0)

try:
    doc = parseString(raw)
except Exception as e:
    print("Response is not parseable XML:", e)
    print(raw[:1500])
    sys.exit(1)

def local(node):
    return node.nodeName.split(":")[-1]

def children(node):
    return [c for c in node.childNodes if c.nodeType == 1]

# Every <value> under a <result> — the record shape both feeds use.
records = []
for result in doc.getElementsByTagName("*"):
    if local(result) == "result":
        for v in children(result):
            if local(v) == "value":
                records.append(v)
if not records:
    for v in doc.getElementsByTagName("*"):
        if local(v) == "value" and children(v):
            records.append(v)

print(f"records returned: {len(records)}")
if not records:
    # Do NOT stop here. Zero records can mean "no declines in the window" OR "the response nests
    # them somewhere this script did not look" — and those need opposite responses. Print the
    # actual element tree so we can tell which it is.
    print("\nNo <result><value> records matched. Here is the response's element tree instead,")
    print("so we can see what the vendor DID send (repeats collapsed):\n")

    def tree(node, depth=0, seen=None):
        if depth > 9:
            return
        seen = seen if seen is not None else set()
        for c in children(node):
            key = (depth, local(c))
            label = "  " * depth + local(c)
            if key in seen:
                continue
            seen.add(key)
            text = (c.firstChild.nodeValue.strip()[:60]
                    if c.firstChild and c.firstChild.nodeValue and not children(c) else "")
            if text and re.search(r"\d{8,}", text):
                text = re.sub(r"\d{8,}", lambda m: "*" * (len(m.group()) - 4) + m.group()[-4:], text)
            print(f"  {label}" + (f" = {text!r}" if text else ""))
            tree(c, depth + 1, seen)

    tree(doc)
    print("\nIf this shows only an empty envelope, the window genuinely held no declines — widen it:")
    print("  bash scripts/efs-rejects-diag.sh 30")
    sys.exit(0)

def walk(node, prefix=""):
    """Every leaf path under a record, so nested arrays (e.g. <infos>) are not missed."""
    out = []
    kids = children(node)
    if not kids:
        text = (node.firstChild.nodeValue.strip() if node.firstChild and node.firstChild.nodeValue else "")
        nil = node.getAttribute("xsi:nil") == "true" or node.getAttribute("nil") == "true"
        out.append((prefix or local(node), "" if nil else text))
        return out
    for k in kids:
        out.extend(walk(k, f"{prefix}.{local(k)}" if prefix else local(k)))
    return out

# UNION across every record — a field null on record 1 may carry a value on record 7.
seen, populated = {}, {}
for r in records:
    for path, val in walk(r):
        seen[path] = seen.get(path, 0) + 1
        if val:
            populated[path] = populated.get(path, 0) + 1

print(f"\n--- every element path present, and how many records carry a VALUE ---")
width = max(len(p) for p in seen)
for path in sorted(seen):
    print(f"  {path.ljust(width)}   present {seen[path]:>3}   populated {populated.get(path,0):>3}")

DRIVERISH = re.compile(r"driv|drid|info|prompt|employee|(?<!loc)name", re.I)
hits = [p for p in sorted(seen) if DRIVERISH.search(p)]
print("\n--- driver-ish paths ---")
if hits:
    for p in hits:
        print(f"  ★ {p}   (populated on {populated.get(p,0)}/{len(records)} records)")
    print("\n  → Map these in rejectedRows() (apps/api/src/lib/efsSoap.ts:199) instead of the")
    print("    hardcoded nulls at lines 212-213.")
else:
    print("  none. getTranRejects genuinely omits driver identity; resolve it from the")
    print("  efs_cards mirror (card_ref_hmac → driver_name) instead.")

def mask(v):
    d = re.sub(r"\D", "", v)
    return ("*" * max(0, len(d) - 4)) + d[-4:] if len(d) >= 8 else v

print("\n--- first record, values (card numbers masked) ---")
for path, val in walk(records[0]):
    shown = mask(val) if re.search(r"card", path, re.I) else val
    print(f"  {path.ljust(width)} = {shown!r}")
PY
python3 "$RAW_DIR/analyze.py" "$RAW_DIR/getTranRejects.xml"

echo
echo "=== 4) logout ==="
soap_call "logout" "<CardManagementEP_logout><clientId>$CID_X</clientId></CardManagementEP_logout>"
echo "done"

# A masked copy of the raw reject response, for when the summary above is not enough. Card numbers
# are reduced to their last 4 in place; nothing else is altered, so element names survive verbatim.
MASKED="$RAW_DIR/getTranRejects.masked.xml"
python3 - "$RAW_DIR/getTranRejects.xml" "$MASKED" <<'PY'
import re, sys
src, dst = sys.argv[1], sys.argv[2]
xml = open(src, encoding="utf-8", errors="replace").read()
# Any run of 8+ digits is a card number or an id — keep the last 4 so rows stay distinguishable.
open(dst, "w", encoding="utf-8").write(re.sub(r"\d{8,}", lambda m: "*" * (len(m.group()) - 4) + m.group()[-4:], xml))
PY

echo
echo "Section 3 is safe to share as-is — no password, no full card numbers."
echo "If it is not conclusive, share this masked raw response instead:"
echo "  $MASKED"
