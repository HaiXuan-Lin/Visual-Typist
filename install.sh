#!/usr/bin/env bash
#
# Installs "Visual Typist.app" (built by ./build.sh) into /Applications.
#
#   ./install.sh              install, building first if needed
#   ./install.sh --open       install, then launch the app
#   ./install.sh --uninstall  remove the app from /Applications
#   ./install.sh --app PATH   install that build (build.sh --install passes its own)
#
set -euo pipefail

readonly APP_NAME="Visual Typist"
readonly EXECUTABLE="VisualTypist"
readonly DEST_DIR="/Applications"
readonly LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
open_after=false
uninstall=false
given_app=""

while (( $# > 0 )); do
  case "$1" in
    --open) open_after=true ;;
    --uninstall) uninstall=true ;;
    --app) shift; given_app="${1:-}"; [[ -n "$given_app" ]] || { echo "--app needs a path" >&2; exit 2; } ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
confirm() {
  [[ -t 0 ]] || return 1
  local reply
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]([Ee][Ss])?$ ]]
}

# Runs a command with sudo only when the destination is not writable by this user.
as_needed() {
  if [[ -w "$DEST_DIR" ]]; then "$@"; else sudo "$@"; fi
}

quit_running_app() {
  pgrep -x "$EXECUTABLE" >/dev/null 2>&1 || return 0
  echo "$APP_NAME is running; quitting it (you will be asked to save unsaved work)…"
  osascript -e "tell application id \"io.github.visualtypist.VisualTypist\" to quit" >/dev/null 2>&1 || true
  for _ in {1..30}; do
    pgrep -x "$EXECUTABLE" >/dev/null 2>&1 || return 0
    sleep 1
  done
  die "$APP_NAME is still running. Quit it and run ./install.sh again."
}

target="$DEST_DIR/$APP_NAME.app"

if $uninstall; then
  [[ -d "$target" ]] || { echo "$APP_NAME is not installed."; exit 0; }
  quit_running_app
  as_needed rm -rf "$target"
  echo "Removed $target"
  echo "Your shortcuts remain in ~/Library/Application Support/Visual Typist."
  exit 0
fi

# Prefer a build in the current directory (where build.sh writes), then one next to this script.
source_app=""
for candidate in ${given_app:+"$given_app"} "$PWD/$APP_NAME.app" "$ROOT/$APP_NAME.app"; do
  if [[ -x "$candidate/Contents/MacOS/$EXECUTABLE" ]]; then source_app="$candidate"; break; fi
done

if [[ -z "$source_app" ]]; then
  echo "No built $APP_NAME.app found."
  confirm "Build it now with ./build.sh?" || die "Run ./build.sh first."
  "$ROOT/build.sh"
  source_app="$PWD/$APP_NAME.app"
  [[ -x "$source_app/Contents/MacOS/$EXECUTABLE" ]] || die "The build did not produce $source_app."
fi

/usr/bin/codesign --verify --strict "$source_app" 2>/dev/null || die "$source_app is damaged or unsigned; rebuild it with ./build.sh."

quit_running_app
echo "Installing $source_app → $target"
as_needed rm -rf "$target"
as_needed /usr/bin/ditto "$source_app" "$target"
as_needed xattr -dr com.apple.quarantine "$target" 2>/dev/null || true
"$LSREGISTER" -f "$target" >/dev/null 2>&1 || true
echo "Installed $APP_NAME $(defaults read "$target/Contents/Info" CFBundleShortVersionString 2>/dev/null || true)."

if $open_after; then open "$target"; fi
