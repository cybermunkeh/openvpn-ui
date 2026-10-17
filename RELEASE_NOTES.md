# OpenVPN UI v0.1.0

First standalone preview release for Linux.

## Included

- React/Vite frontend source and production build.
- FastAPI backend and systemd unit.
- Installer for systemd hosts using apt, dnf, yum, or zypper.
- Self-contained runtime archive and SHA-256 checksum.

## Install

Download `openvpn-ui-v0.1.0-linux.tar.gz`, extract it, then run `sudo bash install.sh` from the extracted directory. See [README.md](README.md) for access and service details.

The UI listens only on `127.0.0.1:8080` and has no separate login. Use an SSH tunnel. The installer was syntax-checked and the frontend was built on Windows, but installation and runtime behavior have not yet been verified on a Linux host. Treat this as a preview release.
