#!/usr/bin/env bash
# Verify that a Margin Notes update feed is one the installed updater will accept.
#
#   scripts/verify-update-feed.sh [base-url-or-directory]
#
# The default is what the shipped app reads once a release is published:
#   https://github.com/cxrobx/Margin/releases/latest/download/
# A local release folder (release/distribution/<version>) works too, so a release
# can be proven good before anything is uploaded.
#
# It fetches latest-mac.yml and downloads the zip that file names, then checks
#   - the zip's size and sha512 match the yml (a mismatch stops everything),
#   - every other file the yml lists is present at the listed size,
#   - the app inside is signed by TeamIdentifier $EXPECTED_TEAM_ID (default
#     CCYV5HQZCM) with the hardened runtime, passes a deep strict verify, is
#     notarized (spctl) and stapled (stapler validate),
#   - the app's version equals the yml's version, and the zip name agrees,
#   - the app carries the GitHub feed (app-update.yml: cxrobx/Margin).
# Any failed check exits 1.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${1:-https://github.com/cxrobx/Margin/releases/latest/download/}"
TEAM_ID="${EXPECTED_TEAM_ID:-CCYV5HQZCM}"
BUNDLE_ID="local.margin.notes"
FAILS=()
TMP="$(mktemp -d "${TMPDIR:-/tmp}/margin-feed.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

ok()   { printf '  ok    %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; FAILS+=("$*"); }
die()  { bad "$*"; finish; }
finish() {
  echo
  if [ "${#FAILS[@]}" -gt 0 ]; then
    printf 'FEED REJECTED: %d check(s) failed\n' "${#FAILS[@]}"
    printf '  - %s\n' "${FAILS[@]}"
    exit 1
  fi
  echo "FEED OK: $BASE"
  exit 0
}

if [[ "$BASE" =~ ^https?:// ]]; then MODE=url; BASE="${BASE%/}/"; else MODE=dir; BASE="$(cd "$BASE" 2>/dev/null && pwd)/" || { echo "FAIL  $1 is not a directory or URL"; exit 1; }; fi
echo "Verifying the update feed at $BASE ($MODE)"

fetch() { # name dest
  if [ "$MODE" = dir ]; then cp "$BASE$1" "$2" 2>/dev/null; else curl -fsSL --retry 2 --connect-timeout 15 -o "$2" "$BASE$1"; fi
}
remote_size() { curl -fsSIL --retry 2 --connect-timeout 15 "$BASE$1" | tr -d '\r' | awk 'tolower($1)=="content-length:" {n=$2} END {print n}'; }
sha512_b64() { openssl dgst -sha512 -binary "$1" | openssl base64 -A; }
size_of() { stat -f%z "$1"; }
team_of() { codesign -dvv "$1" 2>&1 | sed -n 's/^TeamIdentifier=//p' | head -1; }

# 1. The feed file.
fetch latest-mac.yml "$TMP/latest-mac.yml" || die "latest-mac.yml could not be fetched from $BASE"
[ -d "$ROOT/node_modules/js-yaml" ] || die "js-yaml is missing; run npm ci first"
PARSED="$(node -e '
  const { createRequire } = require("node:module");
  const yaml = createRequire(process.argv[1] + "/package.json")("js-yaml");
  const feed = yaml.load(require("node:fs").readFileSync(process.argv[2], "utf8"));
  const safe = /^[A-Za-z0-9._-]+$/;
  const fail = message => { console.log("ERROR\t" + message); process.exit(0); };
  if (!feed || typeof feed !== "object") fail("latest-mac.yml is not a YAML mapping");
  if (typeof feed.version !== "string" || !/^\d+\.\d+\.\d+$/.test(feed.version)) fail("version is missing or not a stable x.y.z: " + feed.version);
  if (!Array.isArray(feed.files) || !feed.files.length) fail("files is empty");
  console.log("version\t" + feed.version + "\t\t");
  console.log("path\t" + (feed.path || "") + "\t" + (feed.sha512 || "") + "\t");
  for (const file of feed.files) {
    if (!file || !safe.test(String(file.url))) fail("an entry has an unsafe or missing url: " + (file && file.url));
    if (!/^[A-Za-z0-9+\/]+=*$/.test(String(file.sha512))) fail(file.url + " has no sha512");
    if (!Number.isInteger(file.size) || file.size <= 0) fail(file.url + " has no size");
    console.log("file\t" + file.url + "\t" + file.sha512 + "\t" + file.size);
  }
' "$ROOT" "$TMP/latest-mac.yml" 2>&1)" || die "latest-mac.yml could not be parsed: $PARSED"

VERSION=""; FEED_PATH=""; FEED_PATH_SHA=""; ZIP=""; ZIP_SHA=""; ZIP_SIZE=""; OTHER_NAMES=(); OTHER_SHAS=(); OTHER_SIZES=()
while IFS=$'\t' read -r kind a b c; do
  case "$kind" in
    ERROR) die "latest-mac.yml is invalid: $a" ;;
    version) VERSION="$a" ;;
    path) FEED_PATH="$a"; FEED_PATH_SHA="$b" ;;
    file)
      if [[ "$a" == *.zip && -z "$ZIP" ]]; then ZIP="$a"; ZIP_SHA="$b"; ZIP_SIZE="$c"
      else OTHER_NAMES+=("$a"); OTHER_SHAS+=("$b"); OTHER_SIZES+=("$c"); fi ;;
  esac
