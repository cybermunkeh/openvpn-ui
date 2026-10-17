from __future__ import annotations

import csv
import ipaddress
import json
import os
import re
import shutil
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import (
    MANAGED_PROFILE_PATH,
    OPENVPN_FORWARDING_SYSCTL_PATH,
    OPENVPN_FIREWALL_SCRIPT_PATH,
    OPENVPN_FIREWALL_SERVICE_NAME,
    OPENVPN_FIREWALL_SERVICE_PATH,
    OPENVPN_CLIENT_DIR,
    OPENVPN_SERVER_CONFIG_PATH,
    OPENVPN_SERVER_DIR,
    OPENVPN_SERVER_NAME,
    OPENVPN_SERVER_RUNTIME_STATUS_PATH,
    OPENVPN_SERVER_SERVICE_NAME,
    PIHOLE_FTL_SERVICE_NAME,
    PIHOLE_INSTALLER_PATH,
    PIHOLE_SETUPVARS_PATH,
    PKI_DIR,
    PKI_METADATA_PATH,
    PKI_USERS_PATH,
    SERVICE_NAME,
    SYSTEMD_OVERRIDE_DIR,
)
from .runtime import run_command, slugify
from .store import clear_profiles_and_state
from .telemetry import collect_system_telemetry


CA_CERT_PATH = PKI_DIR / "ca.crt"
CA_KEY_PATH = PKI_DIR / "private" / "ca.key"
CA_SERIAL_PATH = PKI_DIR / "serial"
CRL_NUMBER_PATH = PKI_DIR / "crlnumber"
CRL_PATH = PKI_DIR / "crl.pem"
INDEX_PATH = PKI_DIR / "index.txt"
OPENSSL_CONFIG_PATH = PKI_DIR / "openssl.cnf"
CERTS_DIR = PKI_DIR / "certs"
PRIVATE_DIR = PKI_DIR / "private"
REQS_DIR = PKI_DIR / "reqs"
CLIENTS_DIR = PKI_DIR / "clients"
SERVER_KEY_PATH = PRIVATE_DIR / "server.key"
SERVER_CSR_PATH = REQS_DIR / "server.csr"
SERVER_CERT_PATH = CERTS_DIR / "server.crt"
TLS_CRYPT_KEY_PATH = PKI_DIR / "ta.key"
IPP_PATH = PKI_DIR / "ipp.txt"
CCD_DIR = PKI_DIR / "ccd"
STATUS_LOG_PATH = PKI_DIR / "status.log"


DEFAULT_PKI_METADATA: dict[str, Any] = {
    "initialized": False,
    "serverName": OPENVPN_SERVER_NAME,
    "publicHost": "",
    "protocol": "udp",
    "port": 1194,
    "tunnelNetwork": "10.8.0.0/24",
    "dnsMode": "custom",
    "dnsServer": "1.1.1.1",
    "piHoleUpstreamDns": ["1.1.1.1", "1.0.0.1"],
    "egressInterface": "",
    "firewallBackend": "unavailable",
    "createdAt": None,
    "updatedAt": None,
}


def ensure_pki_dirs() -> None:
    for path in (PKI_DIR, CERTS_DIR, PRIVATE_DIR, REQS_DIR, CLIENTS_DIR, CCD_DIR):
        path.mkdir(parents=True, exist_ok=True)


def load_pki_metadata() -> dict[str, Any]:
    ensure_pki_dirs()
    if not PKI_METADATA_PATH.exists():
        return dict(DEFAULT_PKI_METADATA)
    data = json.loads(PKI_METADATA_PATH.read_text(encoding="utf-8"))
    merged = dict(DEFAULT_PKI_METADATA)
    merged.update(data)
    return merged


def save_pki_metadata(metadata: dict[str, Any]) -> None:
    ensure_pki_dirs()
    PKI_METADATA_PATH.write_text(json.dumps(metadata, indent=2), encoding="utf-8")


def load_users() -> dict[str, dict[str, Any]]:
    ensure_pki_dirs()
    if not PKI_USERS_PATH.exists():
        return {}
    return json.loads(PKI_USERS_PATH.read_text(encoding="utf-8"))


def save_users(users: dict[str, dict[str, Any]]) -> None:
    ensure_pki_dirs()
    PKI_USERS_PATH.write_text(json.dumps(users, indent=2), encoding="utf-8")


def service_state(name: str) -> str:
    result = run_command(["systemctl", "is-active", name])
    return result.stdout.strip() or "inactive"


def _iptables_binary() -> str | None:
    candidates = [shutil.which("iptables"), "/usr/sbin/iptables", "/sbin/iptables"]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    return None


def _ufw_binary() -> str | None:
    candidates = [shutil.which("ufw"), "/usr/sbin/ufw", "/sbin/ufw"]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    return None


def _pihole_binary() -> str | None:
    candidates = [shutil.which("pihole"), "/usr/local/bin/pihole"]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate
    return None


def _firewall_backend() -> str:
    if _iptables_binary():
        return "iptables"
    return "unavailable"


def _default_egress_interface() -> str:
    result = run_command(["ip", "route", "show", "default"], check=True)
    for line in result.stdout.splitlines():
        parts = line.split()
        if "dev" in parts:
            index = parts.index("dev")
            if index + 1 < len(parts):
                return parts[index + 1]
    raise RuntimeError("Unable to determine the default egress interface")


def _interface_ipv4_cidr(interface: str) -> str:
    result = run_command(["ip", "-4", "-o", "addr", "show", "dev", interface, "scope", "global"], check=True)
    for line in result.stdout.splitlines():
        parts = line.split()
        if "inet" in parts:
            index = parts.index("inet")
            if index + 1 < len(parts):
                return parts[index + 1]
    raise RuntimeError(f"Unable to determine an IPv4 address for interface {interface}")


def _normalize_dns_mode(value: Any) -> str:
    normalized = str(value or "custom").strip().lower()
    if normalized not in {"custom", "pihole"}:
        raise ValueError("DNS mode must be custom or pihole")
    return normalized


