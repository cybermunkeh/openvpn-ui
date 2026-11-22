from __future__ import annotations

import ipaddress
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import PROFILE_DIR, SERVICE_NAME, STATIC_DIR
from .configuration import (
    ConfigurationApplyError,
    ConfigurationConflict,
    apply_configuration,
    get_configuration,
    validate_configuration,
)
from .diagnostics import run_network_diagnostics
from .pki import (
    configure_vpn_dns,
    control_server,
    create_vpn_user,
    delete_vpn_user,
    get_pki_dashboard,
    detect_public_ipv4,
    initialize_pki,
    install_pihole,
    load_users,
    read_user_bundle,
    reset_managed_openvpn,
    revoke_vpn_user,
)
from .runtime import (
    connect_profile,
    clear_managed_firewall,
    disconnect_profile,
    dns_rows,
    load_recent_logs,
    parse_certificate_summary,
    parse_profile,
    read_profile_text,
    render_profile_download,
    apply_profile_runtime,
    route_rows,
    service_state,
    slugify,
    tun_ipv4,
)
from .store import build_profile_record, ensure_state_dirs, get_group, load_state, save_state

app = FastAPI(title="OpenVPN Control", version="0.2.0")


def build_dashboard() -> dict[str, Any]:
    state = load_state()
    active_service = service_state()
    now = datetime.now(timezone.utc)
    current_profile_id = state.get("current_profile_id")

    for profile in state["profiles"].values():
        profile.setdefault("policyRuntime", {
            "state": "not-applied" if profile.get("configState") == "imported" else "draft",
            "appliedAt": None,
            "message": "Connect this profile to enforce its policies." if profile.get("configState") == "imported" else "Import a real OpenVPN config before applying policies.",
            "restarted": False,
            "rolledBack": False,
        })
        if current_profile_id and profile["id"] == current_profile_id and active_service == "active":
            profile["status"] = "connected"
            profile["metrics"]["connectionUptime"] = "live"
            profile["tunnelIp"] = tun_ipv4() or profile["tunnelIp"]
            profile["routeRows"] = route_rows()
            profile["dnsRows"] = dns_rows() or profile["dnsRows"]
            profile["events"] = load_recent_logs()
        elif profile["status"] == "connecting" and active_service != "active":
            profile["status"] = "disconnected"

    selected_profile_id = state.get("selected_profile_id")
    if not selected_profile_id and state["profiles"]:
        selected_profile_id = next(iter(state["profiles"]))
        state["selected_profile_id"] = selected_profile_id
        save_state(state)

    profile_groups = [
        {
            "id": group["id"],
            "label": group["label"],
            "profileIds": group["profile_ids"],
        }
        for group in state["profile_groups"]
    ]

    return {
        "source": "server",
        "generatedAt": now.strftime("%B %d, %Y %H:%M:%S UTC"),
        "operator": state["operator"],
        "serviceVersion": SERVICE_NAME,
        "selectedProfileId": selected_profile_id,
        "legend": [
            {"label": "Active", "tone": "active"},
            {"label": "Standby", "tone": "standby"},
            {"label": "Down", "tone": "down"},
            {"label": "Route", "tone": "route"},
        ],
        "navigation": state["navigation"],
        "profileGroups": profile_groups,
        "profiles": state["profiles"],
        "pki": get_pki_dashboard(),
    }


@app.on_event("startup")
def startup() -> None:
    ensure_state_dirs()


@app.get("/api/dashboard")
def get_dashboard() -> dict[str, Any]:
    dashboard = build_dashboard()
    dashboard["pki"]["detectedPublicIpv4"] = detect_public_ipv4()
    return dashboard


@app.post("/api/profiles/import")
async def import_profile(
    name: str = Form(...),
    group: str = Form("remote-sites"),
    profile: UploadFile = File(...),
) -> dict[str, Any]:
    state = load_state()
    profile_id = slugify(name)

    if group not in {entry["id"] for entry in state["profile_groups"]}:
        raise HTTPException(status_code=400, detail="Unknown group")

    profile_dir = PROFILE_DIR / profile_id
    profile_dir.mkdir(parents=True, exist_ok=True)
    profile_text = (await profile.read()).decode("utf-8", errors="ignore")
    (profile_dir / "profile.ovpn").write_text(profile_text, encoding="utf-8")

    parsed = parse_profile(profile_text)
    cert = parse_certificate_summary(profile_text)

    record = build_profile_record(
        profile_id=profile_id,
        name=name,
        group=group,
        remote_address=parsed["remote_address"],
        port=parsed["port"],
        protocol=parsed["protocol"],
        config_state="imported",
        certificate=cert,
    )
    record["profileRole"] = "outbound"
    record["events"] = load_recent_logs(limit=10)
    state["profiles"][profile_id] = record

    group_entry = get_group(state, group)
    if profile_id not in group_entry["profile_ids"]:
        group_entry["profile_ids"].append(profile_id)
    state["selected_profile_id"] = profile_id
    save_state(state)
    return {"dashboard": build_dashboard()}