done <<< "$PARSED"
[ -n "$VERSION" ] || die "latest-mac.yml has no version"
[ -n "$ZIP" ] || die "latest-mac.yml lists no .zip, and the macOS updater installs from the zip"
ok "latest-mac.yml: version $VERSION, zip $ZIP"

[ "$FEED_PATH" = "$ZIP" ] && [ "$FEED_PATH_SHA" = "$ZIP_SHA" ] && ok "path and sha512 at the top of the yml agree with the zip entry" || bad "the yml's top-level path/sha512 ($FEED_PATH) disagree with its zip entry ($ZIP)"
[[ "$ZIP" =~ ^Margin-(.+)-macOS-arm64\.zip$ ]] && [ "${BASH_REMATCH[1]}" = "$VERSION" ] && ok "zip name follows Margin-<version>-macOS-arm64.zip and matches the yml version" || bad "zip name $ZIP does not follow Margin-$VERSION-macOS-arm64.zip"

# 2. The zip the updater will download.
fetch "$ZIP" "$TMP/$ZIP" || die "$ZIP could not be fetched from $BASE"
[ "$(size_of "$TMP/$ZIP")" = "$ZIP_SIZE" ] && ok "zip size $ZIP_SIZE bytes matches" || die "zip size is $(size_of "$TMP/$ZIP") but the yml says $ZIP_SIZE"
[ "$(sha512_b64 "$TMP/$ZIP")" = "$ZIP_SHA" ] && ok "zip sha512 matches" || die "zip sha512 does not match the yml; the updater would refuse it, so nothing inside was inspected"

# 3. Everything else the yml lists must exist at the size it claims.
for i in "${!OTHER_NAMES[@]}"; do
  name="${OTHER_NAMES[$i]}"
  if [ "$MODE" = dir ]; then
    if [ ! -f "$BASE$name" ]; then bad "$name is listed in the yml but is not in the folder"; continue; fi
    [ "$(size_of "$BASE$name")" = "${OTHER_SIZES[$i]}" ] && [ "$(sha512_b64 "$BASE$name")" = "${OTHER_SHAS[$i]}" ] && ok "$name size and sha512 match" || bad "$name does not match the size/sha512 in the yml"
  else
    got="$(remote_size "$name")"
    [ "$got" = "${OTHER_SIZES[$i]}" ] && ok "$name is published at ${OTHER_SIZES[$i]} bytes" || bad "$name is published at ${got:-unreachable} bytes; the yml says ${OTHER_SIZES[$i]}"
  fi
