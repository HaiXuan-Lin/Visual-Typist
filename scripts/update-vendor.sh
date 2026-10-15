#!/bin/sh
# Downloads the math engines pinned in package.json and copies them into the app's web resources.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
WEB="$ROOT/Sources/VisualTypist/Resources/Web/vendor"
cd "$ROOT"

npm install --no-save --no-audit --no-fund --ignore-scripts

rm -rf "$WEB/mathlive" "$WEB/mathjax"
mkdir -p "$WEB/mathlive/fonts" "$WEB/mathjax"
cp node_modules/mathlive/mathlive.min.js node_modules/mathlive/mathlive-fonts.css "$WEB/mathlive/"
cp node_modules/mathlive/LICENSE.txt "$WEB/mathlive/LICENSE.txt"
cp node_modules/mathlive/fonts/*.woff2 "$WEB/mathlive/fonts/"
cp node_modules/mathjax-full/es5/tex-svg-full.js "$WEB/mathjax/"
cp node_modules/mathjax-full/LICENSE "$WEB/mathjax/LICENSE.txt"

# Local fixes to the bundled engines (see scripts/patches).
python3 "$ROOT/scripts/patches/mathlive-boldsymbol.py" "$WEB/mathlive/mathlive.min.js"
python3 "$ROOT/scripts/patches/mathlive-scripts.py" "$WEB/mathlive/mathlive.min.js"

node -e '
const fs = require("fs");
const version = name => require(`./node_modules/${name}/package.json`).version;
fs.writeFileSync(process.argv[1], JSON.stringify({ mathlive: version("mathlive"), mathjax: version("mathjax-full") }, null, 2) + "\n");
' "$WEB/versions.json"

echo "Math engines updated in $WEB"
