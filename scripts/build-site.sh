#!/usr/bin/env bash
#
# Assembles the static website (GitHub Pages): the editor itself — the app's web page, which runs
# in a browser as the web edition — served at the site's root.
#
#   scripts/build-site.sh [output directory]     (default: .site)
#
# Preview it with:  python3 -m http.server --directory .site
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/.site}"

rm -rf "$OUT"
cp -R "$ROOT/Sources/VisualTypist/Resources/Web" "$OUT"
cp "$ROOT/Resources/AppIcon.png" "$OUT/favicon.png"
cp "$ROOT/LICENSE" "$ROOT/THIRD_PARTY_NOTICES.md" "$OUT/"

# The editor used to live at /editor/; links to it now land on the site's root.
mkdir -p "$OUT/editor"
cat > "$OUT/editor/index.html" <<'HTML'
<!doctype html>
<meta charset="utf-8">
<title>Visual Typist</title>
<meta http-equiv="refresh" content="0; url=../">
<link rel="canonical" href="../">
<a href="../">Visual Typist</a>
HTML

touch "$OUT/.nojekyll" # Serve files as they are (no Jekyll processing).

echo "Website assembled in $OUT"
