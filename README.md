# Blankr – Whiteboard

Blankr ist eine leichtgewichtige, browserbasierte Whiteboard-Anwendung. Sie läuft komplett im Browser und wird über Docker/Nginx bereitgestellt.

## Features

- **Zeichenwerkzeuge** – Stift und Radierer mit einstellbarer Linienstärke
- **Farbauswahl** – Volle Farbpalette über den Color Picker
- **Rückgängig / Wiederholen** – Undo/Redo-Stacks mit Tastenkombinationen (`Ctrl+Z` / `Ctrl+Shift+Z`)
- **Leinwand leeren** – Ein Klick löscht alles
- **Download** – Exportiert die Zeichnung als PNG
- **Export / Import** – Whiteboard-Zustand als JSON speichern und laden
- **Touch-Support** – Zeichnen auf mobilen Geräten
- **Anmeldung** – Login mit Benutzername und Passwort
- **Rollen und Gruppen** – Admin, Editor und Viewer mit unterschiedlichen Berechtigungen
- **Sicherheit** – Security-Header (CSP, X-Frame-Options, etc.) und Input-Validierung
- **Hochverfügbarkeit** – Docker Compose mit Health-Checks und Replicas

## Schnellstart

### Voraussetzungen

- [Docker](https://www.docker.com/) und [Docker Compose](https://docs.docker.com/compose/)

### Starten

```bash
docker compose up -d
```

Die Anwendung ist dann unter [http://localhost:8080](http://localhost:8080) erreichbar.

### Stoppen

```bash
docker compose down
```

## Rollen

| Rolle   | Zeichnen | Werkzeuge | Export/Import | Nutzerverwaltung |
|---------|----------|-----------|---------------|------------------|
| Admin   | ✅       | ✅        | ✅            | ✅               |
| Editor  | ✅       | ✅        | ✅            | ❌               |
| Viewer  | ❌       | ❌        | ❌            | ❌               |

### Standard-Benutzer

| Benutzername | Passwort  | Rolle  |
|-------------|-----------|--------|
| admin       | admin123  | Admin  |
| editor      | editor123 | Editor |
| viewer      | viewer123 | Viewer |

## Hochverfügbarkeit (HA)

Die `docker-compose.yml` unterstützt:

- **Health-Checks** – Nginx wird regelmäßig auf Erreichbarkeit geprüft
- **Restart-Policy** – Container wird bei Ausfall automatisch neu gestartet
- **Replicas** – Mehrere Instanzen können über `deploy.replicas` konfiguriert werden

```yaml
# Anzahl der Replicas anpassen:
deploy:
  replicas: 2
```

## Sicherheit

- **Content Security Policy (CSP)** – Nur eigene Skripte und Styles erlaubt
- **X-Frame-Options** – Schutz vor Clickjacking
- **X-Content-Type-Options** – Verhindert MIME-Sniffing
- **Referrer-Policy** – Minimale Referrer-Informationen
- **Permissions-Policy** – Einschränkung von Browser-APIs
- **Input-Validierung** – Benutzereingaben werden bereinigt

## Tastenkombinationen

| Kürzel            | Aktion           |
|-------------------|------------------|
| `Ctrl + Z`        | Rückgängig       |
| `Ctrl + Shift + Z`| Wiederholen      |

## Tests

Tests befinden sich im Ordner `tests/` und können direkt im Browser oder per Node.js ausgeführt werden:

```bash
node tests/app.test.js
```

## Projektstruktur

```
Blankr/
├── src/
│   ├── app.js           # Anwendungslogik
│   ├── index.html        # HTML-Oberfläche
│   └── style.css         # Styles
├── tests/
│   └── app.test.js       # Unit-Tests
├── Dockerfile            # Container-Image
├── docker-compose.yml    # Container-Orchestrierung
├── nginx.conf            # Webserver-Konfiguration
└── README.md             # Dokumentation
```

## Lizenz

Dieses Projekt ist ein internes Werkzeug und steht unter keiner öffentlichen Lizenz.
