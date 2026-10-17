#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="/opt/openvpn-ui"
SERVICE_PATH="/etc/systemd/system/openvpn-ui.service"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

fail() {
  printf 'Fehler: %s\n' "$*" >&2
  exit 1
}

[[ "$(id -u)" -eq 0 ]] || fail "Bitte als root starten: sudo bash install.sh"
[[ -x "$(command -v systemctl || true)" ]] || fail "systemd/systemctl wird benötigt."
[[ -d /run/systemd/system ]] || fail "systemd ist auf diesem System nicht aktiv."

for required in \
  "${SOURCE_DIR}/backend/openvpn_ui/app.py" \
  "${SOURCE_DIR}/backend/requirements.txt" \
  "${SOURCE_DIR}/app/dist/client/index.html" \
  "${SOURCE_DIR}/deploy/openvpn-ui.service"; do
  [[ -f "$required" ]] || fail "Projektdatei fehlt: $required"
done

if [[ -e "${APP_ROOT}/backend" || -e "${APP_ROOT}/app" ]]; then
  fail "Unter ${APP_ROOT} ist bereits eine OpenVPN-UI installiert. Bestehende Installation zuerst sichern und entfernen."
fi

PACKAGE_MANAGER=""
for candidate in apt-get dnf yum zypper; do
  if command -v "$candidate" >/dev/null 2>&1; then
    PACKAGE_MANAGER="$candidate"
    break
  fi
done
[[ -n "$PACKAGE_MANAGER" ]] || fail "Kein unterstützter Paketmanager gefunden (apt, dnf, yum, zypper)."

install_packages() {
  local install_openvpn="$1"
  case "$PACKAGE_MANAGER" in
    apt-get)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update
      local packages=(python3 python3-venv python3-pip openssl iproute2 iptables curl)
      [[ "$install_openvpn" == yes ]] && packages+=(openvpn)
      apt-get install -y "${packages[@]}"
      ;;
    dnf|yum)
      local packages=(python3 python3-pip openssl iproute iptables curl)
      [[ "$install_openvpn" == yes ]] && packages+=(openvpn)
      "$PACKAGE_MANAGER" install -y "${packages[@]}"
      ;;
    zypper)
      zypper --non-interactive refresh
      local packages=(python3 python3-pip openssl iproute2 iptables curl)
      [[ "$install_openvpn" == yes ]] && packages+=(openvpn)
      zypper --non-interactive install --no-recommends -y "${packages[@]}"
      ;;
  esac
}

if command -v openvpn >/dev/null 2>&1; then
  printf 'OpenVPN gefunden: %s\n' "$(command -v openvpn)"
  install_packages no
else
  printf 'OpenVPN fehlt; installiere es über %s.\n' "$PACKAGE_MANAGER"
  install_packages yes
fi

command -v python3 >/dev/null 2>&1 || fail "python3 ist nach der Paketinstallation nicht verfügbar."
command -v openvpn >/dev/null 2>&1 || fail "openvpn ist nach der Paketinstallation nicht verfügbar."
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' || fail "Python 3.9 oder neuer wird benötigt."

mkdir -p "$APP_ROOT/data"
chmod 700 "$APP_ROOT/data"
cp -a "${SOURCE_DIR}/backend" "$APP_ROOT/backend"
mkdir -p "$APP_ROOT/app/dist"
cp -a "${SOURCE_DIR}/app/dist/client" "$APP_ROOT/app/dist/client"

python3 -m venv "${APP_ROOT}/.venv"
"${APP_ROOT}/.venv/bin/python" -m pip install --upgrade pip
"${APP_ROOT}/.venv/bin/python" -m pip install -r "${APP_ROOT}/backend/requirements.txt"

install -m 0644 "${SOURCE_DIR}/deploy/openvpn-ui.service" "$SERVICE_PATH"
systemctl daemon-reload
systemctl enable --now openvpn-ui.service

HEALTHY=0
for _ in {1..20}; do
  if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:8080/ >/dev/null; then
    HEALTHY=1
    break
  fi
  sleep 1
done
[[ "$HEALTHY" == 1 ]] || fail "Dienst ist gestartet, aber die lokale HTTP-Prüfung auf Port 8080 schlug fehl. Details: journalctl -u openvpn-ui.service"

printf '\nOpenVPN UI ist installiert. Zugriff über einen SSH-Tunnel:\n'
printf '  ssh -L 8080:127.0.0.1:8080 BENUTZER@SERVER\n'
printf 'Dann http://127.0.0.1:8080 im Browser öffnen.\n'
