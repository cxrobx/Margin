#!/usr/bin/env bash
# Build, sign, notarize and staple a Margin Notes release into one folder.
#
#   scripts/release.sh VERSION [--notes-file FILE] [--smoke] [--allow-dirty] [--publish]
#
# Without --publish this only builds: nothing is committed, tagged, pushed or
# uploaded, and the exact `gh release create` command is printed for you to run.
# With --publish it runs that command (as a draft) and then makes it public.
#
# Output: release/distribution/VERSION/ holding the disk image, the zip the
# updater installs from, both blockmaps, latest-mac.yml, the Alfred workflow and
# a .sha256 beside each download. release/build/VERSION/ keeps the raw build,
# minus the unpacked .app (the zip holds it): every .app left on disk shows up
# in Spotlight and Alfred as another "Margin Notes". Nothing is written to
# release/mac-arm64, which a locally running app may use.
#
# Needs: the Developer ID certificate in the login keychain and a notarytool
# keychain profile (default DiskSight, same team). Override with CSC_NAME and
# APPLE_KEYCHAIN_PROFILE. No credential is ever created or printed here.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="cxrobx/Margin"
CSC_NAME="${CSC_NAME:-Christopher Robinson (CCYV5HQZCM)}"
APPLE_KEYCHAIN_PROFILE="${APPLE_KEYCHAIN_PROFILE:-DiskSight}"
IDENTITY="Developer ID Application: $CSC_NAME"

VERSION=""; PUBLISH=0; ALLOW_DIRTY=0; SMOKE=0; NOTES_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --publish) PUBLISH=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --smoke) SMOKE=1 ;;
    --notes-file) shift; NOTES_FILE="${1:-}" ;;
    -h|--help) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; exit 2 ;;
    *) if [ -z "$VERSION" ]; then VERSION="$1"; else echo "Unexpected argument: $1" >&2; exit 2; fi ;;
  esac
  shift
done

step() { printf '\n==> %s\n' "$*"; }
die() { printf 'release: %s\n' "$*" >&2; exit 1; }

[ -n "$VERSION" ] || die "usage: scripts/release.sh VERSION [--notes-file FILE] [--smoke] [--allow-dirty] [--publish]"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "VERSION must be a stable x.y.z; the updater ignores prereleases (got '$VERSION')"
[ "$(uname)" = Darwin ] || die "signing and notarizing need macOS"
cd "$ROOT"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$ROOT is not a git work tree"

step "Checking the tree, tag and version"
if [ -n "$(git status --porcelain)" ]; then
  if [ "$ALLOW_DIRTY" = 1 ] && [ "$PUBLISH" = 0 ]; then
    echo "WARNING: building from a dirty tree (--allow-dirty). This is for dry runs only; do not ship it."
  else
    git status --short >&2
    die "the git tree is dirty. Commit or stash first so the release matches a commit (--allow-dirty is for dry runs and is refused with --publish)"
  fi
fi
TAG="v$VERSION"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "tag $TAG already exists locally"
REMOTE_TAG=0; git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1 || REMOTE_TAG=$?
case "$REMOTE_TAG" in
  0) die "tag $TAG already exists on origin" ;;
  2) ;;
  *) echo "WARNING: could not reach origin to check for $TAG; only the local tags were checked." ;;
esac
PKG_VERSION="$(node -p "require('./package.json').version")"
[ "$PKG_VERSION" = "$VERSION" ] || die "package.json is at $PKG_VERSION, not $VERSION. Bump package.json and package-lock.json first"
LOCK_VERSION="$(node -p "const l=require('./package-lock.json'); l.version + ' ' + l.packages[''].version")"
[ "$LOCK_VERSION" = "$VERSION $VERSION" ] || die "package-lock.json versions are '$LOCK_VERSION', expected '$VERSION $VERSION'"
if [ "$PUBLISH" = 1 ] && [ -z "$(git branch -r --contains HEAD 2>/dev/null)" ]; then die "HEAD is not on origin yet; push it first so the tag lands on this commit"; fi

