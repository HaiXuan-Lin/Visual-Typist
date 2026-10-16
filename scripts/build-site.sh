#!/usr/bin/env bash
#
# Assembles the static website (GitHub Pages): the landing page from site/, the screenshots and
# icon, and the editor itself — the app's web page, which runs in a browser as the web edition.
#
#   scripts/build-site.sh [output directory]     (default: .site)
#
# Preview it with:  python3 -m http.server --directory .site
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/.site}"

rm -rf "$OUT"
mkdir -p "$OUT/assets"
cp "$ROOT/site/index.html" "$OUT/index.html"
cp "$ROOT/Resources/AppIcon.png" "$ROOT/Einstein-equation.png" "$ROOT/Schrodinger-equation.png" "$OUT/assets/"
cp -R "$ROOT/Sources/VisualTypist/Resources/Web" "$OUT/editor"
cp "$ROOT/Resources/AppIcon.png" "$OUT/editor/favicon.png"
cp "$ROOT/LICENSE" "$ROOT/THIRD_PARTY_NOTICES.md" "$OUT/"
touch "$OUT/.nojekyll" # Serve files as they are (no Jekyll processing).

echo "Website assembled in $OUT"