def _normalize_upstream_dns(value: Any) -> list[str]:
    if isinstance(value, list):
        raw_entries = value
    else:
        raw_entries = re.split(r"[\s,;]+", str(value or ""))

    entries: list[str] = []
    seen: set[str] = set()
    for raw_entry in raw_entries:
        entry = str(raw_entry).strip()
        if not entry or entry in seen:
            continue
        seen.add(entry)
        entries.append(entry)

    return entries or ["1.1.1.1", "1.0.0.1"]


def _vpn_gateway_ip(tunnel_network: str) -> str:
    network = ipaddress.ip_network(tunnel_network, strict=False)
    try:
        return str(next(network.hosts()))
    except StopIteration as exc:
        raise RuntimeError(f"Tunnel network {tunnel_network} does not provide a usable gateway IP") from exc


def _effective_dns_server(metadata: dict[str, Any]) -> str:
    if _normalize_dns_mode(metadata.get("dnsMode", "custom")) == "pihole":
        return _vpn_gateway_ip(str(metadata["tunnelNetwork"]))
    dns_server = str(metadata.get("dnsServer", "")).strip()
    return dns_server or "1.1.1.1"


def _iptables_rule_present(args: list[str]) -> bool:
    binary = _iptables_binary()
    if not binary:
        return False
    return run_command([binary, *args], check=False).returncode == 0


def _ufw_rule_present(port: int, protocol: str) -> bool:
    binary = _ufw_binary()
    if not binary:
        return False
    result = run_command([binary, "status"], check=False)
    rule = f"{port}/{protocol.lower()}"
    return any(rule in line and "ALLOW" in line for line in result.stdout.splitlines())


def _ufw_routes_present(tunnel_cidr: str, egress_interface: str) -> bool:
    binary = _ufw_binary()
    if not binary:
        return True
    result = run_command([binary, "status"], check=False)
    lines = result.stdout.splitlines()
    outbound = any(
        "ALLOW FWD" in line
        and line.strip().startswith(f"Anywhere on {egress_interface}")
        and f"{tunnel_cidr} on tun0" in line
        for line in lines
    )
    inbound = any(
        "ALLOW FWD" in line
        and line.strip().startswith(f"{tunnel_cidr} on tun0")
        and f"Anywhere on {egress_interface}" in line
        for line in lines
    )
    return outbound and inbound


def _ufw_ui_rule_present(tunnel_cidr: str) -> bool:
    binary = _ufw_binary()
    if not binary:
        return True
    result = run_command([binary, "status"], check=False)
    return any(
        "8080/tcp" in line and tunnel_cidr in line and "ALLOW" in line
        for line in result.stdout.splitlines()
    )


def _ufw_pihole_ui_rule_present(tunnel_cidr: str) -> bool:
    binary = _ufw_binary()
    if not binary:
        return True
    result = run_command([binary, "status"], check=False)
    return any(
        "80/tcp" in line and tunnel_cidr in line and "ALLOW" in line
        for line in result.stdout.splitlines()
    )


def _ufw_dns_rules_present(tunnel_cidr: str) -> bool:
    binary = _ufw_binary()
    if not binary:
        return True
    result = run_command([binary, "status"], check=False)
    lines = result.stdout.splitlines()
    return all(
        any(f"53/{protocol}" in line and tunnel_cidr in line and "ALLOW" in line for line in lines)
        for protocol in ("tcp", "udp")
    )


def _ensure_ufw_port(port: int, protocol: str) -> None:
    binary = _ufw_binary()
    if not binary or _ufw_rule_present(port, protocol):
        return
    run_command([binary, "allow", f"{port}/{protocol.lower()}"], check=True)


def _ensure_ufw_ui_port(tunnel_cidr: str) -> None:
    binary = _ufw_binary()
    if not binary or _ufw_ui_rule_present(tunnel_cidr):
        return
    run_command([binary, "allow", "from", tunnel_cidr, "to", "any", "port", "8080", "proto", "tcp"], check=True)


def _ensure_ufw_pihole_ui_port(tunnel_cidr: str) -> None:
    binary = _ufw_binary()
    if not binary or _ufw_pihole_ui_rule_present(tunnel_cidr):
        return
    run_command([binary, "allow", "from", tunnel_cidr, "to", "any", "port", "80", "proto", "tcp"], check=True)


def _ensure_ufw_dns_ports(tunnel_cidr: str) -> None:
    binary = _ufw_binary()
    if not binary or _ufw_dns_rules_present(tunnel_cidr):
        return
    run_command([binary, "allow", "from", tunnel_cidr, "to", "any", "port", "53", "proto", "tcp"], check=True)
    run_command([binary, "allow", "from", tunnel_cidr, "to", "any", "port", "53", "proto", "udp"], check=True)


def _ensure_ufw_routes(tunnel_cidr: str, egress_interface: str) -> None:
    binary = _ufw_binary()
    if not binary or _ufw_routes_present(tunnel_cidr, egress_interface):
        return
    run_command([
        binary, "route", "allow", "in", "on", "tun0", "out", "on", egress_interface,
        "from", tunnel_cidr, "to", "any",
    ], check=True)
    run_command([
        binary, "route", "allow", "in", "on", egress_interface, "out", "on", "tun0",
        "from", "any", "to", tunnel_cidr,
    ], check=True)


def _write_openssl_config() -> None:
    config_text = f"""
[ ca ]
default_ca = CA_default

[ CA_default ]
dir = {PKI_DIR}
database = $dir/index.txt
new_certs_dir = $dir/certs
certificate = $dir/ca.crt
serial = $dir/serial
crlnumber = $dir/crlnumber
crl = $dir/crl.pem
private_key = $dir/private/ca.key
default_days = 825
default_md = sha256
policy = policy_loose
x509_extensions = usr_cert
name_opt = ca_default
cert_opt = ca_default
copy_extensions = copy
default_crl_days = 3650
unique_subject = no

[ policy_loose ]
commonName = supplied

[ req ]
default_bits = 2048
prompt = no
distinguished_name = req_distinguished_name
default_md = sha256
string_mask = utf8only

[ req_distinguished_name ]
CN = OpenVPN Control CA

[ v3_ca ]
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints = critical, CA:true
keyUsage = critical, digitalSignature, cRLSign, keyCertSign

[ server_cert ]
basicConstraints = CA:FALSE
nsCertType = server
nsComment = OpenVPN Server
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
extendedKeyUsage = serverAuth
keyUsage = critical, digitalSignature, keyEncipherment

[ usr_cert ]
basicConstraints = CA:FALSE
nsCertType = client
nsComment = OpenVPN Client
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
extendedKeyUsage = clientAuth
keyUsage = critical, digitalSignature, keyEncipherment
""".strip()
    OPENSSL_CONFIG_PATH.write_text(config_text + "\n", encoding="utf-8")