step "Checking signing and notarization credentials"
security find-identity -v -p codesigning | grep -qF "\"$IDENTITY\"" || die "no '$IDENTITY' certificate in the keychain"
xcrun notarytool history --keychain-profile "$APPLE_KEYCHAIN_PROFILE" >/dev/null 2>&1 \
  || die "the notarytool keychain profile '$APPLE_KEYCHAIN_PROFILE' does not work. Not creating credentials; fix or set APPLE_KEYCHAIN_PROFILE"
echo "identity: $IDENTITY"; echo "notary profile: $APPLE_KEYCHAIN_PROFILE (works)"
[ -x node_modules/.bin/electron-builder ] || die "dependencies are missing; run npm ci"
[ -d node_modules/electron/dist/Electron.app ] || { echo "Fetching the Electron binary (npm ci skips its download script)..."; node node_modules/electron/install.js; }

OUT="$ROOT/release/build/$VERSION"
DIST="$ROOT/release/distribution/$VERSION"
rm -rf "$OUT" "$DIST"; mkdir -p "$DIST"
ZIP="Margin-$VERSION-macOS-arm64.zip"; DMG="Margin-$VERSION-macOS-arm64.dmg"
APP="$OUT/mac-arm64/Margin Notes.app"

step "Building the renderer and the native glass bridge"
npm run build
[ -f app/native/glass.node ] || die "app/native/glass.node was not built (Node-API headers missing?)"

step "Packaging: sign with the hardened runtime, notarize, staple"
# Only the keychain profile may drive notarization; ignore any other credentials in the environment.
env -u APPLE_ID -u APPLE_APP_SPECIFIC_PASSWORD -u APPLE_TEAM_ID -u APPLE_API_KEY -u APPLE_API_KEY_ID -u APPLE_API_ISSUER -u CSC_LINK -u CSC_KEY_PASSWORD \
  CSC_NAME="$CSC_NAME" APPLE_KEYCHAIN_PROFILE="$APPLE_KEYCHAIN_PROFILE" \
  npx electron-builder --mac --publish never "-c.directories.output=$OUT"
for f in "$ZIP" "$DMG" "$ZIP.blockmap" "$DMG.blockmap" latest-mac.yml; do [ -f "$OUT/$f" ] || die "electron-builder did not produce $f"; done
[ -d "$APP" ] || die "electron-builder did not produce $APP"

step "Proving the app was notarized and stapled (electron-builder skips notarization silently when it cannot)"
xcrun stapler validate "$APP"
GATEKEEPER="$(spctl -a -vv -t exec "$APP" 2>&1 || true)"; echo "$GATEKEEPER"
grep -q 'source=Notarized Developer ID' <<<"$GATEKEEPER" || die "the app is not accepted as Notarized Developer ID"

step "Signing, notarizing and stapling the disk image"
codesign --force --sign "$IDENTITY" --timestamp "$OUT/$DMG"
SUBMIT="$(xcrun notarytool submit "$OUT/$DMG" --keychain-profile "$APPLE_KEYCHAIN_PROFILE" --wait 2>&1)" || { echo "$SUBMIT" >&2; die "notarytool submit failed for the disk image"; }
echo "$SUBMIT" | tail -6
echo "$SUBMIT" | grep -q 'status: Accepted' || die "Apple did not accept the disk image (see xcrun notarytool log)"
xcrun stapler staple "$OUT/$DMG"
xcrun stapler validate "$OUT/$DMG"
GATEKEEPER="$(spctl -a -t open --context context:primary-signature -vv "$OUT/$DMG" 2>&1 || true)"; echo "$GATEKEEPER"
grep -q 'source=Notarized Developer ID' <<<"$GATEKEEPER" || die "the disk image is not accepted as Notarized Developer ID"

