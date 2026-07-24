#!/bin/zsh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
output="${1:-$root/dist}"
app="$output/Triad.app"

cd "$root"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
mkdir -p "$root/.module-cache"
python3 "$root/scripts/build-icns.py" "$root/Resources/AppIcon-v4.png" "$root/Resources/Triad.icns"
clang -fobjc-arc -fmodules -fmodules-cache-path="$root/.module-cache" -O2 \
  -framework Cocoa -framework WebKit -framework Security -framework UserNotifications -framework CoreServices \
  -lsqlite3 \
  "$root/Native/main.m" -o "$app/Contents/MacOS/Triad"
cp "$root/Resources/Info.plist" "$app/Contents/Info.plist"
cp "$root/Resources/PkgInfo" "$app/Contents/PkgInfo"
cp "$root/Resources/index.html" "$app/Contents/Resources/index.html"
cp "$root/Resources/router.js" "$app/Contents/Resources/router.js"
cp "$root/Resources/collaboration.js" "$app/Contents/Resources/collaboration.js"
cp "$root/Resources/shared-context.js" "$app/Contents/Resources/shared-context.js"
cp "$root/Resources/linkify.js" "$app/Contents/Resources/linkify.js"
cp "$root/Resources/diff.js" "$app/Contents/Resources/diff.js"
cp "$root/Resources/queue.js" "$app/Contents/Resources/queue.js"
cp "$root/Resources/recent-context.js" "$app/Contents/Resources/recent-context.js"
cp "$root/Resources/run-reference.js" "$app/Contents/Resources/run-reference.js"
cp "$root/Resources/conversation-order.js" "$app/Contents/Resources/conversation-order.js"
cp "$root/Resources/usage.js" "$app/Contents/Resources/usage.js"
cp "$root/Resources/session-budget.js" "$app/Contents/Resources/session-budget.js"
cp "$root/Resources/file-search.js" "$app/Contents/Resources/file-search.js"
cp "$root/Resources/file-lock.cjs" "$app/Contents/Resources/file-lock.cjs"
cp "$root/Resources/triad-mcp-server.cjs" "$app/Contents/Resources/triad-mcp-server.cjs"
cp "$root/Resources/version.js" "$app/Contents/Resources/version.js"
cp "$root/Resources/Triad.icns" "$app/Contents/Resources/Triad.icns"
chmod +x "$app/Contents/MacOS/Triad"

touch "$app"

# A stable signing identity keeps macOS TCC grants (folder / "other app data"
# access) attached across rebuilds and updates.  Ad-hoc signatures get a new
# cdhash every build, so macOS treats each build as a new app and re-prompts.
# Set TRIAD_SIGN_IDENTITY to a code-signing identity in your keychain
# (see scripts/create-signing-cert.sh) to opt in; otherwise we fall back to
# ad-hoc signing with a warning.
identity="${TRIAD_SIGN_IDENTITY:-}"
if [[ -n "$identity" ]] && security find-identity -p codesigning 2>/dev/null | grep -qF "$identity"; then
  echo "codesign: stable identity '$identity'"
  codesign --force --deep --sign "$identity" "$app"
else
  if [[ -n "$identity" ]]; then
    echo "codesign: identity '$identity' not found in keychain — falling back to ad-hoc." >&2
  else
    echo "codesign: TRIAD_SIGN_IDENTITY unset — ad-hoc signing (TCC permissions reset each build)." >&2
    echo "          Run scripts/create-signing-cert.sh once for a stable identity." >&2
  fi
  codesign --force --deep --sign - "$app"
fi
echo "$app"
