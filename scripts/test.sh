#!/usr/bin/env bash
# Runs the unit tests. Works with either Xcode or only the Command Line Tools installed.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

developer_dir="$(xcode-select -p)"
frameworks="$developer_dir/Library/Developer/Frameworks"
libraries="$developer_dir/Library/Developer/usr/lib"

exec swift test \
  -Xswiftc -F -Xswiftc "$frameworks" \
  -Xlinker -rpath -Xlinker "$frameworks" \
  -Xlinker -rpath -Xlinker "$libraries" \
  "$@"