done
if [ "$MODE" = dir ]; then
  [ -f "$BASE$ZIP.blockmap" ] && ok "$ZIP.blockmap is present (differential updates)" || bad "$ZIP.blockmap is missing"
else
  curl -fsSIL --connect-timeout 15 -o /dev/null "$BASE$ZIP.blockmap" && ok "$ZIP.blockmap is published" || bad "$ZIP.blockmap is not published"
fi

# 4. The app inside.
ditto -x -k "$TMP/$ZIP" "$TMP/unzipped" || die "the zip does not unpack"
APPS=("$TMP"/unzipped/*.app)
[ "${#APPS[@]}" -eq 1 ] && [ -d "${APPS[0]}" ] || die "expected exactly one .app at the top of the zip"
APP="${APPS[0]}"
ok "zip contains $(basename "$APP")"

PLIST="$APP/Contents/Info.plist"
APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST" 2>/dev/null)"
[ "$APP_VERSION" = "$VERSION" ] && ok "app version $APP_VERSION equals the yml version" || bad "app version is '$APP_VERSION' but the yml says $VERSION"
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST" 2>/dev/null)" = "$BUNDLE_ID" ] && ok "bundle id $BUNDLE_ID" || bad "bundle id is not $BUNDLE_ID"

VERIFY="$(codesign --verify --deep --strict --verbose=1 "$APP" 2>&1)" && ok "codesign --verify --deep --strict passes" || bad "codesign verify failed: $(echo "$VERIFY" | tail -2 | tr '\n' ' ')"
DETAILS="$(codesign -dvv "$APP" 2>&1)"
[ "$(echo "$DETAILS" | sed -n 's/^TeamIdentifier=//p' | head -1)" = "$TEAM_ID" ] && ok "TeamIdentifier $TEAM_ID" || bad "TeamIdentifier is '$(echo "$DETAILS" | sed -n 's/^TeamIdentifier=//p' | head -1)', expected $TEAM_ID"
echo "$DETAILS" | grep -q '^Authority=Developer ID Application:' && ok "signed with a Developer ID Application certificate" || bad "not signed with a Developer ID Application certificate"
echo "$DETAILS" | grep -q 'flags=0x[0-9a-f]*(.*runtime' && ok "hardened runtime is on" || bad "hardened runtime is off"
echo "$DETAILS" | grep -q '^Timestamp=' && ok "secure timestamp present" || bad "no secure timestamp"
for part in "Contents/Frameworks/Electron Framework.framework" "Contents/Frameworks/Squirrel.framework" "Contents/Resources/app/app/native/glass.node" "Contents/Frameworks/$(basename "$APP" .app) Helper.app" "Contents/Frameworks/$(basename "$APP" .app) Helper (Renderer).app"; do
  [ -e "$APP/$part" ] || { bad "$part is missing from the app"; continue; }
  [ "$(team_of "$APP/$part")" = "$TEAM_ID" ] && ok "$part is signed by $TEAM_ID" || bad "$part is not signed by $TEAM_ID"
done

SPCTL="$(spctl -a -vv -t exec "$APP" 2>&1)"
echo "$SPCTL" | grep -q 'accepted' && echo "$SPCTL" | grep -q 'source=Notarized Developer ID' && ok "spctl: accepted, source=Notarized Developer ID" || bad "spctl does not accept it as notarized: $(echo "$SPCTL" | tr '\n' ' ')"
STAPLE="$(xcrun stapler validate "$APP" 2>&1)" && ok "stapler validate: a notarization ticket is stapled" || bad "no stapled ticket: $(echo "$STAPLE" | tail -1)"

UPDATE_YML="$APP/Contents/Resources/app-update.yml"
if [ -f "$UPDATE_YML" ] && grep -qx 'provider: github' "$UPDATE_YML" && grep -qx 'owner: cxrobx' "$UPDATE_YML" && grep -qx 'repo: Margin' "$UPDATE_YML"; then
  ok "app-update.yml points at github.com/cxrobx/Margin"
else bad "app-update.yml is missing or does not point at github.com/cxrobx/Margin"; fi

finish
