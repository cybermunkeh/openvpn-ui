from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Any

from .runtime import run_command


def _ufw_binary() -> str | None:
    candidates = [shutil.which("ufw"), "/usr/sbin/ufw", "/sbin/ufw"]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    return None


def _status_state(output: str) -> str:
    for line in output.splitlines():
        if line.startswith("Status:"):
            return line.split(":", 1)[1].strip()
    return "unknown"


def _parse_verbose(output: str) -> dict[str, str]:
    data = {
        "status": _status_state(output),
        "logging": "unknown",
        "defaultIncoming": "unknown",
        "defaultOutgoing": "unknown",
        "defaultRouted": "unknown",
        "newProfiles": "unknown",
    }
    default_pattern = re.compile(
        r"^Default:\s*(?P<incoming>[^,]+),\s*(?P<outgoing>[^,]+),\s*(?P<routed>.+)$",
        flags=re.IGNORECASE,
    )

    for raw_line in output.splitlines():
        line = raw_line.strip()
        if line.startswith("Logging:"):
            data["logging"] = line.split(":", 1)[1].strip()
        elif line.startswith("New profiles:"):
            data["newProfiles"] = line.split(":", 1)[1].strip()
        else:
            match = default_pattern.match(line)
            if not match:
                continue
            data["defaultIncoming"] = match.group("incoming").strip()
            data["defaultOutgoing"] = match.group("outgoing").strip()
            data["defaultRouted"] = match.group("routed").strip()

    return data


def _parse_numbered_rules(output: str) -> list[dict[str, Any]]:
    rules: list[dict[str, Any]] = []
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line.startswith("["):
            continue
        match = re.match(r"^\[\s*(?P<index>\d+)\]\s+(?P<body>.+)$", line)
        if not match:
            continue
        columns = re.split(r"\s{2,}", match.group("body").strip(), maxsplit=2)
        if len(columns) < 3:
            continue
        action_parts = columns[1].split()
        rules.append({
            "index": int(match.group("index")),
            "to": columns[0].strip(),
            "action": columns[1].strip(),
            "from": columns[2].strip(),
            "mode": "route" if "FWD" in columns[1] else "host",
            "actionVerb": action_parts[0].lower() if action_parts else "allow",
            "actionScope": " ".join(action_parts[1:]).lower() if len(action_parts) > 1 else "",
            "raw": line,
        })
    return rules


def get_ufw_dashboard() -> dict[str, Any]:
    binary = _ufw_binary()
    if not binary:
        return {
            "installed": False,
            "available": False,
            "status": "not-installed",
            "logging": "unknown",
            "defaultIncoming": "unknown",
            "defaultOutgoing": "unknown",
            "defaultRouted": "unknown",
            "newProfiles": "unknown",
            "ruleCount": 0,
            "rules": [],
            "rawStatus": "",
        }

    verbose = run_command([binary, "status", "verbose"], check=False)
    numbered = run_command([binary, "status", "numbered"], check=False)
    verbose_text = verbose.stdout.strip()
    parsed = _parse_verbose(verbose_text)
    rules = _parse_numbered_rules(numbered.stdout)
    return {
        "installed": True,
        "available": True,
        "status": parsed["status"],
        "logging": parsed["logging"],
        "defaultIncoming": parsed["defaultIncoming"],
        "defaultOutgoing": parsed["defaultOutgoing"],
        "defaultRouted": parsed["defaultRouted"],
        "newProfiles": parsed["newProfiles"],
        "ruleCount": len(rules),
        "rules": rules,
        "rawStatus": verbose_text,
    }


def _require_ufw_binary() -> str:
    binary = _ufw_binary()
    if not binary:
        raise RuntimeError("UFW is not installed on this host")
    return binary


def control_ufw(action: str) -> dict[str, Any]:
    binary = _require_ufw_binary()
    if action == "enable":
        run_command([binary, "--force", "enable"], check=True)
    elif action == "disable":
        run_command([binary, "--force", "disable"], check=True)
    elif action == "reload":
        run_command([binary, "reload"], check=True)
    else:
        raise ValueError("Unsupported UFW action")
    return get_ufw_dashboard()


def _normalize_rule_mode(value: Any) -> str:
    mode = str(value or "host").strip().lower()
    if mode not in {"host", "route"}:
        raise ValueError("Rule mode must be host or route")
    return mode


def _normalize_rule_action(value: Any) -> str:
    action = str(value or "allow").strip().lower()
    if action not in {"allow", "deny", "reject", "limit"}:
        raise ValueError("Rule action must be allow, deny, reject, or limit")
    return action


def _normalize_protocol(value: Any) -> str:
    protocol = str(value or "any").strip().lower()
    if protocol not in {"any", "tcp", "udp"}:
        raise ValueError("Protocol must be any, tcp, or udp")
    return protocol


def _normalize_port(value: Any) -> str:
    port = str(value or "").strip()
    if not port:
        return ""
    if not re.match(r"^\d+(:\d+)?$", port):
        raise ValueError("Port must be a single port or range like 80:90")
    return port


def add_ufw_rule(payload: dict[str, Any]) -> dict[str, Any]:
    binary = _require_ufw_binary()
    mode = _normalize_rule_mode(payload.get("mode", "host"))
    action = _normalize_rule_action(payload.get("action", "allow"))
    protocol = _normalize_protocol(payload.get("protocol", "any"))
    port = _normalize_port(payload.get("port", ""))
    source = str(payload.get("source", "any")).strip() or "any"
    destination = str(payload.get("destination", "any")).strip() or "any"
    in_interface = str(payload.get("inInterface", "")).strip()
    out_interface = str(payload.get("outInterface", "")).strip()

    args = [binary]
    if mode == "route":
        if not in_interface or not out_interface:
            raise ValueError("Route rules require both inInterface and outInterface")
        args.extend(["route", action, "in", "on", in_interface, "out", "on", out_interface])
    else:
        args.append(action)

    args.extend(["from", source, "to", destination])
    if port:
        args.extend(["port", port])
    if protocol != "any":
        args.extend(["proto", protocol])

    run_command(args, check=True)
    return get_ufw_dashboard()


def delete_ufw_rule(index: int) -> dict[str, Any]:
    binary = _require_ufw_binary()
    if index <= 0:
        raise ValueError("Rule index must be a positive integer")
    run_command([binary, "--force", "delete", str(index)], check=True)
    return get_ufw_dashboard()
