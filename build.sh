#!/usr/bin/env bash
#
# Builds "Visual Typist.app" for Apple Silicon Macs into the current directory.
#
# It first checks the machine and repairs what it can: missing or broken developer tools, the
# Xcode license and first-launch setup, the macOS SDK, a stale build cache, damaged or missing
# math engines (downloaded again, with Node.js if needed), and the app icon. Anything that needs
# your password or a download is asked first.
#
#   ./build.sh               check and repair the environment, then build
#   ./build.sh --yes         answer yes to every question (non-interactive, e.g. for CI)
#   ./build.sh --install     also install the app into /Applications and open it
#   ./build.sh --test        also run the unit tests before building
#   ./build.sh --check       only check (and repair) the environment
#   ./build.sh --clean       remove previous build products first
#
set -euo pipefail

readonly APP_NAME="Visual Typist"
readonly EXECUTABLE="VisualTypist"
readonly BUNDLE_ID="io.github.visualtypist.VisualTypist"
readonly VERSION="1.13.1"
readonly MIN_MACOS="14.0"
readonly MIN_SDK="14.0"
readonly MIN_SWIFT="6.0"
readonly MIN_NODE="18"
readonly MIN_FREE_MB=1500
readonly CLT_DIR="/Library/Developer/CommandLineTools"

# Apple's tools by absolute path: other packages (e.g. Anaconda) ship incompatible "codesign" commands.
readonly CODESIGN=/usr/bin/codesign DITTO=/usr/bin/ditto PLUTIL=/usr/bin/plutil LIPO=/usr/bin/lipo SHASUM=/usr/bin/shasum

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$PWD"
WEB_DIR="$ROOT/Sources/VisualTypist/Resources/Web"
VENDOR_DIR="$WEB_DIR/vendor"
LOG_FILE="$OUT_DIR/build.log"

assume_yes=false
check_only=false
clean=false
install_after=false
run_tests=false

for arg in "$@"; do
  case "$arg" in
    -y|--yes) assume_yes=true ;;
    --check) check_only=true ;;
    --clean) clean=true ;;
    --install) install_after=true ;;
    --test) run_tests=true ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

# A toolchain selected through the environment (TOOLCHAINS, a swiftly or Homebrew swift on PATH)
# may lack the macOS SDK's SwiftUI: Apple's own tools are used, found through xcrun.
unset TOOLCHAINS

# ---------------------------------------------------------------- output helpers

if [[ -t 1 ]]; then
  bold=$'\033[1m'; green=$'\033[32m'; yellow=$'\033[33m'; red=$'\033[31m'; reset=$'\033[0m'
else
  bold=""; green=""; yellow=""; red=""; reset=""
fi
step() { printf '%s==>%s %s\n' "$bold" "$reset" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '  %s!%s %s\n' "$yellow" "$reset" "$*"; }
fixed() { printf '  %s✓%s %s %s(repaired)%s\n' "$green" "$reset" "$*" "$yellow" "$reset"; repairs+=("$*"); }
die()  { printf '%serror:%s %b\n' "$red" "$reset" "$*" >&2; exit 1; }
repairs=()

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

# Succeeds when the internet host answers (used before any download).
online() { /usr/bin/curl -fsSI --max-time 8 "$1" >/dev/null 2>&1; }

need_network() {
  online "$1" && return 0
  die "Cannot reach $1. Check the network connection (or the proxy settings: https_proxy) and run ./build.sh again."
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

  local free_mb
  free_mb="$(df -m "$ROOT" | awk 'NR == 2 { print $4 }')"
  if [[ -n "$free_mb" && "$free_mb" -lt "$MIN_FREE_MB" ]]; then
    die "Only ${free_mb} MB free on this disk; building needs about ${MIN_FREE_MB} MB. Free some space and try again."
  fi
  ok "${free_mb} MB free on disk"
}

install_command_line_tools() {
  confirm "Install the Xcode Command Line Tools now?" ||
    die "The Xcode Command Line Tools are required. Install them with: xcode-select --install"
  xcode-select --install 2>/dev/null || true
  echo "  A system dialog will guide the installation (about 1 GB). Waiting for it to finish…"
  local waited=0
  until [[ -x "$CLT_DIR/usr/bin/swift" ]] && xcrun --find swift >/dev/null 2>&1; do
    sleep 10
    waited=$((waited + 10))
    if (( waited % 300 == 0 )); then echo "  Still waiting for the Command Line Tools… (${waited}s)"; fi
    (( waited < 3600 )) || die "The Command Line Tools did not finish installing within an hour."
  done
  fixed "Command Line Tools installed"
}

