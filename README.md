# OpenVPN UI

Weboberfläche zur Verwaltung lokaler OpenVPN-Profile und ausgewählter Serverfunktionen. Sie läuft als systemd-Dienst auf Linux. Node.js wird nur benötigt, wenn du die Frontend-Dateien selbst neu bauen willst.

Das Release enthält ausschließlich OpenVPN UI mit Weboberfläche, Backend und Installer. Eine separate UFW-/Firewall-Verwaltungsoberfläche ist nicht enthalten.

## Installation

Als `root` oder mit `sudo`:

```sh
mkdir openvpn-ui
tar -xzf openvpn-ui-linux.tar.gz -C openvpn-ui
cd openvpn-ui
sudo bash install.sh
```

Der Installer läuft ohne interaktive Rückfragen, wenn er mit Root-Rechten gestartet wird. Er unterstützt Linux mit systemd und `apt`, `dnf`, `yum` oder `zypper`. Er aktualisiert die Paketlisten, installiert Python, OpenSSL, Netzwerkwerkzeuge, `iptables`, `curl` und OpenVPN, falls der Befehl `openvpn` noch fehlt. Danach richtet er die Python-Umgebung, die Anwendung und den systemd-Dienst ein, startet den Dienst und prüft die lokale HTTP-Erreichbarkeit. Eine vorhandene Installation unter `/opt/openvpn-ui` muss vorher gesichert und entfernt werden; ein automatisches Update ist derzeit nicht enthalten.

Der Installer installiert OpenVPN bei Bedarf, konfiguriert aber keinen VPN-Server und ändert keine vorhandene OpenVPN-Konfiguration. `iptables` wird für die später optional nutzbare VPN-NAT-/Weiterleitungsfunktion der Anwendung installiert; UFW wird nicht installiert. Die Installation richtet allein die Weboberfläche ein.

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
