from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
STATIC_DIR = Path(os.environ.get("OPENVPN_UI_STATIC_DIR", REPO_ROOT / "app" / "dist" / "client"))
DATA_DIR = Path(os.environ.get("OPENVPN_UI_DATA_DIR", "/opt/openvpn-ui/data"))
PROFILE_DIR = DATA_DIR / "profiles"
POLICY_DIR = DATA_DIR / "policy"
CONFIG_BACKUP_DIR = DATA_DIR / "config-backups"
STATE_PATH = DATA_DIR / "state.json"
OPENVPN_CLIENT_DIR = Path(os.environ.get("OPENVPN_UI_OPENVPN_CLIENT_DIR", "/etc/openvpn/client"))
MANAGED_PROFILE_NAME = os.environ.get("OPENVPN_UI_MANAGED_PROFILE_NAME", "codex")
MANAGED_PROFILE_PATH = OPENVPN_CLIENT_DIR / f"{MANAGED_PROFILE_NAME}.conf"
SYSTEMD_OVERRIDE_DIR = Path(f"/etc/systemd/system/openvpn-client@{MANAGED_PROFILE_NAME}.service.d")
MANAGED_POLICY_SCRIPT_PATH = POLICY_DIR / "apply-client-policy.sh"
SERVICE_NAME = f"openvpn-client@{MANAGED_PROFILE_NAME}.service"
PKI_DIR = DATA_DIR / "pki"
PKI_USERS_PATH = PKI_DIR / "users.json"
PKI_METADATA_PATH = PKI_DIR / "metadata.json"
OPENVPN_SERVER_DIR = Path(os.environ.get("OPENVPN_UI_OPENVPN_SERVER_DIR", "/etc/openvpn/server"))
OPENVPN_SERVER_NAME = os.environ.get("OPENVPN_UI_OPENVPN_SERVER_NAME", "codex-server")
OPENVPN_SERVER_CONFIG_PATH = OPENVPN_SERVER_DIR / f"{OPENVPN_SERVER_NAME}.conf"
OPENVPN_SERVER_SERVICE_NAME = f"openvpn-server@{OPENVPN_SERVER_NAME}.service"
OPENVPN_SERVER_RUNTIME_STATUS_PATH = Path(f"/run/openvpn-server/status-{OPENVPN_SERVER_NAME}.log")
OPENVPN_FORWARDING_SYSCTL_PATH = Path("/etc/sysctl.d/99-openvpn-ui-forwarding.conf")
OPENVPN_FIREWALL_SERVICE_NAME = "openvpn-ui-firewall.service"
OPENVPN_FIREWALL_SERVICE_PATH = Path(f"/etc/systemd/system/{OPENVPN_FIREWALL_SERVICE_NAME}")
OPENVPN_FIREWALL_SCRIPT_PATH = PKI_DIR / "apply-firewall.sh"
PIHOLE_SETUPVARS_PATH = Path("/etc/pihole/setupVars.conf")
PIHOLE_INSTALLER_PATH = PKI_DIR / "pihole-basic-install.sh"
PIHOLE_FTL_SERVICE_NAME = "pihole-FTL.service"