def _ensure_ca_files() -> None:
    if not INDEX_PATH.exists():
        INDEX_PATH.write_text("", encoding="utf-8")
    if not CA_SERIAL_PATH.exists():
        CA_SERIAL_PATH.write_text("1000\n", encoding="utf-8")
    if not CRL_NUMBER_PATH.exists():
        CRL_NUMBER_PATH.write_text("1000\n", encoding="utf-8")


def _openssl_subject(common_name: str) -> str:
    return f"/CN={common_name}"


def _render_server_config(metadata: dict[str, Any]) -> str:
    network = ipaddress.ip_network(metadata["tunnelNetwork"], strict=False)
    effective_dns_server = _effective_dns_server(metadata)
    return "\n".join([
        f"port {int(metadata['port'])}",
        f"proto {metadata['protocol']}",
        "dev tun",
        "topology subnet",
        "mssfix 1360",
        f"server {network.network_address} {network.netmask}",
        f"ca {CA_CERT_PATH}",
        f"cert {SERVER_CERT_PATH}",
        f"key {SERVER_KEY_PATH}",
        "dh none",
        "ecdh-curve prime256v1",
        f"crl-verify {CRL_PATH}",
        f"tls-crypt {TLS_CRYPT_KEY_PATH}",
        "keepalive 10 120",
        "persist-key",
        "persist-tun",
        f"ifconfig-pool-persist {IPP_PATH}",
        f"client-config-dir {CCD_DIR}",
        f"status {STATUS_LOG_PATH}",
        "cipher AES-256-GCM",
        "data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305",
        "verb 3",
        f'push "dhcp-option DNS {effective_dns_server}"',
        'push "redirect-gateway def1 bypass-dhcp"',
        "",
    ])


def _ensure_forwarding() -> None:
    OPENVPN_FORWARDING_SYSCTL_PATH.write_text("net.ipv4.ip_forward=1\n", encoding="utf-8")
    run_command(["sysctl", "--system"], check=True)


def _render_firewall_script(tunnel_network: str, egress_interface: str) -> str:
    iptables_binary = _iptables_binary() or "iptables"
    return "\n".join([
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        f'TUNNEL_CIDR="{tunnel_network}"',
        f'EGRESS_IFACE="{egress_interface}"',
        f'IPTABLES_BIN="{iptables_binary}"',
        "",
        '"$IPTABLES_BIN" -t nat -C POSTROUTING -s "$TUNNEL_CIDR" -o "$EGRESS_IFACE" -j MASQUERADE 2>/dev/null || \\',
        '  "$IPTABLES_BIN" -t nat -A POSTROUTING -s "$TUNNEL_CIDR" -o "$EGRESS_IFACE" -j MASQUERADE',
        '"$IPTABLES_BIN" -C FORWARD -s "$TUNNEL_CIDR" -o "$EGRESS_IFACE" -j ACCEPT 2>/dev/null || \\',
        '  "$IPTABLES_BIN" -A FORWARD -s "$TUNNEL_CIDR" -o "$EGRESS_IFACE" -j ACCEPT',
        '"$IPTABLES_BIN" -C FORWARD -d "$TUNNEL_CIDR" -i "$EGRESS_IFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \\',
        '  "$IPTABLES_BIN" -A FORWARD -d "$TUNNEL_CIDR" -i "$EGRESS_IFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT',
        "",
    ])


def _render_firewall_service() -> str:
    return "\n".join([
        "[Unit]",
        "Description=OpenVPN UI firewall bootstrap",
        "After=network-online.target",
        "Wants=network-online.target",
        f"Before={OPENVPN_SERVER_SERVICE_NAME}",
        "",
        "[Service]",
        "Type=oneshot",
        f"ExecStart={OPENVPN_FIREWALL_SCRIPT_PATH}",
        "RemainAfterExit=yes",
        "",
        "[Install]",
        "WantedBy=multi-user.target",
        "",
    ])


def _ensure_firewall(metadata: dict[str, Any]) -> tuple[str, str]:
    backend = _firewall_backend()
    if backend != "iptables":
        raise RuntimeError("iptables is required to configure VPN egress NAT on this host")

    egress_interface = _default_egress_interface()
    tunnel_cidr = str(ipaddress.ip_network(metadata["tunnelNetwork"], strict=False))

    OPENVPN_FIREWALL_SCRIPT_PATH.write_text(
        _render_firewall_script(tunnel_cidr, egress_interface),
        encoding="utf-8",
    )
    os.chmod(OPENVPN_FIREWALL_SCRIPT_PATH, 0o750)
    OPENVPN_FIREWALL_SERVICE_PATH.write_text(_render_firewall_service(), encoding="utf-8")

    run_command(["systemctl", "daemon-reload"], check=True)
    run_command(["systemctl", "enable", OPENVPN_FIREWALL_SERVICE_NAME], check=False)
    run_command(["systemctl", "restart", OPENVPN_FIREWALL_SERVICE_NAME], check=True)
    _ensure_ufw_port(int(metadata.get("port", 1194)), str(metadata.get("protocol", "udp")))
    _ensure_ufw_ui_port(tunnel_cidr)
    _ensure_ufw_pihole_ui_port(tunnel_cidr)
    _ensure_ufw_dns_ports(tunnel_cidr)
    _ensure_ufw_routes(tunnel_cidr, egress_interface)
    return backend, egress_interface


