from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from .pki import get_pki_dashboard
from .runtime import run_command


def _check(check_id: str, title: str, status: str, detail: str, evidence: str = "") -> dict[str, str]:
    return {
        "id": check_id,
        "title": title,
        "status": status,
        "detail": detail,
        "evidence": evidence.strip()[:600],
    }


def _command_evidence(stdout: str, stderr: str) -> str:
    return (stdout.strip() or stderr.strip() or "No command output")[:600]


def run_network_diagnostics() -> dict[str, Any]:
    started = time.monotonic()
    pki = get_pki_dashboard()
    checks: list[dict[str, str]] = []

    server_active = pki["serverServiceState"] == "active"
    checks.append(_check(
        "openvpn-server",
        "OpenVPN server",
        "pass" if server_active else "fail",
        "The managed OpenVPN server is accepting sessions." if server_active else "The managed OpenVPN server service is not active.",
        f"{pki['serverServiceName']}: {pki['serverServiceState']}",
    ))

    forwarding_ready = bool(pki["forwardingEnabled"] and pki["natConfigured"])
    checks.append(_check(
        "forwarding-nat",
        "Forwarding and NAT",
        "pass" if forwarding_ready else "fail",
        "VPN packets can leave the host and return through the tunnel." if forwarding_ready else "IPv4 forwarding or managed NAT rules are missing.",
        f"forwarding={pki['forwardingEnabled']} nat={pki['natConfigured']}",
    ))

    route = run_command(["ip", "-4", "route", "show", "default"], check=False, timeout=4)
    checks.append(_check(
        "default-route",
        "Server default route",
        "pass" if route.returncode == 0 and route.stdout.strip() else "fail",
        "The server has an IPv4 egress route." if route.returncode == 0 and route.stdout.strip() else "No usable IPv4 default route was detected.",
        _command_evidence(route.stdout, route.stderr),
    ))

    dns = run_command(["getent", "ahostsv4", "example.com"], check=False, timeout=6)
    dns_ready = dns.returncode == 0 and bool(dns.stdout.strip())
    checks.append(_check(
        "dns-resolution",
        "DNS resolution",
        "pass" if dns_ready else "fail",
        "The server resolver can resolve public names." if dns_ready else "Public DNS resolution failed from the VPN host.",
        _command_evidence(dns.stdout, dns.stderr),
    ))

    if pki["dnsMode"] == "pihole":
        pihole_ready = pki["piHoleInstalled"] and pki["piHoleServiceState"] == "active"
        checks.append(_check(
            "pihole",
            "Pi-hole DNS service",
            "pass" if pihole_ready else "fail",
            "Pi-hole is installed and serving VPN DNS." if pihole_ready else "Pi-hole is selected for VPN DNS but its service is unavailable.",
            f"installed={pki['piHoleInstalled']} service={pki['piHoleServiceState']} dns={pki['effectiveDnsServer']}",
        ))
    else:
        checks.append(_check(
            "pihole",
            "VPN DNS mode",
            "pass" if pki["effectiveDnsServer"] else "fail",
            f"VPN clients are configured to use {pki['effectiveDnsServer']}." if pki["effectiveDnsServer"] else "No effective VPN DNS server is configured.",
            f"mode={pki['dnsMode']}",
        ))

    https = run_command([
        "curl", "--silent", "--show-error", "--location", "--output", "/dev/null",
        "--connect-timeout", "4", "--max-time", "8",
        "--write-out", "%{http_code} remote=%{remote_ip} tls_verify=%{ssl_verify_result}",
        "https://example.com/",
    ], check=False, timeout=10)
    https_ready = https.returncode == 0 and not https.stdout.startswith("000")
    checks.append(_check(
        "https-tls",
        "HTTPS/TLS egress",
        "pass" if https_ready else "fail",
        "A complete HTTPS request and certificate verification succeeded." if https_ready else "The server could not complete a verified HTTPS connection.",
        _command_evidence(https.stdout, https.stderr),
    ))

    mtu_success: list[int] = []
    mtu_evidence: list[str] = []
    for payload_size in (1200, 1280, 1360, 1400):
        probe = run_command(["ping", "-4", "-c", "1", "-W", "2", "-M", "do", "-s", str(payload_size), "1.1.1.1"], check=False, timeout=4)
        mtu_evidence.append(f"{payload_size}:{probe.returncode}")
        if probe.returncode == 0:
            mtu_success.append(payload_size)
    if mtu_success:
        largest_payload = max(mtu_success)
        mtu_status = "pass" if largest_payload >= 1360 else "warn"
        mtu_detail = f"Largest successful DF payload was {largest_payload} bytes."
    else:
        mtu_status = "warn"
        mtu_detail = "No DF ping answered; ICMP filtering may hide path-MTU problems. HTTPS is the stronger result."
    checks.append(_check("path-mtu", "Path MTU probe", mtu_status, mtu_detail, " ".join(mtu_evidence)))

    runtime = pki["runtime"]
    runtime_ready = bool(runtime["available"])
    route_coverage = runtime["connectedClients"] == 0 or runtime["routedClients"] >= runtime["connectedClients"]
    checks.append(_check(
        "runtime-feed",
        "OpenVPN runtime feed",
        "pass" if runtime_ready and route_coverage else "warn",
        "Runtime status and client routes are consistent." if runtime_ready and route_coverage else "Runtime status is missing or at least one connected client has no routed address.",
        f"available={runtime_ready} connected={runtime['connectedClients']} routed={runtime['routedClients']}",
    ))

    summary = {
        "pass": sum(1 for entry in checks if entry["status"] == "pass"),
        "warn": sum(1 for entry in checks if entry["status"] == "warn"),
        "fail": sum(1 for entry in checks if entry["status"] == "fail"),
    }
    overall = "fail" if summary["fail"] else "warn" if summary["warn"] else "pass"
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "durationMs": round((time.monotonic() - started) * 1000),
        "overall": overall,
        "summary": summary,
        "checks": checks,
    }
