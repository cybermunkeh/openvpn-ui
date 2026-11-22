# OpenVPN UI v0.2.0

Standalone Linux release of OpenVPN UI.

## Changes

- Refreshes the OpenVPN UI with the SolidState-IT visual design.
- Removes the separate UFW/firewall management page and API.
- Keeps the OpenVPN server, profile, certificate, diagnostics, and managed VPN networking features.
- Documents the non-interactive Linux installer and its prerequisites.

## Install

Download `openvpn-ui-v0.2.0-linux.tar.gz`, extract it, and run `sudo bash install.sh`. The installer uses systemd and `apt`, `dnf`, `yum`, or `zypper`; it installs OpenVPN only if it is missing, installs the application dependencies, starts the `openvpn-ui` service, and checks `127.0.0.1:8080`.

The UI binds to localhost. Open it through an SSH tunnel as described in [README.md](README.md). The installer does not configure or start an OpenVPN server.

## Verification status

The frontend production build, installer shell syntax, Python bytecode compilation, archive contents, and SHA-256 checksum were verified for this release. The installer was not executed on a Linux host in this release run; this is published as a pre-release for that reason.