def _forwarding_enabled() -> bool:
    try:
        return Path("/proc/sys/net/ipv4/ip_forward").read_text(encoding="utf-8").strip() == "1"
    except (FileNotFoundError, OSError):
        return False


def _nat_configured(metadata: dict[str, Any]) -> bool:
    if _firewall_backend() != "iptables":
        return False
    egress_interface = str(metadata.get("egressInterface", "")).strip()
    if not egress_interface:
        return False
    tunnel_cidr = str(ipaddress.ip_network(metadata["tunnelNetwork"], strict=False))
    return (
        _iptables_rule_present(["-t", "nat", "-C", "POSTROUTING", "-s", tunnel_cidr, "-o", egress_interface, "-j", "MASQUERADE"])
        and _iptables_rule_present(["-C", "FORWARD", "-s", tunnel_cidr, "-o", egress_interface, "-j", "ACCEPT"])
        and _iptables_rule_present(["-C", "FORWARD", "-d", tunnel_cidr, "-i", egress_interface, "-m", "conntrack", "--ctstate", "RELATED,ESTABLISHED", "-j", "ACCEPT"])
    )


def _remove_firewall_rules(metadata: dict[str, Any]) -> None:
    binary = _iptables_binary()
    egress_interface = str(metadata.get("egressInterface", "")).strip()
    tunnel_cidr = str(ipaddress.ip_network(metadata["tunnelNetwork"], strict=False))
    if binary:
        if egress_interface:
            run_command([binary, "-t", "nat", "-D", "POSTROUTING", "-s", tunnel_cidr, "-o", egress_interface, "-j", "MASQUERADE"], check=False)
            run_command([binary, "-D", "FORWARD", "-s", tunnel_cidr, "-o", egress_interface, "-j", "ACCEPT"], check=False)
            run_command([binary, "-D", "FORWARD", "-d", tunnel_cidr, "-i", egress_interface, "-m", "conntrack", "--ctstate", "RELATED,ESTABLISHED", "-j", "ACCEPT"], check=False)
    ufw = _ufw_binary()
    if ufw:
        run_command([ufw, "delete", "allow", "from", str(ipaddress.ip_network(metadata["tunnelNetwork"], strict=False)), "to", "any", "port", "8080", "proto", "tcp"], check=False)
        run_command([ufw, "delete", "allow", "from", tunnel_cidr, "to", "any", "port", "80", "proto", "tcp"], check=False)
        run_command([ufw, "delete", "allow", "from", tunnel_cidr, "to", "any", "port", "53", "proto", "tcp"], check=False)
        run_command([ufw, "delete", "allow", "from", tunnel_cidr, "to", "any", "port", "53", "proto", "udp"], check=False)
        if egress_interface:
            run_command([ufw, "route", "delete", "allow", "in", "on", "tun0", "out", "on", egress_interface, "from", tunnel_cidr, "to", "any"], check=False)
            run_command([ufw, "route", "delete", "allow", "in", "on", egress_interface, "out", "on", "tun0", "from", "any", "to", tunnel_cidr], check=False)
        run_command([ufw, "delete", "allow", f"{int(metadata.get('port', 1194))}/{str(metadata.get('protocol', 'udp')).lower()}"], check=False)


def _update_crl() -> None:
    run_command(["openssl", "ca", "-gencrl", "-config", str(OPENSSL_CONFIG_PATH), "-out", str(CRL_PATH)], check=True)


def _write_server_config(metadata: dict[str, Any]) -> None:
    OPENVPN_SERVER_DIR.mkdir(parents=True, exist_ok=True)
    OPENVPN_SERVER_CONFIG_PATH.write_text(_render_server_config(metadata), encoding="utf-8")


def _render_pihole_setup_vars(interface: str, ipv4_cidr: str, upstream_dns: list[str]) -> str:
    lines = [
        f"PIHOLE_INTERFACE={interface}",
        f"IPV4_ADDRESS={ipv4_cidr}",
        "IPV6_ADDRESS=",
        "QUERY_LOGGING=true",
        "INSTALL_WEB=true",
        "INSTALL_WEB_INTERFACE=true",
        "INSTALL_WEB_SERVER=true",
        "LIGHTTPD_ENABLED=true",
        "DNSMASQ_LISTENING=all",
        "DNS_FQDN_REQUIRED=true",
        "DNS_BOGUS_PRIV=true",
        "DNSSEC=false",
        "REV_SERVER=false",
        "BLOCKING_ENABLED=true",
    ]
    for index, server in enumerate(upstream_dns, start=1):
        lines.append(f"PIHOLE_DNS_{index}={server}")
    return "\n".join(lines + [""])


def _pihole_installed() -> bool:
    return _pihole_binary() is not None


def _pihole_service_state() -> str:
    if not _pihole_installed():
        return "not-installed"
    return service_state(PIHOLE_FTL_SERVICE_NAME)


