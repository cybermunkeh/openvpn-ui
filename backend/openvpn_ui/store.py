from __future__ import annotations

import json
import shutil
from copy import deepcopy
from pathlib import Path
from typing import Any

from .config import DATA_DIR, PROFILE_DIR, STATE_PATH


DEFAULT_STATE: dict[str, Any] = {
    "selected_profile_id": None,
    "current_profile_id": None,
    "operator": "operator",
    "service_version": "OpenVPN",
    "profile_groups": [
        {"id": "hub", "label": "Hub (This Device)", "profile_ids": []},
        {"id": "remote-sites", "label": "Remote Sites", "profile_ids": []},
        {"id": "road-warriors", "label": "Road Warriors", "profile_ids": []},
    ],
    "navigation": [
        {"id": "dashboard", "label": "Dashboard"},
        {"id": "topology", "label": "Topology"},
        {"id": "profiles", "label": "Profiles"},
        {"id": "policies", "label": "Policies"},
        {"id": "configuration", "label": "OpenVPN Config"},
        {"id": "diagnostics", "label": "Diagnostics"},
        {"id": "ufw", "label": "UFW"},
        {"id": "certificates", "label": "Certificates"},
        {"id": "logs", "label": "Logs"},
        {"id": "settings", "label": "Settings"},
    ],
    "profiles": {},
}


def ensure_state_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)


def _normalize_state(state: dict[str, Any]) -> dict[str, Any]:
    merged = deepcopy(DEFAULT_STATE)
    merged.update(state)

    navigation_by_id = {entry["id"]: entry for entry in state.get("navigation", []) if isinstance(entry, dict) and entry.get("id")}
    merged["navigation"] = [navigation_by_id.get(entry["id"], entry) for entry in DEFAULT_STATE["navigation"]]

    groups_by_id = {entry["id"]: entry for entry in state.get("profile_groups", []) if isinstance(entry, dict) and entry.get("id")}
    merged["profile_groups"] = [groups_by_id.get(entry["id"], entry) for entry in DEFAULT_STATE["profile_groups"]]
    return merged


def load_state() -> dict[str, Any]:
    ensure_state_dirs()

    if not STATE_PATH.exists():
        state = deepcopy(DEFAULT_STATE)
        save_state(state)
        return state

    return _normalize_state(json.loads(STATE_PATH.read_text(encoding="utf-8")))


def save_state(state: dict[str, Any]) -> None:
    ensure_state_dirs()
    temp_path = Path(f"{STATE_PATH}.tmp")
    temp_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
    temp_path.replace(STATE_PATH)


def reset_state() -> dict[str, Any]:
    state = deepcopy(DEFAULT_STATE)
    save_state(state)
    return state


def clear_profiles_and_state() -> dict[str, Any]:
    ensure_state_dirs()
    for path in PROFILE_DIR.iterdir():
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)
    return reset_state()


def get_group(state: dict[str, Any], group_id: str) -> dict[str, Any]:
    for group in state["profile_groups"]:
        if group["id"] == group_id:
            return group
    raise KeyError(group_id)


def build_profile_record(
    *,
    profile_id: str,
    name: str,
    group: str,
    remote_address: str = "Not configured",
    port: int = 1194,
    protocol: str = "UDP",
    config_state: str = "draft",
    summary: str | None = None,
    certificate: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": profile_id,
        "group": group,
        "kind": "site" if group != "road-warriors" else "roadwarrior",
        "name": name,
        "shortName": name,
        "status": "disconnected",
        "summary": summary or ("Imported profile" if config_state == "imported" else "Draft profile"),
        "configState": config_state,
        "tunnelIp": "Pending",
        "localIp": "Pending",
        "remoteAddress": remote_address,
        "port": port,
        "protocol": protocol,
        "cipher": "Imported from profile" if config_state == "imported" else "Not configured",
        "tlsVersion": "Negotiated at connect time" if config_state == "imported" else "No certificate loaded",
        "compression": "Profile default" if config_state == "imported" else "Not configured",
        "keepalive": "Profile default" if config_state == "imported" else "Not configured",
        "uptime": "0m 00s",
        "bytesIn": "0.0 MB",
        "bytesOut": "0.0 MB",
        "routeMode": "full",
        "includedSubnets": [],
        "excludedSubnets": [],
        "security": {
            "killSwitch": False,
            "blockLanOnVpnDown": False,
            "dnsMode": "VPN DNS Only",
            "dnsServers": [],
            "dnsProtection": True,
            "ipv6LeakProtection": True,
            "autoReconnect": True,
            "startOnBoot": False,
        },
        "policyRuntime": {
            "state": "not-applied" if config_state == "imported" else "draft",
            "appliedAt": None,
            "message": "Connect this profile to enforce its policies." if config_state == "imported" else "Import a real OpenVPN config before applying policies.",
            "restarted": False,
            "rolledBack": False,
        },
        "certificate": certificate or {
            "valid": False,
            "peerCertificate": "Unavailable",
            "issuedBy": "Unavailable",
            "validFrom": "Unavailable",
            "validTo": "Unavailable",
            "daysRemaining": 0,
        },
        "metrics": {
            "connectionUptime": "0m 00s",
            "latency": "n/a",
            "handshakeAge": "--:--:--",
        },
        "routeRows": [],
        "dnsRows": [],
        "networks": [],
        "events": [],
    }
