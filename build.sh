#!/usr/bin/env bash
#
# Builds "Visual Typist.app" for Apple Silicon Macs into the current directory.
#
# The script first checks the toolchain and offers to install anything that is missing.
#
#   ./build.sh            check the environment, then build
#   ./build.sh --yes      answer yes to every setup question (non-interactive)
#   ./build.sh --check    only check the environment
#   ./build.sh --clean    remove previous build products first
#
set -euo pipefail

readonly APP_NAME="Visual Typist"
readonly EXECUTABLE="VisualTypist"
readonly BUNDLE_ID="io.github.visualtypist.VisualTypist"
readonly VERSION="1.0.0"
readonly MIN_MACOS="14.0"
readonly MIN_SWIFT="6.0"

# Apple's tools by absolute path: other packages (e.g. Anaconda) ship incompatible "codesign" commands.
readonly CODESIGN=/usr/bin/codesign DITTO=/usr/bin/ditto PLUTIL=/usr/bin/plutil LIPO=/usr/bin/lipo

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$PWD"
WEB_DIR="$ROOT/Sources/VisualTypist/Resources/Web"

assume_yes=false
check_only=false
clean=false

for arg in "$@"; do
  case "$arg" in
    -y|--yes) assume_yes=true ;;
    --check) check_only=true ;;
    --clean) clean=true ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- output helpers

if [[ -t 1 ]]; then
  bold=$'\033[1m'; green=$'\033[32m'; yellow=$'\033[33m'; red=$'\033[31m'; reset=$'\033[0m'
else
  bold=""; green=""; yellow=""; red=""; reset=""
fi
step() { printf '%s==>%s %s\n' "$bold" "$reset" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '  %s!%s %s\n' "$yellow" "$reset" "$*"; }
die()  { printf '%serror:%s %s\n' "$red" "$reset" "$*" >&2; exit 1; }

# Asks a yes/no question. Defaults to "no" when there is no terminal to ask on.
confirm() {
  if $assume_yes; then return 0; fi
  if [[ ! -t 0 ]]; then return 1; fi
  local reply
  read -r -p "  $1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]([Ee][Ss])?$ ]]
}

# Succeeds when version $1 >= version $2.
version_at_least() {
  [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -n1)" == "$2" ]]
}

# ---------------------------------------------------------------- environment checks