update_command_line_tools() {
  confirm "Update the Command Line Tools with Software Update? (needs your password)" ||
    die "$1 Update Xcode or the Command Line Tools and try again."
  local label
  label="$(softwareupdate --list 2>/dev/null | sed -n 's/^\* Label: \(Command Line Tools.*\)$/\1/p' | tail -n1)"
  [[ -n "$label" ]] || die "Software Update offers no Command Line Tools update. Install the latest Xcode from the App Store instead."
  sudo softwareupdate --install "$label" --verbose
  fixed "Command Line Tools updated"
}

# The developer directory selected with xcode-select must exist and hold a working Swift.
check_developer_dir() {
  local dir
  if ! dir="$(xcode-select -p 2>/dev/null)" || [[ ! -d "$dir" ]]; then
    if [[ -n "${dir:-}" && -x "$CLT_DIR/usr/bin/swift" ]]; then
      warn "The selected developer tools ($dir) no longer exist."
      confirm "Switch to the Command Line Tools at $CLT_DIR? (needs your password)" ||
        die "Select working developer tools with: sudo xcode-select --switch $CLT_DIR"
      sudo xcode-select --switch "$CLT_DIR"
      fixed "Developer tools switched to $CLT_DIR"
    else
      warn "The Xcode Command Line Tools are not installed."
      install_command_line_tools
    fi
  elif ! xcrun --find swift >/dev/null 2>&1; then
    warn "The selected developer tools ($dir) have no Swift compiler."
    if [[ -x "$CLT_DIR/usr/bin/swift" && "$dir" != "$CLT_DIR" ]]; then
      confirm "Switch to the Command Line Tools at $CLT_DIR? (needs your password)" ||
        die "Select working developer tools with: sudo xcode-select --switch $CLT_DIR"
      sudo xcode-select --switch "$CLT_DIR"
      fixed "Developer tools switched to $CLT_DIR"
    else
      install_command_line_tools
    fi
  fi
  ok "Developer tools at $(xcode-select -p)"
}

check_toolchain() {
  check_developer_dir
  SWIFT="$(xcrun --find swift)"

  local output
  if ! output="$("$SWIFT" --version 2>&1)"; then
    if [[ "$output" == *license* ]]; then
      warn "The Xcode license has not been accepted."
      confirm "Accept the Xcode license now? (needs your password)" || die "Accept it with: sudo xcodebuild -license accept"
      sudo xcodebuild -license accept
      fixed "Xcode license accepted"
    elif [[ "$output" == *runFirstLaunch* || "$output" == *"additional components"* ]]; then
      warn "Xcode has not finished its first-launch setup."
      confirm "Run it now? (needs your password)" || die "Run it with: sudo xcodebuild -runFirstLaunch"
      sudo xcodebuild -runFirstLaunch
      fixed "Xcode first-launch setup done"
    else
      die "Swift fails to run:\n$output"
    fi
    output="$("$SWIFT" --version 2>&1)" || die "Swift still fails to run:\n$output"
  fi

  local swift_version
  swift_version="$(sed -n 's/.*Swift version \([0-9][0-9.]*\).*/\1/p' <<<"$output" | head -n1)"
  [[ -n "$swift_version" ]] || die "Could not determine the Swift version from:\n$output"
  if ! version_at_least "$swift_version" "$MIN_SWIFT"; then
    warn "Swift $swift_version is too old; $MIN_SWIFT or later is required."
    update_command_line_tools "Swift $MIN_SWIFT or later is required."
    swift_version="$("$SWIFT" --version 2>&1 | sed -n 's/.*Swift version \([0-9][0-9.]*\).*/\1/p' | head -n1)"
    version_at_least "$swift_version" "$MIN_SWIFT" || die "Swift is still $swift_version after the update."
  fi
  ok "Swift $swift_version"
  SWIFT_VERSION="$swift_version"

  local sdk
  sdk="$(xcrun --sdk macosx --show-sdk-version 2>/dev/null || true)"
  if [[ -z "$sdk" ]] || ! version_at_least "$sdk" "$MIN_SDK"; then
    warn "The macOS SDK is ${sdk:-missing}; $MIN_SDK or later is required."
    update_command_line_tools "The macOS $MIN_SDK SDK or later is required."
    sdk="$(xcrun --sdk macosx --show-sdk-version 2>/dev/null || true)"
    [[ -n "$sdk" ]] && version_at_least "$sdk" "$MIN_SDK" || die "The macOS SDK is still ${sdk:-missing} after the update."
  fi
  ok "macOS SDK $sdk"

  local tool
  for tool in "$CODESIGN" "$DITTO" "$PLUTIL" "$LIPO" "$SHASUM"; do
    [[ -x "$tool" ]] || die "$tool is missing; it ships with macOS and the developer tools."
  done
  /usr/bin/python3 -c 'import sys; sys.exit(sys.version_info < (3, 8))' 2>/dev/null ||
    die "Python 3.8 or later is needed (it comes with the Command Line Tools); /usr/bin/python3 does not run."
  ok "codesign, ditto, plutil, lipo, shasum, python3"
}

