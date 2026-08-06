#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('${ROOT_DIR}/package.json', 'utf8')).version")"
ARCHIVE_NAME="bing-rewards-auto-claim-v${VERSION}.zip"

rm -rf "${ROOT_DIR}/dist"
mkdir -p "${ROOT_DIR}/dist"

cd "${ROOT_DIR}"
zip -q -r "dist/${ARCHIVE_NAME}" manifest.json src README.md LICENSE
echo "Created dist/${ARCHIVE_NAME}"
