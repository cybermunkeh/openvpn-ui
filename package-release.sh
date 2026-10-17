#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
VERSION="$(tr -d '[:space:]' < "${ROOT}/VERSION")"
OUTPUT_DIR="${1:-${ROOT}/dist}"
ARCHIVE="${OUTPUT_DIR}/openvpn-ui-v${VERSION}-linux.tar.gz"

[[ -n "$VERSION" ]] || { echo "VERSION ist leer" >&2; exit 1; }
for required in \
  README.md \
  install.sh \
  backend/openvpn_ui/app.py \
  backend/requirements.txt \
  app/dist/client/index.html \
  deploy/openvpn-ui.service; do
  [[ -f "${ROOT}/${required}" ]] || { echo "Datei fehlt: ${required}" >&2; exit 1; }
done

mkdir -p "$OUTPUT_DIR"
tar -C "$ROOT" -czf "$ARCHIVE" \
  README.md VERSION install.sh \
  backend/openvpn_ui backend/requirements.txt \
  app/dist/client deploy/openvpn-ui.service
(
  cd "$OUTPUT_DIR"
  sha256sum "$(basename -- "$ARCHIVE")" > "$(basename -- "$ARCHIVE").sha256"
)

printf 'Release-Paket: %s\n' "$ARCHIVE"
printf 'Prüfsumme: %s\n' "${ARCHIVE}.sha256"