# ---------------------------------------------------------------- math engines

vendor_complete() {
  [[ -s "$VENDOR_DIR/mathlive/mathlive.min.js" && -s "$VENDOR_DIR/mathjax/tex-svg-full.js" &&
     -n "$(ls "$VENDOR_DIR/mathlive/fonts/"*.woff2 2>/dev/null)" ]]
}

# Every bundled file matches the checksums recorded when the engines were last downloaded.
vendor_intact() {
  [[ -s "$VENDOR_DIR/checksums.sha256" ]] && (cd "$VENDOR_DIR" && "$SHASUM" -a 256 -c --quiet checksums.sha256 >/dev/null 2>&1)
}

pinned_version() { sed -n "s/.*\"$1\": \"\\([^\"]*\\)\".*/\\1/p" "$2"; }

ensure_node() {
  local version=""
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    version="$(node -p 'process.versions.node' 2>/dev/null || true)"
    if [[ -n "$version" ]] && version_at_least "$version" "$MIN_NODE"; then
      ok "Node.js $version"
      return 0
    fi
    warn "Node.js ${version:-(unknown)} is too old to download the math engines; $MIN_NODE or later is needed."
  else
    warn "Node.js (npm) is needed to download the math engines."
  fi
  if ! command -v brew >/dev/null 2>&1; then
    confirm "Install Homebrew (https://brew.sh) to get Node.js?" ||
      die "Install Node.js $MIN_NODE or later from https://nodejs.org and run ./build.sh again."
    need_network "https://raw.githubusercontent.com"
    if $assume_yes; then export NONINTERACTIVE=1; fi
    /bin/bash -c "$(/usr/bin/curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv)"
    fixed "Homebrew installed"
  fi
  confirm "Install or update Node.js with Homebrew?" || die "Install Node.js $MIN_NODE or later from https://nodejs.org and run ./build.sh again."
  if brew list node >/dev/null 2>&1; then brew upgrade node || true; else brew install node; fi
  hash -r
  version="$(node -p 'process.versions.node' 2>/dev/null || true)"
  [[ -n "$version" ]] && version_at_least "$version" "$MIN_NODE" || die "Node.js is still ${version:-missing} after installing it."
  fixed "Node.js $version"
}

download_vendor() {
  confirm "Download the math engines (MathLive and MathJax, about 10 MB) with npm now?" ||
    die "The math engines are needed. Restore them with: scripts/update-vendor.sh"
  ensure_node
  need_network "https://registry.npmjs.org"
  "$ROOT/scripts/update-vendor.sh"
  vendor_complete || die "The math engines are still missing after the download."
}

check_dependencies() {
  local pinned_ml pinned_mj
  pinned_ml="$(pinned_version mathlive "$ROOT/package.json")"
  pinned_mj="$(pinned_version mathjax-full "$ROOT/package.json")"

  if ! vendor_complete; then
    warn "The bundled math engines are missing from $VENDOR_DIR."
    download_vendor
    fixed "Math engines downloaded"
  elif [[ "$(pinned_version mathlive "$VENDOR_DIR/versions.json")" != "$pinned_ml" ||
          "$(pinned_version mathjax "$VENDOR_DIR/versions.json")" != "$pinned_mj" ]]; then
    warn "The bundled math engines are not the versions pinned in package.json (MathLive $pinned_ml, MathJax $pinned_mj)."
    download_vendor
    fixed "Math engines replaced with the pinned versions"
  elif ! vendor_intact; then
    # A copy without the local fixes (scripts/patches) gets them; anything else is downloaded again.
    warn "The bundled math engines do not match their checksums."
    /usr/bin/python3 "$ROOT/scripts/patches/mathlive-boldsymbol.py" "$VENDOR_DIR/mathlive/mathlive.min.js" >/dev/null
    /usr/bin/python3 "$ROOT/scripts/patches/mathlive-scripts.py" "$VENDOR_DIR/mathlive/mathlive.min.js" >/dev/null
    if vendor_intact; then
      fixed "Local fixes applied to MathLive"
    else
      warn "Some files are damaged or incomplete (a partial download or checkout?)."
      download_vendor
      fixed "Math engines downloaded again"
    fi
  fi
  ok "MathLive $pinned_ml and MathJax $pinned_mj (bundled, verified)"
}

