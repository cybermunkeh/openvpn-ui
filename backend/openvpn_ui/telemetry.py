from __future__ import annotations

import os
import shutil
import time
from pathlib import Path
from typing import Any

from .runtime import run_command


PROC_ROOT = Path("/proc")
SYS_CLASS_NET = Path("/sys/class/net")
INTERFACE_COUNTERS = (
    "rx_bytes",
    "tx_bytes",
    "rx_packets",
    "tx_packets",
    "rx_errors",
    "tx_errors",
    "rx_dropped",
    "tx_dropped",
)


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore").strip()
    except OSError:
        return ""


def _read_nonnegative_int(path: Path) -> int:
    try:
        return max(0, int(_read_text(path)))
    except ValueError:
        return 0


def parse_cpu_snapshot(content: str) -> dict[str, int]:
    fields = content.splitlines()[0].split() if content.splitlines() else []
    if not fields or fields[0] != "cpu":
        return {"totalTicks": 0, "idleTicks": 0}

    try:
        values = [max(0, int(value)) for value in fields[1:]]
    except ValueError:
        return {"totalTicks": 0, "idleTicks": 0}

    idle = values[3] if len(values) > 3 else 0
    iowait = values[4] if len(values) > 4 else 0
    return {"totalTicks": sum(values), "idleTicks": idle + iowait}


def parse_memory_info(content: str) -> dict[str, int]:
    values: dict[str, int] = {}
    for raw_line in content.splitlines():
        key, separator, remainder = raw_line.partition(":")
        if not separator:
            continue
        first_value = remainder.strip().split(maxsplit=1)
        if not first_value:
            continue
        try:
            values[key] = max(0, int(first_value[0])) * 1024
        except ValueError:
            continue

    total = values.get("MemTotal", 0)
    available = values.get("MemAvailable", values.get("MemFree", 0))
    used = max(0, total - available)
    return {
        "totalBytes": total,
        "availableBytes": available,
        "usedBytes": used,
        "usedPercent": round((used / total) * 100, 2) if total else 0,
    }


def parse_systemd_properties(content: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for raw_line in content.splitlines():
        key, separator, value = raw_line.partition("=")
        if separator:
            result[key] = value.strip()
    return result


def _systemd_nonnegative(properties: dict[str, str], key: str) -> int:
    try:
        return max(0, int(properties.get(key, "0")))
    except ValueError:
        return 0


def read_network_interface(name: str) -> dict[str, Any]:
    safe_name = str(name or "").strip()
    path = SYS_CLASS_NET / safe_name
    if not safe_name or not path.is_dir():
        return {
            "available": False,
            "name": safe_name,
            "state": "unavailable",
            "speedMbps": None,
            "rxBytes": 0,
            "txBytes": 0,
            "rxPackets": 0,
            "txPackets": 0,
            "rxErrors": 0,
            "txErrors": 0,
            "rxDropped": 0,
            "txDropped": 0,
        }

    speed = _read_nonnegative_int(path / "speed")
    return {
        "available": True,
        "name": safe_name,
        "state": _read_text(path / "operstate") or "unknown",
        "speedMbps": speed or None,
        "rxBytes": _read_nonnegative_int(path / "statistics" / "rx_bytes"),
        "txBytes": _read_nonnegative_int(path / "statistics" / "tx_bytes"),
        "rxPackets": _read_nonnegative_int(path / "statistics" / "rx_packets"),
        "txPackets": _read_nonnegative_int(path / "statistics" / "tx_packets"),
        "rxErrors": _read_nonnegative_int(path / "statistics" / "rx_errors"),
        "txErrors": _read_nonnegative_int(path / "statistics" / "tx_errors"),
        "rxDropped": _read_nonnegative_int(path / "statistics" / "rx_dropped"),
        "txDropped": _read_nonnegative_int(path / "statistics" / "tx_dropped"),
    }


def read_openvpn_process(service_name: str, host_uptime_seconds: int) -> dict[str, Any]:
    result = run_command(
        [
            "systemctl",
            "show",
            service_name,
            "--property=MainPID,MemoryCurrent,CPUUsageNSec,TasksCurrent,ActiveEnterTimestampMonotonic",
            "--no-pager",
        ],
        check=False,
        timeout=3,
    )
    properties = parse_systemd_properties(result.stdout)
    pid = _systemd_nonnegative(properties, "MainPID")
    active_since_monotonic = _systemd_nonnegative(properties, "ActiveEnterTimestampMonotonic")
    active_seconds = active_since_monotonic // 1_000_000
    return {
        "available": result.returncode == 0 and pid > 0,
        "pid": pid,
        "memoryBytes": _systemd_nonnegative(properties, "MemoryCurrent"),
        "cpuUsageNanoseconds": _systemd_nonnegative(properties, "CPUUsageNSec"),
        "tasks": _systemd_nonnegative(properties, "TasksCurrent"),
        "serviceUptimeSeconds": max(0, host_uptime_seconds - active_seconds) if active_seconds else 0,
    }


def collect_system_telemetry(egress_interface: str, openvpn_service_name: str) -> dict[str, Any]:
    cpu = parse_cpu_snapshot(_read_text(PROC_ROOT / "stat"))
    memory = parse_memory_info(_read_text(PROC_ROOT / "meminfo"))
    load_values = _read_text(PROC_ROOT / "loadavg").split()
    try:
        load = [float(value) for value in load_values[:3]]
    except ValueError:
        load = []
    while len(load) < 3:
        load.append(0.0)

    try:
        host_uptime_seconds = max(0, int(float(_read_text(PROC_ROOT / "uptime").split()[0])))
    except (IndexError, ValueError):
        host_uptime_seconds = 0

    try:
        disk = shutil.disk_usage("/")
        disk_metrics = {
            "totalBytes": disk.total,
            "usedBytes": disk.used,
            "freeBytes": disk.free,
            "usedPercent": round((disk.used / disk.total) * 100, 2) if disk.total else 0,
        }
    except OSError:
        disk_metrics = {"totalBytes": 0, "usedBytes": 0, "freeBytes": 0, "usedPercent": 0}

    return {
        "available": True,
        "observedAtEpoch": int(time.time()),
        "host": {
            "cpu": {**cpu, "cores": os.cpu_count() or 0},
            "load": {"oneMinute": load[0], "fiveMinutes": load[1], "fifteenMinutes": load[2]},
            "memory": memory,
            "disk": disk_metrics,
            "uptimeSeconds": host_uptime_seconds,
        },
        "interfaces": {
            "tunnel": read_network_interface("tun0"),
            "egress": read_network_interface(egress_interface),
        },
        "openvpnProcess": read_openvpn_process(openvpn_service_name, host_uptime_seconds),
    }