@app.post("/api/profiles")
def create_profile(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    state = load_state()
    name = str(payload.get("name", "")).strip()
    group = str(payload.get("group", "remote-sites")).strip()

    if not name:
        raise HTTPException(status_code=400, detail="Profile name is required")

    if group not in {entry["id"] for entry in state["profile_groups"]}:
        raise HTTPException(status_code=400, detail="Unknown group")

    profile_id = slugify(name)
    existing_profile = state["profiles"].get(profile_id)
    if existing_profile and existing_profile.get("configState") != "draft":
        raise HTTPException(status_code=409, detail="Profile already exists")

    users = load_users()
    user = users.get(profile_id)
    reused_user = bool(user)
    if user and user.get("status") != "active":
        raise HTTPException(status_code=409, detail="A revoked VPN user already exists with this name")
    try:
        if not user:
            user = create_vpn_user({"name": name})
        _filename, profile_text = read_user_bundle(profile_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail="The generated VPN bundle is missing") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    profile_dir = PROFILE_DIR / profile_id
    profile_dir.mkdir(parents=True, exist_ok=True)
    profile_path = profile_dir / "profile.ovpn"
    profile_path.write_text(profile_text, encoding="utf-8")
    profile_path.chmod(0o600)
    parsed = parse_profile(profile_text)
    certificate = parse_certificate_summary(profile_text)
    record = build_profile_record(
        profile_id=profile_id,
        name=name,
        group=group,
        remote_address=parsed["remote_address"],
        port=parsed["port"],
        protocol=parsed["protocol"],
        config_state="imported",
        summary="Client bundle ready",
        certificate=certificate,
    )
    record["profileRole"] = "issued-client"
    record["managedUserId"] = user["id"]
    record["policyRuntime"] = {
        "state": "not-applicable",
        "appliedAt": None,
        "message": "This issued client profile is configured by the managed OpenVPN server.",
        "restarted": False,
        "rolledBack": False,
    }
    state["profiles"][profile_id] = record
    group_entry = get_group(state, group)
    if profile_id not in group_entry["profile_ids"]:
        group_entry["profile_ids"].append(profile_id)
    for other_group in state["profile_groups"]:
        if other_group["id"] != group and profile_id in other_group["profile_ids"]:
            other_group["profile_ids"].remove(profile_id)
    state["selected_profile_id"] = profile_id
    save_state(state)
    return {
        "dashboard": build_dashboard(),
        "profile": record,
        "downloadUrl": f"/api/profiles/{profile_id}/download",
        "reusedUser": reused_user,
    }


def require_profile(profile_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    state = load_state()
    profile = state["profiles"].get(profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Unknown profile")
    return state, profile


def normalize_subnets(values: Any) -> list[str]:
    if not isinstance(values, list):
        raise HTTPException(status_code=400, detail="Subnet lists must be arrays")

    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        cidr = str(value).strip()
        if not cidr:
            continue
        try:
            network = ipaddress.ip_network(cidr, strict=False)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid CIDR: {cidr}") from exc
        canonical = str(network)
        if canonical not in seen:
            seen.add(canonical)
            normalized.append(canonical)
    return normalized


def apply_policy_candidate(state: dict[str, Any], profile: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    if profile.get("profileRole") == "issued-client":
        raise HTTPException(status_code=409, detail="Issued client profiles inherit policy from the managed OpenVPN server")
    if candidate.get("configState") != "imported":
        result = {
            "state": "draft",
            "appliedAt": None,
            "message": "Policy saved to the draft. Import a real OpenVPN config before applying it.",
            "restarted": False,
            "rolledBack": False,
            "checks": [],
        }
    elif state.get("current_profile_id") == profile["id"] and service_state() == "active":
        result = apply_profile_runtime(candidate, activate=True)
    else:
        result = {
            "state": "staged",
            "appliedAt": datetime.now(timezone.utc).isoformat(),
            "message": "Policy staged and will be enforced on the next connection.",
            "restarted": False,
            "rolledBack": False,
            "checks": ["profile-input"],
        }

    candidate["policyRuntime"] = result
    state["profiles"][profile["id"]] = candidate
    save_state(state)
    return result


@app.post("/api/profiles/{profile_id}/connect")
def api_connect_profile(profile_id: str) -> dict[str, Any]:
    state, profile = require_profile(profile_id)
    if profile.get("profileRole") == "issued-client":
        raise HTTPException(status_code=409, detail="Issued client profiles are downloaded to client devices, not connected on this server")
    if profile.get("configState") != "imported":
        raise HTTPException(status_code=409, detail="Draft profiles cannot connect until a real OpenVPN config is imported")
    apply_result = connect_profile(profile)
    state["current_profile_id"] = profile_id
    state["selected_profile_id"] = profile_id
    for entry in state["profiles"].values():
        entry["status"] = "disconnected"
    state["profiles"][profile_id]["status"] = "connected"
    state["profiles"][profile_id]["policyRuntime"] = apply_result
    save_state(state)
    return {"dashboard": build_dashboard(), "apply": apply_result}


@app.get("/api/profiles/{profile_id}/download")
def api_download_profile(profile_id: str) -> Response:
    _state, profile = require_profile(profile_id)
    filename = f"{slugify(profile['name']) or profile['id']}.ovpn"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
    }
    if profile.get("profileRole") == "issued-client":
        user = load_users().get(profile.get("managedUserId"))
        if not user or user.get("status") != "active":
            raise HTTPException(status_code=410, detail="The VPN credential for this profile is no longer active")
        try:
            _managed_filename, content = read_user_bundle(profile["managedUserId"])
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Issued client bundle is missing") from exc
    else:
        content = render_profile_download(profile)
    return Response(
        content=content,
        media_type="application/x-openvpn-profile",
        headers=headers,
    )


@app.post("/api/pki/init")
def api_initialize_pki(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        pki_dashboard = initialize_pki(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"dashboard": build_dashboard(), "pki": pki_dashboard}


@app.post("/api/pki/server/{action}")
def api_control_server(action: str) -> dict[str, Any]:
    try:
        pki_dashboard = control_server(action)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"dashboard": build_dashboard(), "pki": pki_dashboard}


@app.patch("/api/pki/dns")
def api_configure_vpn_dns(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        pki_dashboard = configure_vpn_dns(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"dashboard": build_dashboard(), "pki": pki_dashboard}


@app.post("/api/pki/pihole/install")
def api_install_pihole(payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    try:
        pki_dashboard = install_pihole(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"dashboard": build_dashboard(), "pki": pki_dashboard}


@app.post("/api/reset")
def api_reset_managed_openvpn() -> dict[str, Any]:
    try:
        disconnect_profile()
        clear_managed_firewall()
        pki_dashboard = reset_managed_openvpn()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"dashboard": build_dashboard(), "pki": pki_dashboard}


@app.post("/api/users")
def api_create_user(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        user = create_vpn_user(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"dashboard": build_dashboard(), "user": user}


@app.get("/api/users/{user_id}/download")
def api_download_user(user_id: str) -> Response:
    try:
        filename, content = read_user_bundle(user_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Unknown user") from exc
    return Response(
        content=content,
        media_type="application/x-openvpn-profile",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/users/{user_id}/revoke")
def api_revoke_user(user_id: str) -> dict[str, Any]:
    try:
        user = revoke_vpn_user(user_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Unknown user") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"dashboard": build_dashboard(), "user": user}


@app.delete("/api/users/{user_id}")
def api_delete_user(user_id: str) -> dict[str, Any]:
    try:
        delete_vpn_user(user_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Unknown user") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"dashboard": build_dashboard(), "deletedUserId": user_id}


@app.post("/api/profiles/{profile_id}/select")
def api_select_profile(profile_id: str) -> dict[str, Any]:
    state, _profile = require_profile(profile_id)
    state["selected_profile_id"] = profile_id
    save_state(state)
    return {"dashboard": build_dashboard()}


@app.delete("/api/profiles/{profile_id}")
def api_delete_profile(profile_id: str) -> dict[str, Any]:
    state, profile = require_profile(profile_id)
    if state.get("current_profile_id") == profile_id:
        disconnect_profile()
        clear_managed_firewall()
        state["current_profile_id"] = None

    for group in state["profile_groups"]:
        group["profile_ids"] = [entry_id for entry_id in group["profile_ids"] if entry_id != profile_id]

    profile_dir = PROFILE_DIR / profile_id
    if profile_dir.exists():
        for path in sorted(profile_dir.rglob("*"), reverse=True):
            if path.is_file():
                path.unlink(missing_ok=True)
            elif path.is_dir():
                path.rmdir()
        profile_dir.rmdir()

    del state["profiles"][profile_id]
    if state.get("selected_profile_id") == profile_id:
        state["selected_profile_id"] = next(iter(state["profiles"]), None)
    save_state(state)
    return {"dashboard": build_dashboard(), "deletedProfileId": profile["id"]}


@app.post("/api/profiles/{profile_id}/disconnect")
def api_disconnect_profile(profile_id: str) -> dict[str, Any]:
    state, profile = require_profile(profile_id)
    disconnect_profile()
    profile["status"] = "disconnected"
    if state.get("current_profile_id") == profile_id:
        state["current_profile_id"] = None
    save_state(state)
    return {"dashboard": build_dashboard()}


@app.patch("/api/profiles/{profile_id}/routing")
def api_patch_routing(profile_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    state, profile = require_profile(profile_id)
    route_mode = payload.get("route_mode")
    if route_mode not in {"full", "split"}:
        raise HTTPException(status_code=400, detail="route_mode must be full or split")
    candidate = deepcopy(profile)
    candidate["routeMode"] = route_mode
    apply_result = apply_policy_candidate(state, profile, candidate)
    return {"dashboard": build_dashboard(), "apply": apply_result}


@app.patch("/api/profiles/{profile_id}/subnets")
def api_patch_subnets(profile_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    state, profile = require_profile(profile_id)
    candidate = deepcopy(profile)
    candidate["includedSubnets"] = normalize_subnets(payload.get("includedSubnets", profile.get("includedSubnets", [])))
    candidate["excludedSubnets"] = normalize_subnets(payload.get("excludedSubnets", profile.get("excludedSubnets", [])))
    apply_result = apply_policy_candidate(state, profile, candidate)
    return {"dashboard": build_dashboard(), "apply": apply_result}


@app.patch("/api/profiles/{profile_id}/security")
def api_patch_security(profile_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    state, profile = require_profile(profile_id)
    candidate = deepcopy(profile)
    for key, value in payload.items():
        if key not in candidate["security"]:
            raise HTTPException(status_code=400, detail=f"Unknown security key: {key}")
        if key in {"killSwitch", "blockLanOnVpnDown", "dnsProtection", "ipv6LeakProtection", "autoReconnect", "startOnBoot"} and not isinstance(value, bool):
            raise HTTPException(status_code=400, detail=f"Security key {key} must be boolean")
        candidate["security"][key] = value
    apply_result = apply_policy_candidate(state, profile, candidate)
    return {"dashboard": build_dashboard(), "apply": apply_result}


@app.post("/api/diagnostics/run")
def api_run_diagnostics() -> dict[str, Any]:
    return {"diagnostics": run_network_diagnostics()}


@app.get("/api/openvpn/configuration")
def api_get_openvpn_configuration(target: str | None = None) -> dict[str, Any]:
    try:
        return {"configuration": get_configuration(target)}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Unknown OpenVPN configuration target") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/openvpn/configuration/validate")
def api_validate_openvpn_configuration(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    target_id = str(payload.get("targetId", "")).strip()
    content = payload.get("content")
    if not target_id or not isinstance(content, str):
        raise HTTPException(status_code=400, detail="targetId and text content are required")
    try:
        return {"result": validate_configuration(target_id, content)}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Unknown OpenVPN configuration target") from exc


@app.put("/api/openvpn/configuration")
def api_apply_openvpn_configuration(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    target_id = str(payload.get("targetId", "")).strip()
    content = payload.get("content")
    revision = str(payload.get("revision", "")).strip()
    if not target_id or not isinstance(content, str) or not revision:
        raise HTTPException(status_code=400, detail="targetId, revision and text content are required")
    try:
        configuration = apply_configuration(
            target_id,
            content,
            revision,
            bool(payload.get("acknowledgeRisk")),
            bool(payload.get("restart", True)),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Unknown OpenVPN configuration target") from exc
    except ConfigurationConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ConfigurationApplyError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"configuration": configuration, "dashboard": build_dashboard()}


if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def serve_app(path: str) -> FileResponse:
    if path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")

    target = STATIC_DIR / path
    if path and target.is_file():
        return FileResponse(target)

    index_path = STATIC_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=503, detail="Frontend build not found")
    return FileResponse(index_path)