check_icon() {
  [[ -s "$ROOT/Resources/AppIcon.icns" ]] && { ok "App icon"; return; }
  warn "Resources/AppIcon.icns is missing."
  if ! command -v rsvg-convert >/dev/null 2>&1; then
    command -v brew >/dev/null 2>&1 && confirm "Install librsvg with Homebrew to draw the icon?" ||
      die "Restore Resources/AppIcon.icns (git checkout Resources) or install librsvg and run scripts/make-icon.py."
    brew install librsvg
  fi
  /usr/bin/python3 "$ROOT/scripts/make-icon.py"
  fixed "App icon generated"
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

# A build cache from another Swift version fails with "compiled with a different version of
# Swift"-style errors: it is cleared when the toolchain changes.
check_build_cache() {
  local stamp="$ROOT/.build/visual-typist-toolchain" current
  current="$SWIFT_VERSION $(xcode-select -p)"
  if [[ -d "$ROOT/.build" && -f "$stamp" && "$(cat "$stamp")" != "$current" ]]; then
    rm -rf "$ROOT/.build"
    fixed "Build cache from another toolchain cleared"
  fi
  mkdir -p "$ROOT/.build"
  printf '%s\n' "$current" >"$stamp"
}

compile() {
  "$SWIFT" build --configuration release --arch arm64 --product "$EXECUTABLE" 2>&1 | tee "$LOG_FILE"
  return "${PIPESTATUS[0]}"
}

explain_failure() {
  echo >&2
  if grep -qiE "compiled with|module.*cannot be imported|could not build Objective-C module|PCH" "$LOG_FILE"; then
    echo "  The build cache seems stale even after clearing it; try: ./build.sh --clean" >&2
  elif grep -qiE "no such module 'SwiftUI'|SDK" "$LOG_FILE"; then
    echo "  The macOS SDK looks incomplete: reinstall the Command Line Tools (xcode-select --install)." >&2
  elif grep -qiE "No space left" "$LOG_FILE"; then
    echo "  The disk is full: free some space and try again." >&2
  fi
  die "The build failed. The full log is in $LOG_FILE."
}

build_app() {
  cd "$ROOT"
  if $clean; then
    step "Cleaning previous build products"
    rm -rf .build "$OUT_DIR/$APP_NAME.app"
  fi
  check_build_cache

  if $run_tests; then
    step "Running the unit tests"
    "$ROOT/scripts/test.sh" || die "The unit tests failed."
  fi

  step "Compiling (release, arm64)"
  if ! compile; then
    # A half-written or incompatible cache is the usual cause: one clean retry.
    warn "The build failed; retrying once with a clean build cache."
    rm -rf "$ROOT/.build"
    check_build_cache
    compile || explain_failure
    fixed "Build cache rebuilt"
  fi
  rm -f "$LOG_FILE"
  local bin_dir
  bin_dir="$("$SWIFT" build --configuration release --arch arm64 --show-bin-path)"

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
}

summary() {
  if (( ${#repairs[@]} > 0 )); then
    echo
    echo "Repaired along the way:"
    printf '  - %s\n' "${repairs[@]}"
  fi
}

step "Checking the build environment"
check_platform
check_toolchain
check_dependencies
check_icon
if $check_only; then
  summary
  ok "The environment is ready."
  exit 0
fi
build_app
summary
echo
if $install_after; then
  step "Installing"
  "$ROOT/install.sh" --open --app "$OUT_DIR/$APP_NAME.app"
else
  echo "Run it with:   open \"$OUT_DIR/$APP_NAME.app\""
  echo "Install with:  $ROOT/install.sh   (or build and install in one go: ./build.sh --install)"
fi