step "Refreshing the disk image's entry in latest-mac.yml (stapling changed the file electron-builder hashed)"
# The zip is never touched after electron-builder hashes it, so its entry and blockmap stand.
node - "$OUT" "$DMG" <<'EOF'
const fs = require('node:fs');
const path = require('node:path');
const [out, dmg] = process.argv.slice(2);
const { buildBlockMap } = require(require.resolve('app-builder-lib/out/targets/blockmap/blockmap', { paths: [process.cwd()] }));
(async () => {
  const file = path.join(out, dmg);
  const info = await buildBlockMap(file, 'gzip', `${file}.blockmap`);
  const ymlPath = path.join(out, 'latest-mac.yml');
  const yml = fs.readFileSync(ymlPath, 'utf8');
  const entry = new RegExp(`(- url: ${dmg.replace(/\./g, '\\.')}\\n\\s+sha512: )\\S+(\\n\\s+size: )\\d+`);
  if (!entry.test(yml)) throw new Error(`latest-mac.yml has no entry for ${dmg}`);
  fs.writeFileSync(ymlPath, yml.replace(entry, (_match, head, middle) => `${head}${info.sha512}${middle}${info.size}`));
  console.log(`${dmg}: size ${info.size}, blockmap regenerated`);
})().catch(error => { console.error(error.message); process.exit(1); });
EOF

step "Collecting the release folder: $DIST"
for f in "$ZIP" "$DMG" "$ZIP.blockmap" "$DMG.blockmap" latest-mac.yml; do cp "$OUT/$f" "$DIST/$f"; done
cp "integrations/alfred/Margin Quick Capture.alfredworkflow" "$DIST/Margin-Quick-Capture.alfredworkflow"
( cd "$DIST" && for f in "$DMG" "$ZIP" Margin-Quick-Capture.alfredworkflow; do shasum -a 256 "$f" > "$f.sha256"; done )
ls -l "$DIST"

step "Verifying the feed in that folder"
bash "$ROOT/scripts/verify-update-feed.sh" "$DIST"

if [ "$SMOKE" = 1 ]; then
  step "Desktop smoke test of the signed app"
  SMOKE_DATA="$(mktemp -d "${TMPDIR:-/tmp}/margin-release-smoke.XXXXXX")"
  MARGIN_SMOKE_TEST=1 MARGIN_DATA_DIR="$SMOKE_DATA" MARGIN_ARTIFACTS_DIR="$SMOKE_DATA" "$APP/Contents/MacOS/Margin Notes"
  rm -rf "$SMOKE_DATA"
fi

# The signed app lives on in the zip; an unpacked copy here is one more Spotlight hit.
rm -rf "$OUT/mac-arm64"

NOTES="${NOTES_FILE:-$DIST/release-notes.md}"
FILES=("$DIST/$DMG" "$DIST/$DMG.sha256" "$DIST/$ZIP" "$DIST/$ZIP.sha256" "$DIST/$ZIP.blockmap" "$DIST/$DMG.blockmap" "$DIST/latest-mac.yml" "$DIST/Margin-Quick-Capture.alfredworkflow" "$DIST/Margin-Quick-Capture.alfredworkflow.sha256")
CREATE=(gh release create "$TAG" "${FILES[@]}" --repo "$REPO" --target "$(git rev-parse HEAD)" --title "Margin Notes $VERSION" --notes-file "$NOTES" --draft)
PUBLISH_CMD=(gh release edit "$TAG" --repo "$REPO" --draft=false)

printf '\nRelease %s is built and verified in %s\n\n' "$VERSION" "$DIST"
echo "The update dialog shows the release notes, so write them to: $NOTES"
[ -f "$NOTES" ] || echo "  (that file does not exist yet)"
echo
echo "Push the commit first if you have not (the tag is created on it), then:"
echo
printf '  '; printf '%q ' "${CREATE[@]}"; echo
echo "  # check the draft, then make it public so the updater sees a complete release:"
printf '  '; printf '%q ' "${PUBLISH_CMD[@]}"; echo
echo

if [ "$PUBLISH" = 1 ]; then
  [ -f "$NOTES" ] || die "--publish needs the release notes file: $NOTES"
  step "Publishing (--publish)"
  "${CREATE[@]}"
  "${PUBLISH_CMD[@]}"
  echo "Published $TAG. Confirm the live feed: scripts/verify-update-feed.sh"
else
  echo "Not published (no --publish). Nothing has been committed, tagged, pushed or uploaded."
fi
