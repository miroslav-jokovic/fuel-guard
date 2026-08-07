#!/usr/bin/env bash
# Generate the ONE Android release keystore for FuelGuard Driver (ship-pipeline plan D1.1).
#
# Run this exactly once, ever. Android identifies an app by its signing key: if this key is lost or
# replaced, no existing install can be upgraded — every tester and every driver must uninstall first,
# losing their local encrypted outbox. Back the file up somewhere that is not GitHub and not this
# repository (a password manager attachment is fine; the repo is not).
#
#   bash scripts/gen-android-keystore.sh
#
# It prints the four GitHub Actions secrets to set. Nothing is written into the repository.
set -euo pipefail

OUT="${1:-$HOME/fuelguard-release.keystore}"
ALIAS="fuelguard-driver"
VALIDITY_DAYS=10950 # 30 years — outliving the key is a worse problem than a long-lived key here

if [ -e "$OUT" ]; then
  echo "✗ $OUT already exists. Refusing to overwrite a signing key." >&2
  exit 1
fi

command -v keytool >/dev/null || { echo "✗ keytool not found — install a JDK (e.g. Temurin 17)." >&2; exit 1; }

echo "Choose a strong password. You will need it again for the GitHub secrets."
read -r -s -p "Keystore password: " PASS; echo
read -r -s -p "Confirm: " PASS2; echo
[ "$PASS" = "$PASS2" ] || { echo "✗ Passwords do not match." >&2; exit 1; }
[ ${#PASS} -ge 12 ] || { echo "✗ Use at least 12 characters." >&2; exit 1; }

keytool -genkeypair -v \
  -keystore "$OUT" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 4096 \
  -validity "$VALIDITY_DAYS" \
  -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=FuelGuard Driver, OU=Fleet, O=Silvicom, L=Chicago, S=Illinois, C=US"

echo
echo "✓ Created $OUT"
echo
echo "Set these four repository secrets (Settings → Secrets and variables → Actions):"
echo
echo "  ANDROID_KEYSTORE_BASE64   (paste the output of the command below)"
echo "  ANDROID_KEYSTORE_PASSWORD $PASS"
echo "  ANDROID_KEY_ALIAS         $ALIAS"
echo "  ANDROID_KEY_PASSWORD      $PASS"
echo
echo "Base64 of the keystore:"
echo "  base64 -i \"$OUT\" | tr -d '\\n' | pbcopy   # macOS, copies to clipboard"
echo
echo "Then back up $OUT somewhere outside this repository and outside GitHub."
