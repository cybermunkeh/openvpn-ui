# OpenVPN UI

Weboberfläche zur Verwaltung lokaler OpenVPN-Profile und ausgewählter Serverfunktionen. Sie läuft als systemd-Dienst auf Linux. Node.js wird nur benötigt, wenn du die Frontend-Dateien selbst neu bauen willst.

## Installation

Als `root` oder mit `sudo`:

```sh
mkdir openvpn-ui
tar -xzf openvpn-ui-linux.tar.gz -C openvpn-ui
cd openvpn-ui
sudo bash install.sh
```

Der Installer unterstützt Linux mit systemd und `apt`, `dnf`, `yum` oder `zypper`. Er installiert Python, benötigte Systempakete und OpenVPN, falls der Befehl `openvpn` noch fehlt. Eine vorhandene OpenVPN-Konfiguration wird nicht geändert und der OpenVPN-Dienst wird nicht aktiviert oder gestartet. Die Installation des Pakets allein richtet keinen VPN-Server ein.

Die Weboberfläche bindet ausschließlich an `127.0.0.1:8080`. Auf dem eigenen Rechner lässt sie sich sicher per SSH-Tunnel öffnen:

```sh
ssh -L 8080:127.0.0.1:8080 BENUTZER@SERVER
```

Danach im Browser `http://127.0.0.1:8080` öffnen. Die Anwendung hat keine zusätzliche Anmeldung. Lass den Loopback-Bind unverändert und stelle den Port nicht direkt ins Internet.

## Dienst

```sh
systemctl status openvpn-ui
journalctl -u openvpn-ui -f
```

Anwendungsdaten liegen unter `/opt/openvpn-ui/data`. Für Deinstallation:

```sh
systemctl disable --now openvpn-ui
rm -f /etc/systemd/system/openvpn-ui.service
systemctl daemon-reload
rm -rf /opt/openvpn-ui
```

Der letzte Befehl löscht auch Profile, Schlüssel und Backups in `data`; sichere benötigte Daten vorher separat.

## Entwicklung

```sh
cd app
npm ci
npm run build
```

Danach erstellt `../package-release.sh` das installierbare Linux-Paket samt SHA-256-Prüfsumme. Das Release-Paket enthält die gebaute UI, das Backend und den Installer.
