#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
MANIFEST="$PROJECT_ROOT/manifest.json"
VERSION=$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "$MANIFEST")
PACKAGE_DEFINITION="$SCRIPT_DIR/extension-package.json"

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

node "$SCRIPT_DIR/validate-extension-package.js"

if ! command -v zip >/dev/null 2>&1; then
    printf 'The zip utility is required to create the extension archive.\n' >&2
    exit 1
fi

PACKAGE_FILES=$(node -e 'const p=require(process.argv[1]); console.log(p.files.join("\n"))' "$PACKAGE_DEFINITION")
PACKAGE_DIRECTORIES=$(node -e 'const p=require(process.argv[1]); console.log(p.directories.join("\n"))' "$PACKAGE_DEFINITION")

OLD_IFS=$IFS
IFS='
'
for file in $PACKAGE_FILES; do
    if [ ! -f "$PROJECT_ROOT/$file" ]; then
        printf 'Required extension file is missing: %s\n' "$file" >&2
        exit 1
    fi
    mkdir -p "$STAGING_DIR/$(dirname "$file")"
    cp "$PROJECT_ROOT/$file" "$STAGING_DIR/$file"
done
for directory in $PACKAGE_DIRECTORIES; do
    if [ ! -d "$PROJECT_ROOT/$directory" ]; then
        printf 'Required extension directory is missing: %s\n' "$directory" >&2
        exit 1
    fi
    mkdir -p "$STAGING_DIR/$(dirname "$directory")"
    cp -R "$PROJECT_ROOT/$directory" "$STAGING_DIR/$directory"
done
IFS=$OLD_IFS

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
