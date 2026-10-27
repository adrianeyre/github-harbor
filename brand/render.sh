#!/usr/bin/env bash
# Renders the social preview and the app icons in public/ from brand/*.html.
#
#   bash brand/render.sh
#
# Needs `npm ci` first (for the fonts), a Chromium-based browser (set BROWSER if
# it isn't found) and ImageMagick's `magick` for the small icons. Headless
# Chromium won't make a window smaller than ~500px, so small icons are scaled
# down from the 512px one rather than screenshotted.
set -euo pipefail
cd "$(dirname "$0")/.."

BROWSER=${BROWSER:-$(command -v chromium || command -v google-chrome || command -v microsoft-edge ||
  echo "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe")}
# Chromium on Windows wants C:/ paths, not Git Bash's /c/ ones.
ROOT=$(cygpath -m "$PWD" 2>/dev/null || echo "$PWD")
PROFILE=$(mktemp -d)
trap 'rm -rf "$PROFILE"' EXIT

shot() { # html, output, width, height
  "$BROWSER" --headless --disable-gpu --no-sandbox --hide-scrollbars --allow-file-access-from-files \
    --force-device-scale-factor=1 --user-data-dir="$(cygpath -m "$PROFILE" 2>/dev/null || echo "$PROFILE")" \
    --no-first-run --window-size="$3,$4" --screenshot="$ROOT/$2" "file:///${ROOT#/}/$1" >/dev/null 2>&1
  echo "Wrote $2"
}

shot brand/og-image.html public/og-image.png 1200 630
shot brand/icon.html public/icon-512.png 512 512
for size in 32:favicon-32 180:apple-touch-icon 192:icon-192; do
  magick public/icon-512.png -resize "${size%%:*}x${size%%:*}" "public/${size#*:}.png"
  echo "Wrote public/${size#*:}.png"
done