def _format_bytes(value: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(max(0, value))
    for unit in units:
        if size < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024
    return "0 B"


def _format_duration(seconds: int) -> str:
    seconds = max(0, int(seconds))
    days, remainder = divmod(seconds, 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes, secs = divmod(remainder, 60)
    if days:
        return f"{days}d {hours:02d}h"
    if hours:
        return f"{hours}h {minutes:02d}m"
    return f"{minutes}m {secs:02d}s"


def _status_log_candidates(server_name: str) -> list[Path]:
    runtime_path = Path(f"/run/openvpn-server/status-{server_name}.log")
    candidates = [runtime_path, OPENVPN_SERVER_RUNTIME_STATUS_PATH, STATUS_LOG_PATH]
    unique: list[Path] = []
    seen: set[Path] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        unique.append(candidate)
    return unique


def _latest_status_log_path(server_name: str) -> Path | None:
    existing = [path for path in _status_log_candidates(server_name) if path.exists() and path.is_file()]
    if not existing:
        return None
    return max(existing, key=lambda path: path.stat().st_mtime)


def _parse_openvpn_status(server_name: str) -> dict[str, Any]:
    path = _latest_status_log_path(server_name)
    if not path:
        return {
            "available": False,
            "sourcePath": "",
            "updatedAt": None,
            "updatedAtEpoch": None,
            "connectedClients": 0,
            "routedClients": 0,
            "totalBytesReceived": 0,
            "totalBytesSent": 0,
            "totalBytesReceivedDisplay": "0 B",
            "totalBytesSentDisplay": "0 B",
            "maxBroadcastQueue": "unknown",
            "dcoEnabled": "unknown",
            "clients": [],
        }

    client_rows: list[dict[str, Any]] = []
    routing_rows: dict[str, dict[str, Any]] = {}
    global_stats: dict[str, str] = {}
    updated_at: str | None = None
    updated_epoch: int | None = None
    now_epoch = int(datetime.now(timezone.utc).timestamp())

    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if not raw_line.strip():
            continue
        row = next(csv.reader([raw_line]))
        record_type = row[0]
        if record_type == "TIME" and len(row) >= 3:
            updated_at = row[1].strip() or None
            try:
                updated_epoch = int(row[2])
            except ValueError:
                updated_epoch = None
        elif record_type == "CLIENT_LIST" and len(row) >= 13:
            try:
                bytes_received = int(row[5])
            except ValueError:
                bytes_received = 0
            try:
                bytes_sent = int(row[6])
            except ValueError:
                bytes_sent = 0
            try:
                connected_since_epoch = int(row[8])
            except ValueError:
                connected_since_epoch = 0

            client_rows.append({
                "id": slugify(row[1]),
                "name": row[1],
                "realAddress": row[2],
                "virtualAddress": row[3],
                "virtualIpv6Address": row[4],
                "bytesReceived": bytes_received,
                "bytesSent": bytes_sent,
                "bytesReceivedDisplay": _format_bytes(bytes_received),
                "bytesSentDisplay": _format_bytes(bytes_sent),
                "connectedSince": row[7],
                "connectedSinceEpoch": connected_since_epoch,
                "connectedForDisplay": _format_duration(now_epoch - connected_since_epoch) if connected_since_epoch else "0m 00s",
                "username": row[9],
                "clientId": row[10],
                "peerId": row[11],
                "dataChannelCipher": row[12],
            })
        elif record_type == "ROUTING_TABLE" and len(row) >= 6:
            try:
                last_ref_epoch = int(row[5])
            except ValueError:
                last_ref_epoch = 0
            routing_rows[row[1]] = {
                "commonName": row[2],
                "realAddress": row[3],
                "lastRef": row[4],
                "lastRefEpoch": last_ref_epoch,
            }
        elif record_type == "GLOBAL_STATS" and len(row) >= 3:
            global_stats[row[1]] = row[2]

    for client in client_rows:
        route = routing_rows.get(client["virtualAddress"])
        if not route:
            client["lastRef"] = "Unavailable"
            client["lastRefEpoch"] = 0
            continue
        client["lastRef"] = route["lastRef"]
        client["lastRefEpoch"] = route["lastRefEpoch"]

    total_received = sum(client["bytesReceived"] for client in client_rows)
    total_sent = sum(client["bytesSent"] for client in client_rows)
    return {
        "available": True,
        "sourcePath": str(path),
        "updatedAt": updated_at,
        "updatedAtEpoch": updated_epoch,
        "connectedClients": len(client_rows),
        "routedClients": len(routing_rows),
        "totalBytesReceived": total_received,
        "totalBytesSent": total_sent,
        "totalBytesReceivedDisplay": _format_bytes(total_received),
        "totalBytesSentDisplay": _format_bytes(total_sent),
        "maxBroadcastQueue": global_stats.get("Max bcast/mcast queue length", "unknown"),
        "dcoEnabled": global_stats.get("dco_enabled", "unknown"),
        "clients": client_rows,
    }


def _merge_user_runtime(users: list[dict[str, Any]], runtime: dict[str, Any]) -> list[dict[str, Any]]:
    runtime_by_id = {entry["id"]: entry for entry in runtime["clients"]}
    merged_rows: list[dict[str, Any]] = []
    for user in users:
        runtime_entry = runtime_by_id.get(user["id"])
        merged_rows.append({
            **user,
            "online": runtime_entry is not None,
            "virtualAddress": runtime_entry["virtualAddress"] if runtime_entry else "",
            "realAddress": runtime_entry["realAddress"] if runtime_entry else "",
            "connectedSince": runtime_entry["connectedSince"] if runtime_entry else None,
            "connectedForDisplay": runtime_entry["connectedForDisplay"] if runtime_entry else None,
            "lastRef": runtime_entry["lastRef"] if runtime_entry else None,
            "bytesReceived": runtime_entry["bytesReceived"] if runtime_entry else 0,
            "bytesSent": runtime_entry["bytesSent"] if runtime_entry else 0,
            "bytesReceivedDisplay": runtime_entry["bytesReceivedDisplay"] if runtime_entry else "0 B",
            "bytesSentDisplay": runtime_entry["bytesSentDisplay"] if runtime_entry else "0 B",
            "dataChannelCipher": runtime_entry["dataChannelCipher"] if runtime_entry else None,
        })
    return merged_rows


def _load_cert_dates(cert_path: Path) -> tuple[str, int]:
    result = run_command(["openssl", "x509", "-in", str(cert_path), "-noout", "-enddate"], check=True)
    end_date = result.stdout.strip().split("=", 1)[1]
    expires = datetime.strptime(end_date, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    days_remaining = max(0, (expires - datetime.now(timezone.utc)).days)
    return end_date, days_remaining


def get_pki_dashboard() -> dict[str, Any]:
    metadata = load_pki_metadata()
    users = load_users()
    user_rows = list(users.values())
    user_rows.sort(key=lambda entry: entry["name"].lower())
    runtime = _parse_openvpn_status(str(metadata.get("serverName", OPENVPN_SERVER_NAME)))
    user_rows = _merge_user_runtime(user_rows, runtime)
    firewall_backend = metadata.get("firewallBackend") or _firewall_backend()
    tunnel_cidr = str(ipaddress.ip_network(metadata["tunnelNetwork"], strict=False))
    return {
        "initialized": bool(metadata.get("initialized")) and CA_CERT_PATH.exists() and SERVER_CERT_PATH.exists(),
        "serverConfigured": OPENVPN_SERVER_CONFIG_PATH.exists(),
        "serverServiceName": OPENVPN_SERVER_SERVICE_NAME,
        "serverServiceState": service_state(OPENVPN_SERVER_SERVICE_NAME),
        "firewallServiceName": OPENVPN_FIREWALL_SERVICE_NAME,
        "firewallServiceState": service_state(OPENVPN_FIREWALL_SERVICE_NAME),
        "serverName": metadata["serverName"],
        "publicHost": metadata["publicHost"],
        "protocol": metadata["protocol"],
        "port": metadata["port"],
        "tunnelNetwork": metadata["tunnelNetwork"],
        "dnsMode": _normalize_dns_mode(metadata.get("dnsMode", "custom")),
        "dnsServer": metadata["dnsServer"],
        "effectiveDnsServer": _effective_dns_server(metadata),
        "vpnGatewayDns": _vpn_gateway_ip(str(metadata["tunnelNetwork"])),
        "piHoleInstalled": _pihole_installed(),
        "piHoleServiceState": _pihole_service_state(),
        "piHoleUpstreamDns": metadata.get("piHoleUpstreamDns", ["1.1.1.1", "1.0.0.1"]),
        "egressInterface": metadata.get("egressInterface", ""),
        "firewallBackend": firewall_backend,
        "vpnPortAllowed": (
            _ufw_rule_present(int(metadata["port"]), str(metadata["protocol"]))
            if _ufw_binary()
            else None
        ),
        "uiPortAllowed": _ufw_ui_rule_present(tunnel_cidr),
        "piHoleUiAllowed": _ufw_pihole_ui_rule_present(tunnel_cidr),
        "vpnDnsAllowed": _ufw_dns_rules_present(tunnel_cidr),
        "vpnRoutingAllowed": _ufw_routes_present(tunnel_cidr, str(metadata.get("egressInterface", ""))) if metadata.get("egressInterface") else False,
        "forwardingEnabled": _forwarding_enabled(),
        "natConfigured": _nat_configured(metadata),
        "createdAt": metadata["createdAt"],
        "updatedAt": metadata["updatedAt"],
        "certificateAuthority": CA_CERT_PATH.exists(),
        "userCount": len(user_rows),
        "revokedCount": sum(1 for entry in user_rows if entry["status"] == "revoked"),
        "activeUserCount": runtime["connectedClients"],
        "runtime": runtime,
        "telemetry": collect_system_telemetry(str(metadata.get("egressInterface", "")), OPENVPN_SERVER_SERVICE_NAME),
        "users": user_rows,
    }


def detect_public_ipv4() -> str | None:
    """Return the server's observed public IPv4 for use as a form suggestion."""
    request = urllib.request.Request(
        "https://api.ipify.org",
        headers={"User-Agent": "openvpn-ui/0.1"},
    )
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            value = response.read(64).decode("ascii", errors="strict").strip()
        address = ipaddress.ip_address(value)
    except (OSError, UnicodeError, ValueError, urllib.error.URLError):
        return None
    return str(address) if address.version == 4 and address.is_global else None


def initialize_pki(payload: dict[str, Any]) -> dict[str, Any]:
    ensure_pki_dirs()
    current = load_pki_metadata()
    if current.get("initialized") and CA_CERT_PATH.exists() and SERVER_CERT_PATH.exists():
        raise ValueError("PKI is already initialized")

    public_host = str(payload.get("publicHost", "")).strip()
    if not public_host:
        raise ValueError("Public host is required")

    protocol = str(payload.get("protocol", "udp")).strip().lower()
    if protocol not in {"udp", "tcp"}:
        raise ValueError("Protocol must be udp or tcp")

    port = int(payload.get("port", 1194))
    tunnel_network = str(payload.get("tunnelNetwork", "10.8.0.0/24")).strip()
    ipaddress.ip_network(tunnel_network, strict=False)
    dns_mode = _normalize_dns_mode(payload.get("dnsMode", "custom"))
    dns_server = str(payload.get("dnsServer", "1.1.1.1")).strip() or "1.1.1.1"
    upstream_dns = _normalize_upstream_dns(payload.get("piHoleUpstreamDns", current.get("piHoleUpstreamDns", [])))
    if dns_mode == "pihole" and not _pihole_installed():
        raise ValueError("Pi-hole is not installed on the server")

    _write_openssl_config()
    _ensure_ca_files()

    if not CA_KEY_PATH.exists():
        run_command(["openssl", "genrsa", "-out", str(CA_KEY_PATH), "4096"], check=True)
    if not CA_CERT_PATH.exists():
        run_command([
            "openssl", "req", "-x509", "-new", "-key", str(CA_KEY_PATH), "-sha256", "-days", "3650",
            "-out", str(CA_CERT_PATH), "-subj", _openssl_subject("OpenVPN Control CA"),
            "-config", str(OPENSSL_CONFIG_PATH), "-extensions", "v3_ca",
        ], check=True)

    run_command(["openssl", "genrsa", "-out", str(SERVER_KEY_PATH), "2048"], check=True)
    run_command([
        "openssl", "req", "-new", "-key", str(SERVER_KEY_PATH), "-out", str(SERVER_CSR_PATH),
        "-subj", _openssl_subject(OPENVPN_SERVER_NAME),
    ], check=True)
    run_command([
        "openssl", "ca", "-batch", "-config", str(OPENSSL_CONFIG_PATH), "-extensions", "server_cert",
        "-in", str(SERVER_CSR_PATH), "-out", str(SERVER_CERT_PATH),
    ], check=True)
    if not TLS_CRYPT_KEY_PATH.exists():
        run_command(["openvpn", "--genkey", "secret", str(TLS_CRYPT_KEY_PATH)], check=True)
    _update_crl()

    _write_server_config({
        "protocol": protocol,
        "port": port,
        "tunnelNetwork": tunnel_network,
        "dnsMode": dns_mode,
        "dnsServer": dns_server,
    })

    _ensure_forwarding()
    firewall_backend, egress_interface = _ensure_firewall({
        "tunnelNetwork": tunnel_network,
        "port": port,
        "protocol": protocol,
    })
    run_command(["systemctl", "daemon-reload"], check=True)
    run_command(["systemctl", "enable", OPENVPN_SERVER_SERVICE_NAME], check=False)
    run_command(["systemctl", "restart", OPENVPN_SERVER_SERVICE_NAME], check=True)

    metadata = dict(DEFAULT_PKI_METADATA)
    metadata.update({
        "initialized": True,
        "serverName": OPENVPN_SERVER_NAME,
        "publicHost": public_host,
        "protocol": protocol,
        "port": port,
        "tunnelNetwork": tunnel_network,
        "dnsMode": dns_mode,
        "dnsServer": dns_server,
        "piHoleUpstreamDns": upstream_dns,
        "egressInterface": egress_interface,
        "firewallBackend": firewall_backend,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    })
    save_pki_metadata(metadata)
    return get_pki_dashboard()


def control_server(action: str) -> dict[str, Any]:
    if action not in {"start", "stop", "restart"}:
        raise ValueError("Unsupported server action")

    metadata = load_pki_metadata()
    if not metadata.get("initialized"):
        raise ValueError("PKI is not initialized")

    if action in {"start", "restart"}:
        _ensure_forwarding()
        firewall_backend, egress_interface = _ensure_firewall(metadata)
        metadata["firewallBackend"] = firewall_backend
        metadata["egressInterface"] = egress_interface

    run_command(["systemctl", action, OPENVPN_SERVER_SERVICE_NAME], check=action != "stop")
    metadata["updatedAt"] = datetime.now(timezone.utc).isoformat()
    save_pki_metadata(metadata)
    return get_pki_dashboard()


def configure_vpn_dns(payload: dict[str, Any]) -> dict[str, Any]:
    metadata = load_pki_metadata()
    if not metadata.get("initialized"):
        raise ValueError("PKI is not initialized")

    dns_mode = _normalize_dns_mode(payload.get("dnsMode", metadata.get("dnsMode", "custom")))
    dns_server = str(payload.get("dnsServer", metadata.get("dnsServer", "1.1.1.1"))).strip() or "1.1.1.1"
    upstream_dns = _normalize_upstream_dns(payload.get("piHoleUpstreamDns", metadata.get("piHoleUpstreamDns", [])))

    if dns_mode == "pihole" and not _pihole_installed():
        raise ValueError("Pi-hole is not installed on the server")

    metadata["dnsMode"] = dns_mode
    metadata["dnsServer"] = dns_server
    metadata["piHoleUpstreamDns"] = upstream_dns
    metadata["updatedAt"] = datetime.now(timezone.utc).isoformat()
    save_pki_metadata(metadata)

    _write_server_config(metadata)
    run_command(["systemctl", "restart", OPENVPN_SERVER_SERVICE_NAME], check=True)
    return get_pki_dashboard()


def install_pihole(payload: dict[str, Any]) -> dict[str, Any]:
    metadata = load_pki_metadata()
    if not metadata.get("initialized"):
        raise ValueError("PKI must be initialized before Pi-hole can be attached to the VPN")

    egress_interface = str(metadata.get("egressInterface", "")).strip() or _default_egress_interface()
    ipv4_cidr = _interface_ipv4_cidr(egress_interface)
    upstream_dns = _normalize_upstream_dns(payload.get("piHoleUpstreamDns", metadata.get("piHoleUpstreamDns", [])))

    PIHOLE_SETUPVARS_PATH.parent.mkdir(parents=True, exist_ok=True)
    PIHOLE_SETUPVARS_PATH.write_text(
        _render_pihole_setup_vars(egress_interface, ipv4_cidr, upstream_dns),
        encoding="utf-8",
    )

    run_command(["apt-get", "update"], check=True)
    run_command(["apt-get", "install", "-y", "curl", "git", "dialog"], check=True)
    run_command(["curl", "-sSL", "https://install.pi-hole.net", "-o", str(PIHOLE_INSTALLER_PATH)], check=True)
    os.chmod(PIHOLE_INSTALLER_PATH, 0o750)
    run_command(["bash", str(PIHOLE_INSTALLER_PATH), "--unattended"], check=True)
    run_command(["systemctl", "enable", PIHOLE_FTL_SERVICE_NAME], check=False)
    run_command(["systemctl", "restart", PIHOLE_FTL_SERVICE_NAME], check=True)

    metadata["egressInterface"] = egress_interface
    metadata["dnsMode"] = "pihole"
    metadata["piHoleUpstreamDns"] = upstream_dns
    metadata["updatedAt"] = datetime.now(timezone.utc).isoformat()
    save_pki_metadata(metadata)

    _ensure_firewall(metadata)
    _write_server_config(metadata)
    run_command(["systemctl", "restart", OPENVPN_SERVER_SERVICE_NAME], check=True)
    return get_pki_dashboard()


def _client_paths(user_id: str) -> dict[str, Path]:
    user_dir = CLIENTS_DIR / user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(user_dir, 0o700)
    return {
        "dir": user_dir,
        "key": user_dir / "client.key",
        "csr": user_dir / "client.csr",
        "crt": user_dir / "client.crt",
        "ovpn": user_dir / "client.ovpn",
    }


def _render_client_bundle(metadata: dict[str, Any], user_name: str, paths: dict[str, Path]) -> str:
    return "\n".join([
        "client",
        "dev tun",
        f"proto {metadata['protocol']}",
        "mssfix 1360",
        f"remote {metadata['publicHost']} {int(metadata['port'])}",
        "resolv-retry infinite",
        "nobind",
        "persist-key",
        "persist-tun",
        "remote-cert-tls server",
        "verb 3",
        "",
        "<ca>",
        CA_CERT_PATH.read_text(encoding="utf-8").strip(),
        "</ca>",
        "<cert>",
        paths["crt"].read_text(encoding="utf-8").strip(),
        "</cert>",
        "<key>",
        paths["key"].read_text(encoding="utf-8").strip(),
        "</key>",
        "<tls-crypt>",
        TLS_CRYPT_KEY_PATH.read_text(encoding="utf-8").strip(),
        "</tls-crypt>",
        "",
        f"# User: {user_name}",
        "",
    ])


def create_vpn_user(payload: dict[str, Any]) -> dict[str, Any]:
    metadata = load_pki_metadata()
    if not metadata.get("initialized"):
        raise ValueError("PKI is not initialized")
    if not metadata.get("publicHost"):
        raise ValueError("PKI metadata does not contain a public host")

    name = str(payload.get("name", "")).strip()
    if not name:
        raise ValueError("User name is required")

    users = load_users()
    user_id = slugify(name)
    if user_id in users:
        raise ValueError("User already exists")

    paths = _client_paths(user_id)
    run_command(["openssl", "genrsa", "-out", str(paths["key"]), "2048"], check=True)
    run_command([
        "openssl", "req", "-new", "-key", str(paths["key"]), "-out", str(paths["csr"]),
        "-subj", _openssl_subject(name),
    ], check=True)
    run_command([
        "openssl", "ca", "-batch", "-config", str(OPENSSL_CONFIG_PATH), "-extensions", "usr_cert",
        "-in", str(paths["csr"]), "-out", str(paths["crt"]),
    ], check=True)
    paths["ovpn"].write_text(_render_client_bundle(metadata, name, paths), encoding="utf-8")
    os.chmod(paths["key"], 0o600)
    os.chmod(paths["ovpn"], 0o600)

    valid_to, days_remaining = _load_cert_dates(paths["crt"])
    users[user_id] = {
        "id": user_id,
        "name": name,
        "status": "active",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "validTo": valid_to,
        "daysRemaining": days_remaining,
        "downloadName": f"{user_id}.ovpn",
    }
    save_users(users)
    metadata["updatedAt"] = datetime.now(timezone.utc).isoformat()
    save_pki_metadata(metadata)
    return users[user_id]


def revoke_vpn_user(user_id: str) -> dict[str, Any]:
    users = load_users()
    user = users.get(user_id)
    if not user:
        raise FileNotFoundError(user_id)
    if user["status"] == "revoked":
        return user

    paths = _client_paths(user_id)
    run_command(["openssl", "ca", "-config", str(OPENSSL_CONFIG_PATH), "-revoke", str(paths["crt"])], check=True)
    _update_crl()
    user["status"] = "revoked"
    user["revokedAt"] = datetime.now(timezone.utc).isoformat()
    users[user_id] = user
    save_users(users)
    metadata = load_pki_metadata()
    metadata["updatedAt"] = datetime.now(timezone.utc).isoformat()
    save_pki_metadata(metadata)
    return user


def delete_vpn_user(user_id: str) -> None:
    users = load_users()
    user = users.get(user_id)
    if not user:
        raise FileNotFoundError(user_id)
    if user["status"] != "revoked":
        revoke_vpn_user(user_id)
        users = load_users()

    paths = _client_paths(user_id)
    for path in paths.values():
        if path.is_file():
            path.unlink(missing_ok=True)
    if paths["dir"].exists():
        paths["dir"].rmdir()
    del users[user_id]
    save_users(users)
    metadata = load_pki_metadata()
    metadata["updatedAt"] = datetime.now(timezone.utc).isoformat()
    save_pki_metadata(metadata)


def read_user_bundle(user_id: str) -> tuple[str, str]:
    users = load_users()
    user = users.get(user_id)
    if not user:
        raise FileNotFoundError(user_id)
    bundle_path = _client_paths(user_id)["ovpn"]
    if not bundle_path.exists():
        raise FileNotFoundError(user_id)
    os.chmod(bundle_path, 0o600)
    return user["downloadName"], bundle_path.read_text(encoding="utf-8")


def reset_managed_openvpn() -> dict[str, Any]:
    metadata = load_pki_metadata()

    run_command(["systemctl", "stop", OPENVPN_SERVER_SERVICE_NAME], check=False)
    run_command(["systemctl", "disable", OPENVPN_SERVER_SERVICE_NAME], check=False)
    run_command(["systemctl", "stop", OPENVPN_FIREWALL_SERVICE_NAME], check=False)
    run_command(["systemctl", "disable", OPENVPN_FIREWALL_SERVICE_NAME], check=False)
    run_command(["systemctl", "stop", SERVICE_NAME], check=False)
    run_command(["systemctl", "disable", SERVICE_NAME], check=False)

    _remove_firewall_rules(metadata)

    if OPENVPN_SERVER_CONFIG_PATH.exists():
        OPENVPN_SERVER_CONFIG_PATH.unlink(missing_ok=True)
    if OPENVPN_FORWARDING_SYSCTL_PATH.exists():
        OPENVPN_FORWARDING_SYSCTL_PATH.unlink(missing_ok=True)
    if OPENVPN_FIREWALL_SERVICE_PATH.exists():
        OPENVPN_FIREWALL_SERVICE_PATH.unlink(missing_ok=True)
    if OPENVPN_FIREWALL_SCRIPT_PATH.exists():
        OPENVPN_FIREWALL_SCRIPT_PATH.unlink(missing_ok=True)
    if MANAGED_PROFILE_PATH.exists():
        MANAGED_PROFILE_PATH.unlink(missing_ok=True)
    if SYSTEMD_OVERRIDE_DIR.exists():
        shutil.rmtree(SYSTEMD_OVERRIDE_DIR, ignore_errors=True)
    if PKI_DIR.exists():
        shutil.rmtree(PKI_DIR, ignore_errors=True)

    clear_profiles_and_state()
    run_command(["systemctl", "daemon-reload"], check=True)
    run_command(["sysctl", "--system"], check=False)
    if OPENVPN_CLIENT_DIR.exists():
        OPENVPN_CLIENT_DIR.mkdir(parents=True, exist_ok=True)
    if OPENVPN_SERVER_DIR.exists():
        OPENVPN_SERVER_DIR.mkdir(parents=True, exist_ok=True)
    return get_pki_dashboard()
