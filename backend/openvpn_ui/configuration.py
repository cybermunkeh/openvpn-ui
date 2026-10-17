from __future__ import annotations

import hashlib
import os
import re
import shlex
import threading
import time
from copy import deepcopy
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from .config import (
    CONFIG_BACKUP_DIR,
    OPENVPN_SERVER_CONFIG_PATH,
    OPENVPN_SERVER_SERVICE_NAME,
    PKI_DIR,
    PROFILE_DIR,
    SERVICE_NAME,
)
from .pki import load_users
from .runtime import apply_profile_runtime, parse_certificate_summary, parse_profile, run_command, service_state
from .store import load_state, save_state


CONFIG_APPLY_LOCK = threading.Lock()
MAX_CONFIG_BYTES = 1024 * 1024
OPENVPN_MANUAL_URL = "https://openvpn.net/community-docs/community-articles/openvpn-2-6-manual.html"
DIRECTIVE_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
OPTION_LINE_RE = re.compile(r"^--(?P<name>[a-z0-9][a-z0-9-]*)(?:\s+(?P<args>.*?))?\s*:\s*(?P<description>.*)$")
CATEGORY_RE = re.compile(r"^(?P<category>[A-Za-z][A-Za-z0-9 /&()+-]+) Options:$")
OPEN_TAG_RE = re.compile(r"^<(?P<tag>[a-zA-Z0-9_-]+)>$")
CLOSE_TAG_RE = re.compile(r"^</(?P<tag>[a-zA-Z0-9_-]+)>$")

CRITICAL_DIRECTIVES = {
    "auth-user-pass-verify",
    "client-connect",
    "client-disconnect",
    "down",
    "ipchange",
    "learn-address",
    "management",
    "plugin",
    "route-pre-down",
    "route-up",
    "script-security",
    "tls-verify",
    "up",
}
SENSITIVE_DIRECTIVES = {
    "askpass",
    "auth-user-pass",
    "ca",
    "cert",
    "extra-certs",
    "key",
    "management-client-auth",
    "management-client-pf",
    "pkcs12",
    "pkcs11-id",
    "secret",
    "tls-auth",
    "tls-crypt",
    "tls-crypt-v2",
}
SENSITIVE_BLOCKS = {"ca", "cert", "extra-certs", "key", "pkcs12", "secret", "tls-auth", "tls-crypt", "tls-crypt-v2"}
REPEATABLE_DIRECTIVES = {"connection", "dhcp-option", "http-proxy-option", "ignore-unknown-option", "push", "pull-filter", "remote", "route", "route-ipv6", "setenv"}
SERVER_DIRECTIVES = {"client-config-dir", "duplicate-cn", "ifconfig-pool", "ifconfig-pool-persist", "mode", "push", "server", "server-bridge", "server-ipv6", "verify-client-cert"}
CLIENT_DIRECTIVES = {"auth-retry", "auth-user-pass", "client", "connect-retry", "connect-retry-max", "nobind", "pull", "pull-filter", "remote", "remote-cert-tls", "resolv-retry"}

FALLBACK_HELP = """OpenVPN configuration options

General Options:
--config file : Read configuration options from file.
--verb n : Set output verbosity.
--status file [n] : Write operational status to file.

Tunnel Options:
--client : Enable client mode.
--server network netmask : Enable server mode.
--remote host [port] [proto] : Configure a remote peer.
--port port : Configure the local and remote port.
--proto protocol : Configure the transport protocol.
--dev device : Configure the tunnel device.
--route network [netmask] [gateway] [metric] : Add an IPv4 route.
--route-ipv6 network/bits [gateway] [metric] : Add an IPv6 route.
--push option : Push an option to clients.
--dhcp-option type [value] : Configure DHCP-derived options.
--mssfix max [mtu|fixed] : Limit TCP MSS.

Cryptographic Options:
--ca file : Configure the certificate authority.
--cert file : Configure the local certificate.
--key file : Configure the local private key.
--tls-auth file [direction] : Add TLS authentication.
--tls-crypt file : Encrypt and authenticate the control channel.
--data-ciphers list : Configure negotiated data ciphers.
--auth digest : Configure the packet authentication digest.

Script Options:
--script-security level : Configure external script execution.
--up command : Run a command after opening the tunnel.
--down command : Run a command after closing the tunnel.
"""


