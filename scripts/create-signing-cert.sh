#!/bin/zsh
set -euo pipefail

# Create a persistent self-signed code-signing identity in the login keychain.
#
# Why: Triad is distributed unsigned/ad-hoc.  macOS ties folder and
# "other app data" (TCC) permissions to an app's code-signing identity.
# An ad-hoc signature changes on every build, so macOS re-prompts after each
# rebuild/update.  Signing every build with the SAME self-signed certificate
# gives a stable identity, so a granted permission sticks across rebuilds.
#
# This does NOT make the app notarized or Gatekeeper-trusted — first launch
# still needs the usual right-click > Open.  It only stabilizes TCC.
#
# Run once:
#   zsh scripts/create-signing-cert.sh
# Then build with:
#   export TRIAD_SIGN_IDENTITY="Triad Self-Signed"
#   zsh scripts/package-app.sh
#
# Usage: create-signing-cert.sh [identity-name]

name="${1:-Triad Self-Signed}"
keychain="$HOME/Library/Keychains/login.keychain-db"

if security find-identity -p codesigning "$keychain" 2>/dev/null | grep -qF "$name"; then
  echo "이미 '$name' 코드 서명 인증서가 있습니다. 다음으로 빌드하세요:"
  echo "  export TRIAD_SIGN_IDENTITY=\"$name\""
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Self-signed cert with a code-signing EKU so codesign will accept it.
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$tmp/key.pem" -out "$tmp/cert.pem" \
  -subj "/CN=$name" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" >/dev/null 2>&1

# -legacy forces SHA1-MAC/3DES so macOS `security import` can read the bundle;
# OpenSSL 3's modern default (AES/SHA256) fails MAC verification on import.
# A throwaway transport password avoids empty-password quirks.
openssl pkcs12 -export -legacy -out "$tmp/identity.p12" \
  -inkey "$tmp/key.pem" -in "$tmp/cert.pem" -passout pass:triad >/dev/null 2>&1

# Import the identity and let codesign use its private key without prompting.
security import "$tmp/identity.p12" -k "$keychain" -P "triad" \
  -T /usr/bin/codesign >/dev/null

# Trust the cert for code signing in the login keychain (may prompt for your
# login password).  Trust is not required for TCC persistence, but it makes the
# identity show up as valid to tools that filter on trust.
security add-trusted-cert -d -r trustAsRoot \
  -p codeSign -k "$keychain" "$tmp/cert.pem" >/dev/null 2>&1 || \
  echo "참고: 신뢰 설정은 건너뛰었습니다(서명·TCC에는 영향 없음)." >&2

echo "✅ 코드 서명 인증서 '$name' 생성 완료."
echo "이제 이렇게 빌드하면 재빌드/업데이트해도 권한이 유지됩니다:"
echo "  export TRIAD_SIGN_IDENTITY=\"$name\""
echo "  zsh scripts/package-app.sh"
