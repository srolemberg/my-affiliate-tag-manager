#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
MANIFEST="$PROJECT_ROOT/manifest.json"
VERSION=$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "$MANIFEST")

case "$VERSION" in
    ''|*[!0-9A-Za-z._-]*)
        printf 'Invalid extension version in manifest.json: %s\n' "$VERSION" >&2
        exit 1
        ;;
esac

RELEASE_DIR="$PROJECT_ROOT/release"
ARCHIVE="$RELEASE_DIR/my-affiliate-tag-manager-v$VERSION.zip"
STAGING_DIR=$(mktemp -d "${TMPDIR:-/tmp}/my-affiliate-tag-manager.XXXXXX")

cleanup() {
    rm -rf "$STAGING_DIR"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

if ! command -v zip >/dev/null 2>&1; then
    printf 'The zip utility is required to create the extension archive.\n' >&2
    exit 1
fi

FILES='
manifest.json
background.js
popup.html
popup.js
options.html
options.js
footer.html
footer.js
i18n.js
tag-utils.js
tag-16.png
tag-32.png
tag-48.png
tag-128.png
'

for file in $FILES; do
    if [ ! -f "$PROJECT_ROOT/$file" ]; then
        printf 'Required extension file is missing: %s\n' "$file" >&2
        exit 1
    fi
    cp "$PROJECT_ROOT/$file" "$STAGING_DIR/$file"
done

if [ ! -d "$PROJECT_ROOT/_locales" ]; then
    printf 'Required extension directory is missing: _locales\n' >&2
    exit 1
fi
cp -R "$PROJECT_ROOT/_locales" "$STAGING_DIR/_locales"

if ! grep -Fqx "importScripts('tag-utils.js');" "$STAGING_DIR/background.js"; then
    printf 'The service worker does not contain its expected local utility import.\n' >&2
    exit 1
fi
{
    cat "$STAGING_DIR/tag-utils.js"
    printf '\n'
    sed "/^importScripts('tag-utils.js');$/d" "$STAGING_DIR/background.js"
} > "$STAGING_DIR/background.bundled.js"
mv "$STAGING_DIR/background.bundled.js" "$STAGING_DIR/background.js"

mkdir -p "$RELEASE_DIR"
rm -f "$ARCHIVE"
(
    cd "$STAGING_DIR"
    zip -qr "$ARCHIVE" .
)

printf 'Extension package created: %s\n' "$ARCHIVE"