check_platform() {
  [[ "$(uname -s)" == "Darwin" ]] || die "Visual Typist builds on macOS only."
  local arch
  arch="$(uname -m)"
  if [[ "$arch" != "arm64" ]]; then
    if [[ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" == "1" ]]; then
      die "This shell is running under Rosetta. Open a native (arm64) terminal and run ./build.sh again."
    fi
    die "This Mac is $arch; Visual Typist currently targets Apple Silicon (arm64) only."
  fi
  ok "Apple Silicon ($arch)"

  local macos
  macos="$(sw_vers -productVersion)"
  version_at_least "$macos" "$MIN_MACOS" || die "macOS $MIN_MACOS or later is required (this Mac has $macos)."
  ok "macOS $macos"
}

install_command_line_tools() {
  confirm "Install the Xcode Command Line Tools now?" ||
    die "The Xcode Command Line Tools are required. Install them with: xcode-select --install"
  xcode-select --install 2>/dev/null || true
  echo "  A system dialog will guide the installation. Waiting for it to finish…"
  until xcode-select -p >/dev/null 2>&1 && xcrun --find swift >/dev/null 2>&1; do
    sleep 10
  done
}

update_command_line_tools() {
  confirm "Update the Command Line Tools with Software Update? (needs your password)" ||
    die "Swift $MIN_SWIFT or later is required. Update Xcode or the Command Line Tools and try again."
  local label
  label="$(softwareupdate --list 2>/dev/null | sed -n 's/^\* Label: \(Command Line Tools.*\)$/\1/p' | tail -n1)"
  [[ -n "$label" ]] || die "Software Update offers no Command Line Tools update. Install the latest Xcode from the App Store instead."
  sudo softwareupdate --install "$label" --verbose
}

check_toolchain() {
  if ! xcode-select -p >/dev/null 2>&1 || ! xcrun --find swift >/dev/null 2>&1; then
    warn "The Xcode Command Line Tools are not installed."
    install_command_line_tools
  fi
  ok "Developer tools at $(xcode-select -p)"

  local output
  if ! output="$(swift --version 2>&1)"; then
    if [[ "$output" == *license* ]]; then
      warn "The Xcode license has not been accepted."
      confirm "Accept the Xcode license now? (needs your password)" || die "Accept it with: sudo xcodebuild -license accept"
      sudo xcodebuild -license accept
      output="$(swift --version 2>&1)" || die "Swift still fails to run:\n$output"
    else
      die "Swift fails to run:\n$output"
    fi
  fi

  local swift_version
  swift_version="$(sed -n 's/.*Swift version \([0-9][0-9.]*\).*/\1/p' <<<"$output" | head -n1)"
  [[ -n "$swift_version" ]] || die "Could not determine the Swift version from:\n$output"
  if ! version_at_least "$swift_version" "$MIN_SWIFT"; then
    warn "Swift $swift_version is too old; $MIN_SWIFT or later is required."
    update_command_line_tools
    swift_version="$(swift --version 2>&1 | sed -n 's/.*Swift version \([0-9][0-9.]*\).*/\1/p' | head -n1)"
    version_at_least "$swift_version" "$MIN_SWIFT" || die "Swift is still $swift_version after the update."
  fi
  ok "Swift $swift_version"

  local tool
  for tool in "$CODESIGN" "$DITTO" "$PLUTIL" "$LIPO"; do
    [[ -x "$tool" ]] || die "$tool is missing; it ships with macOS and the developer tools."
  done
  ok "codesign, ditto, plutil, lipo"
}

vendor_assets_present() {
  [[ -s "$WEB_DIR/vendor/mathlive/mathlive.min.js" &&
     -s "$WEB_DIR/vendor/mathjax/tex-svg-full.js" &&
     -n "$(ls "$WEB_DIR/vendor/mathlive/fonts/"*.woff2 2>/dev/null)" ]]
}

ensure_node() {
  command -v npm >/dev/null 2>&1 && return 0
  warn "Node.js (npm) is needed to download the math engines."
  if ! command -v brew >/dev/null 2>&1; then
    confirm "Install Homebrew (https://brew.sh) to get Node.js?" ||
      die "Install Node.js from https://nodejs.org and run ./build.sh again."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
  confirm "Install Node.js with Homebrew?" || die "Install Node.js from https://nodejs.org and run ./build.sh again."
  brew install node
}

check_dependencies() {
  if vendor_assets_present; then
    ok "MathLive $(sed -n 's/.*"mathlive": "\(.*\)".*/\1/p' "$WEB_DIR/vendor/versions.json") and MathJax $(sed -n 's/.*"mathjax": "\(.*\)".*/\1/p' "$WEB_DIR/vendor/versions.json") (bundled)"
    return
  fi
  warn "The bundled math engines are missing from $WEB_DIR/vendor."
  confirm "Download them with npm now?" || die "Run scripts/update-vendor.sh to restore them."
  ensure_node
  "$ROOT/scripts/update-vendor.sh"
  vendor_assets_present || die "The math engines are still missing after the download."
  ok "Math engines restored"
}

# ---------------------------------------------------------------- build

write_info_plist() {
  cat >"$1" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>$EXECUTABLE</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>LSArchitecturePriority</key><array><string>arm64</string></array>
  <key>LSMinimumSystemVersion</key><string>$MIN_MACOS</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHumanReadableCopyright</key><string>Released under the MIT License.</string>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>Visual Typist Equation</string>
      <key>CFBundleTypeRole</key><string>Editor</string>
      <key>LSHandlerRank</key><string>Owner</string>
      <key>LSItemContentTypes</key><array><string>io.github.visualtypist.equation</string></array>
    </dict>
  </array>
  <key>UTExportedTypeDeclarations</key>
  <array>
    <dict>
      <key>UTTypeIdentifier</key><string>io.github.visualtypist.equation</string>
      <key>UTTypeDescription</key><string>Visual Typist Equation</string>
      <key>UTTypeConformsTo</key><array><string>public.json</string></array>
      <key>UTTypeTagSpecification</key>
      <dict><key>public.filename-extension</key><array><string>vteq</string></array></dict>
    </dict>
  </array>
</dict>
</plist>
PLIST
  "$PLUTIL" -lint -s "$1"
}

build_app() {
  cd "$ROOT"
  if $clean; then
    step "Cleaning previous build products"
    rm -rf .build "$OUT_DIR/$APP_NAME.app"
  fi

  step "Compiling (release, arm64)"
  swift build --configuration release --arch arm64 --product "$EXECUTABLE"
  local bin_dir
  bin_dir="$(swift build --configuration release --arch arm64 --show-bin-path)"

  step "Assembling $APP_NAME.app"
  staging="$(mktemp -d)"
  trap 'rm -rf "$staging"' EXIT
  local contents="$staging/$APP_NAME.app/Contents"
  mkdir -p "$contents/MacOS" "$contents/Resources"
  cp "$bin_dir/$EXECUTABLE" "$contents/MacOS/$EXECUTABLE"
  "$DITTO" "$WEB_DIR" "$contents/Resources/Web"
  cp "$ROOT/Resources/AppIcon.icns" "$contents/Resources/AppIcon.icns"
  cp "$ROOT/LICENSE" "$ROOT/THIRD_PARTY_NOTICES.md" "$contents/Resources/"
  write_info_plist "$contents/Info.plist"

  step "Signing (ad hoc)"
  "$CODESIGN" --force --sign - --timestamp=none "$staging/$APP_NAME.app"
  "$CODESIGN" --verify --strict "$staging/$APP_NAME.app"

  rm -rf "${OUT_DIR:?}/$APP_NAME.app"
  "$DITTO" "$staging/$APP_NAME.app" "$OUT_DIR/$APP_NAME.app"
  ok "Built $OUT_DIR/$APP_NAME.app ($("$LIPO" -archs "$OUT_DIR/$APP_NAME.app/Contents/MacOS/$EXECUTABLE"))"
  echo
  echo "Run it with:   open \"$OUT_DIR/$APP_NAME.app\""
  echo "Install with:  $ROOT/install.sh"
}

step "Checking the build environment"
check_platform
check_toolchain
check_dependencies
$check_only && { ok "The environment is ready."; exit 0; }
build_app