class ConfigurationConflict(RuntimeError):
    pass


class ConfigurationApplyError(RuntimeError):
    pass


def config_revision(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _directive_risk(name: str, description: str) -> str:
    lowered = description.lower()
    if name in CRITICAL_DIRECTIVES:
        return "critical"
    if name in SENSITIVE_DIRECTIVES:
        return "sensitive"
    if "deprecated" in lowered or "removed" in lowered or "no longer" in lowered:
        return "deprecated"
    return "normal"


def _directive_context(name: str, category: str, description: str) -> str:
    combined = f"{category} {description}".lower()
    if "standalone" in combined:
        return "standalone"
    if name in SERVER_DIRECTIVES or "server options" in combined:
        return "server"
    if name in CLIENT_DIRECTIVES or "client options" in combined:
        return "client"
    return "both"


def parse_option_catalog(help_text: str) -> list[dict[str, Any]]:
    catalog: list[dict[str, Any]] = []
    current_category = "Other"
    current: dict[str, Any] | None = None

    for raw_line in help_text.splitlines():
        line = raw_line.rstrip()
        category_match = CATEGORY_RE.match(line.strip())
        if category_match:
            current_category = category_match.group("category").strip()
            current = None
            continue

        option_match = OPTION_LINE_RE.match(line.strip())
        if option_match:
            name = option_match.group("name")
            arguments = (option_match.group("args") or "").strip()
            description = option_match.group("description").strip()
            current = {
                "name": name,
                "syntax": f"{name} {arguments}".strip(),
                "arguments": arguments,
                "description": description,
                "category": current_category,
                "risk": _directive_risk(name, description),
                "context": _directive_context(name, current_category, description),
                "repeatable": name in REPEATABLE_DIRECTIVES or "multiple" in description.lower() or "repeat" in description.lower(),
            }
            catalog.append(current)
            continue

        if current and line.startswith(" ") and line.strip():
            continuation = line.strip()
            current["description"] = f"{current['description']} {continuation}".strip()[:600]
            current["risk"] = _directive_risk(current["name"], current["description"])
            current["context"] = _directive_context(current["name"], current["category"], current["description"])

    unique: dict[str, dict[str, Any]] = {}
    for entry in catalog:
        unique.setdefault(entry["name"], entry)
    return sorted(unique.values(), key=lambda entry: (entry["category"].lower(), entry["name"]))


@lru_cache(maxsize=1)
def get_configuration_catalog() -> list[dict[str, Any]]:
    result = run_command(["openvpn", "--help"], check=False, timeout=15)
    catalog = parse_option_catalog(result.stdout or result.stderr)
    return catalog or parse_option_catalog(FALLBACK_HELP)


@lru_cache(maxsize=1)
def get_openvpn_version() -> str:
    result = run_command(["openvpn", "--version"], check=False, timeout=10)
    if result.returncode != 0:
        return "OpenVPN unavailable"
    first_line = (result.stdout or result.stderr).splitlines()
    return first_line[0].strip() if first_line else "OpenVPN unavailable"


def _public_target(target: dict[str, Any]) -> dict[str, Any]:
    service_name = target.get("serviceName")
    state = "not-applicable"
    if service_name:
        result = run_command(["systemctl", "is-active", service_name], check=False, timeout=5)
        state = result.stdout.strip() or "inactive"
    path = Path(target["path"])
    return {
        "id": target["id"],
        "label": target["label"],
        "kind": target["kind"],
        "mode": target["mode"],
        "path": str(path),
        "exists": path.is_file(),
        "containsSecrets": bool(target.get("containsSecrets")),
        "serviceName": service_name,
        "serviceState": state,
        "restartAvailable": bool(service_name),
    }


def _configuration_targets() -> list[dict[str, Any]]:
    state = load_state()
    targets: list[dict[str, Any]] = [{
        "id": "server",
        "label": "OpenVPN Server",
        "kind": "server",
        "mode": "server",
        "path": OPENVPN_SERVER_CONFIG_PATH,
        "serviceName": OPENVPN_SERVER_SERVICE_NAME,
        "containsSecrets": False,
    }]

    for profile in state["profiles"].values():
        path = PROFILE_DIR / profile["id"] / "profile.ovpn"
        if profile.get("profileRole") == "issued-client" or profile.get("configState") != "imported" or not path.is_file():
            continue
        targets.append({
            "id": f"profile:{profile['id']}",
            "label": f"Imported profile: {profile['name']}",
            "kind": "profile",
            "mode": "client",
            "path": path,
            "serviceName": SERVICE_NAME if state.get("current_profile_id") == profile["id"] else None,
            "containsSecrets": True,
            "profileId": profile["id"],
        })

    for user_id, user in load_users().items():
        path = PKI_DIR / "clients" / user_id / "client.ovpn"
        if not path.is_file():
            continue
        targets.append({
            "id": f"user:{user_id}",
            "label": f"User profile: {user['name']}",
            "kind": "user",
            "mode": "client",
            "path": path,
            "serviceName": None,
            "containsSecrets": True,
            "userId": user_id,
        })
    return targets


def list_configuration_targets() -> list[dict[str, Any]]:
    return [_public_target(target) for target in _configuration_targets()]


def _resolve_target(target_id: str) -> dict[str, Any]:
    for target in _configuration_targets():
        if target["id"] == target_id:
            return target
    raise KeyError(target_id)


def _issue(code: str, message: str, line: int | None = None) -> dict[str, Any]:
    issue: dict[str, Any] = {"code": code, "message": message}
    if line is not None:
        issue["line"] = line
    return issue


def validate_config_text(content: str, catalog: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    entries: list[dict[str, Any]] = []
    encoded = content.encode("utf-8")
    if len(encoded) > MAX_CONFIG_BYTES:
        errors.append(_issue("config-too-large", f"Configuration exceeds {MAX_CONFIG_BYTES} bytes"))
    if "\x00" in content:
        errors.append(_issue("nul-byte", "Configuration contains a NUL byte"))

    effective_catalog = catalog if catalog is not None else get_configuration_catalog()
    by_name = {entry["name"]: entry for entry in effective_catalog}
    block_stack: list[tuple[str, int, int]] = []
    critical_count = 0
    sensitive_count = 0

    for line_number, raw_line in enumerate(content.splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped or stripped.startswith(("#", ";")):
            continue

        open_match = OPEN_TAG_RE.match(stripped)
        if open_match:
            tag = open_match.group("tag").lower()
            if block_stack and block_stack[-1][0] != "connection":
                errors.append(_issue("nested-inline-block", f"Inline block <{tag}> is nested inside <{block_stack[-1][0]}>", line_number))
            entry_index = len(entries)
            entries.append({
                "type": "block",
                "name": tag,
                "arguments": "Inline block",
                "line": line_number,
                "known": tag in by_name or tag in SENSITIVE_BLOCKS or tag == "connection",
                "risk": "sensitive" if tag in SENSITIVE_BLOCKS else "normal",
                "sensitive": tag in SENSITIVE_BLOCKS,
                "hiddenLines": 0,
            })
            if tag in SENSITIVE_BLOCKS:
                sensitive_count += 1
            block_stack.append((tag, line_number, entry_index))
            continue

        close_match = CLOSE_TAG_RE.match(stripped)
        if close_match:
            tag = close_match.group("tag").lower()
            if not block_stack:
                errors.append(_issue("unexpected-inline-close", f"Unexpected closing tag </{tag}>", line_number))
                continue
            open_tag, open_line, entry_index = block_stack.pop()
            if open_tag != tag:
                errors.append(_issue("mismatched-inline-block", f"<{open_tag}> on line {open_line} closes as </{tag}>", line_number))
            entries[entry_index]["hiddenLines"] = max(0, line_number - open_line - 1)
            continue

        if block_stack and block_stack[-1][0] != "connection":
            continue

        try:
            parts = shlex.split(raw_line, posix=True, comments=False)
        except ValueError as exc:
            errors.append(_issue("parse-error", str(exc), line_number))
            continue
        if not parts:
            continue
        name = parts[0].removeprefix("--").lower()
        if not DIRECTIVE_RE.fullmatch(name):
            errors.append(_issue("invalid-directive", f"Invalid directive name: {parts[0]}", line_number))
            continue
        catalog_entry = by_name.get(name)
        risk = catalog_entry["risk"] if catalog_entry else ("critical" if name in CRITICAL_DIRECTIVES else "sensitive" if name in SENSITIVE_DIRECTIVES else "normal")
        entries.append({
            "type": "directive",
            "name": name,
            "arguments": raw_line.strip()[len(parts[0]):].strip(),
            "line": line_number,
            "known": bool(catalog_entry),
            "risk": risk,
            "sensitive": risk == "sensitive",
        })
        if risk == "critical":
            critical_count += 1
        if risk == "sensitive":
            sensitive_count += 1
        if by_name and not catalog_entry:
            warnings.append(_issue("unknown-directive", f"Directive '{name}' is not listed by the installed OpenVPN help output", line_number))
        elif catalog_entry and catalog_entry["context"] == "standalone":
            warnings.append(_issue("standalone-directive", f"Directive '{name}' is documented as standalone and may not be valid in a configuration file", line_number))
        elif risk == "deprecated":
            warnings.append(_issue("deprecated-directive", f"Directive '{name}' is deprecated or removed", line_number))

    for tag, open_line, _entry_index in block_stack:
        errors.append(_issue("unclosed-inline-block", f"Inline block <{tag}> is not closed", open_line))

    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "entries": entries,
        "lineCount": len(content.splitlines()),
        "byteCount": len(encoded),
        "directiveCount": sum(1 for entry in entries if entry["type"] == "directive"),
        "blockCount": sum(1 for entry in entries if entry["type"] == "block"),
        "criticalCount": critical_count,
        "sensitiveCount": sensitive_count,
        "hasCritical": critical_count > 0,
    }


def _read_target(target: dict[str, Any]) -> str:
    path = Path(target["path"])
    return path.read_text(encoding="utf-8", errors="replace") if path.is_file() else ""


def get_configuration(target_id: str | None = None) -> dict[str, Any]:
    targets = _configuration_targets()
    if not targets:
        raise RuntimeError("No OpenVPN configuration targets are available")
    target = next((entry for entry in targets if entry["id"] == target_id), None) if target_id else targets[0]
    if target is None:
        raise KeyError(target_id)
    content = _read_target(target)
    catalog = get_configuration_catalog()
    return {
        "target": _public_target(target),
        "targets": [_public_target(entry) for entry in targets],
        "content": content,
        "revision": config_revision(content),
        "version": get_openvpn_version(),
        "catalog": catalog,
        "catalogCount": len(catalog),
        "manualUrl": OPENVPN_MANUAL_URL,
        "validation": validate_config_text(content, catalog),
    }


def validate_configuration(target_id: str, content: str) -> dict[str, Any]:
    target = _resolve_target(target_id)
    catalog = get_configuration_catalog()
    return {
        "target": _public_target(target),
        "validation": validate_config_text(content, catalog),
        "version": get_openvpn_version(),
    }


def _atomic_write(path: Path, content: str, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.openvpn-ui-{os.getpid()}.tmp")
    temporary.write_text(content, encoding="utf-8", newline="\n")
    os.chmod(temporary, mode)
    temporary.replace(path)


def _restore_path(path: Path, existed: bool, content: str, mode: int) -> None:
    if existed:
        _atomic_write(path, content, mode)
    else:
        path.unlink(missing_ok=True)


def _service_active(service_name: str) -> bool:
    return run_command(["systemctl", "is-active", service_name], check=False, timeout=5).returncode == 0


def _wait_service_active(service_name: str, timeout_seconds: float = 8.0) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if _service_active(service_name):
            return True
        time.sleep(0.25)
    return False


def _backup_config(target: dict[str, Any], content: str) -> Path:
    target_dir = CONFIG_BACKUP_DIR / re.sub(r"[^a-zA-Z0-9_.-]+", "-", target["id"])
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    backup_path = target_dir / f"{stamp}.conf"
    backup_path.write_text(content, encoding="utf-8", newline="\n")
    os.chmod(backup_path, 0o600)
    return backup_path


def _profile_candidate(profile: dict[str, Any], content: str) -> dict[str, Any]:
    candidate = deepcopy(profile)
    parsed = parse_profile(content)
    candidate["remoteAddress"] = parsed["remote_address"]
    candidate["port"] = parsed["port"]
    candidate["protocol"] = parsed["protocol"]
    candidate["certificate"] = parse_certificate_summary(content)
    candidate["configState"] = "imported"
    return candidate


def apply_configuration(
    target_id: str,
    content: str,
    revision: str,
    acknowledge_risk: bool,
    restart: bool,
) -> dict[str, Any]:
    if not isinstance(content, str):
        raise ValueError("Configuration content must be text")
    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    if normalized and not normalized.endswith("\n"):
        normalized += "\n"
    catalog = get_configuration_catalog()
    validation = validate_config_text(normalized, catalog)
    if not validation["valid"]:
        first_error = validation["errors"][0]["message"] if validation["errors"] else "Configuration is invalid"
        raise ValueError(first_error)
    if not acknowledge_risk:
        raise ValueError("Applying configuration requires explicit risk acknowledgement")

    with CONFIG_APPLY_LOCK:
        target = _resolve_target(target_id)
        path = Path(target["path"])
        existed = path.is_file()
        previous = _read_target(target)
        if config_revision(previous) != revision:
            raise ConfigurationConflict("Configuration changed on disk; reload it before applying your edits")
        previous_mode = path.stat().st_mode & 0o777 if existed else 0o600
        backup_path = _backup_config(target, previous)
        service_name = target.get("serviceName")
        was_active = _service_active(service_name) if service_name else False
        restarted = False
        previous_profile: dict[str, Any] | None = None
        profile_runtime_applied = False

        try:
            _atomic_write(path, normalized, previous_mode)
            if target["kind"] == "server" and restart:
                run_command(["systemctl", "restart", service_name], check=True, timeout=30)
                if not _wait_service_active(service_name):
                    raise RuntimeError(f"{service_name} did not become active")
                restarted = True
            elif target["kind"] == "profile":
                state = load_state()
                profile = state["profiles"].get(target["profileId"])
                if not profile:
                    raise RuntimeError(f"Profile {target['profileId']} disappeared while applying configuration")
                previous_profile = deepcopy(profile)
                candidate = _profile_candidate(profile, normalized)
                is_active = bool(state.get("current_profile_id") == target["profileId"] and service_state() == "active")
                if is_active and restart:
                    apply_profile_runtime(candidate, activate=True)
                    profile_runtime_applied = True
                    restarted = True
                state["profiles"][target["profileId"]] = candidate
                save_state(state)
            elif target["kind"] == "user":
                state = load_state()
                profile = state["profiles"].get(target["userId"])
                if profile and profile.get("profileRole") == "issued-client":
                    state["profiles"][target["userId"]] = _profile_candidate(profile, normalized)
                    save_state(state)
        except Exception as exc:
            rollback_errors: list[str] = []
            try:
                _restore_path(path, existed, previous, previous_mode)
            except OSError as rollback_exc:
                rollback_errors.append(str(rollback_exc))
            if profile_runtime_applied and previous_profile:
                try:
                    apply_profile_runtime(previous_profile, activate=True)
                except Exception as rollback_exc:
                    rollback_errors.append(str(rollback_exc))
            elif service_name:
                try:
                    if was_active:
                        run_command(["systemctl", "restart", service_name], check=True, timeout=30)
                    else:
                        run_command(["systemctl", "stop", service_name], check=False, timeout=15)
                except Exception as rollback_exc:
                    rollback_errors.append(str(rollback_exc))
            suffix = f" Rollback errors: {'; '.join(rollback_errors)}" if rollback_errors else " Previous configuration restored."
            raise ConfigurationApplyError(f"Configuration apply failed: {exc}.{suffix}") from exc

    result = get_configuration(target_id)
    result["apply"] = {
        "state": "applied",
        "appliedAt": datetime.now(timezone.utc).isoformat(),
        "backupPath": str(backup_path),
        "restarted": restarted,
        "rolledBack": False,
        "message": "Configuration applied and service verified." if restarted else "Configuration saved. No service restart was required.",
    }
    return result
