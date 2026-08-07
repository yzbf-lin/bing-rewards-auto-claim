#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('${ROOT_DIR}/package.json', 'utf8')).version")"
ARCHIVE_NAME="bing-rewards-auto-claim-v${VERSION}.zip"
USERSCRIPT_NAME="bing-rewards-auto-claim-v${VERSION}.user.js"

rm -rf "${ROOT_DIR}/dist"
mkdir -p "${ROOT_DIR}/dist"

cd "${ROOT_DIR}"
zip -q -r "dist/${ARCHIVE_NAME}" manifest.json src README.md LICENSE
cp "userscript/bing-rewards-auto-claim.user.js" "dist/${USERSCRIPT_NAME}"
echo "Created dist/${ARCHIVE_NAME}"
echo "Created dist/${USERSCRIPT_NAME}"
