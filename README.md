# Blankr – Whiteboard

Blankr ist eine kollaborative, browserbasierte Whiteboard-Anwendung. Sie nutzt React (Vite) als Frontend und Express mit WebSockets für Echtzeit-Zusammenarbeit.

## Features

- **Zeichenwerkzeuge** – Stift, Linie, Pfeil, Rechteck, Kreis, Text, Radierer, Laser-Pointer
- **Farbauswahl** – Volle Farbpalette über den Color Picker
- **Rückgängig / Wiederholen** – Undo/Redo mit Tastenkombinationen (`Ctrl+Z` / `Ctrl+Shift+Z`)
- **Zoom & Pan** – Zoom-Controls und Hand-Tool zum Navigieren
- **Layer-System** – Ebenen-Panel zur Organisation von Zeichnungen
- **Sticky Notes** – Notizen direkt auf dem Whiteboard platzieren
- **Echtzeit-Kollaboration** – Mehrere Nutzer zeichnen gleichzeitig über WebSockets
- **Dark Mode** – Umschalten zwischen hellem und dunklem Design
- **Fullscreen** – Vollbild-Modus für ungestörtes Arbeiten
- **Touch-Support** – Zeichnen auf mobilen Geräten
- **Hochverfügbarkeit** – Docker Compose mit Health-Checks und Replicas

## Schnellstart

### Voraussetzungen

- [Docker](https://www.docker.com/) und [Docker Compose](https://docs.docker.com/compose/)
- [Node.js](https://nodejs.org/) (v20+) für lokale Entwicklung

### Mit Docker starten

```bash
docker compose up -d
```

Die Anwendung ist dann unter [http://localhost:8080](http://localhost:8080) erreichbar.

### Lokale Entwicklung

```bash
# Server starten
cd server && npm install && npm start

# In einem separaten Terminal: Client starten
cd client && npm install && npm run dev
```

### Stoppen (Docker)

```bash
docker compose down
```

## Echtzeit-Kollaboration

Blankr unterstützt Echtzeit-Zusammenarbeit über WebSockets:

- Raum beitreten: `http://localhost:8080?room=<room-id>`
- Strokes, Cursor-Positionen und Clear-Events werden live synchronisiert
- Jeder Nutzer erhält automatisch eine eigene Farbe

## Tastenkombinationen

| Kürzel             | Aktion            |
|--------------------|-------------------|
| `P`                | Stift             |
| `L`                | Linie             |
| `A`                | Pfeil             |
| `R`                | Rechteck          |
| `O`                | Kreis             |
| `T`                | Text              |
| `E`                | Radierer          |
| `Z`                | Laser-Pointer     |
| `H`                | Hand (Pan)        |
| `F`                | Fullscreen         |
| `D`                | Dark Mode          |
| `Ctrl + Z`         | Rückgängig        |
| `Ctrl + Shift + Z` | Wiederholen       |
| `Escape`           | Fullscreen beenden |

## Hochverfügbarkeit (HA)

Die `docker-compose.yml` unterstützt:

- **Health-Checks** – Server wird regelmäßig auf Erreichbarkeit geprüft
- **Restart-Policy** – Container wird bei Ausfall automatisch neu gestartet
- **Replicas** – Mehrere Instanzen können über `deploy.replicas` konfiguriert werden

```yaml
# Anzahl der Replicas anpassen:
deploy:
  replicas: 2
```

## Tests

Tests befinden sich im Ordner `tests/` und können per Node.js ausgeführt werden:

```bash
node tests/app.test.js
```

## Projektstruktur

```
Blankr/
├── client/
│   ├── src/
│   │   ├── App.jsx          # Haupt-Komponente
│   │   ├── store.js         # Zustand (Zustand-Store)
│   │   ├── collab.js        # WebSocket-Kollaboration
│   │   ├── main.jsx         # Entry Point
│   │   └── components/      # UI-Komponenten
│   ├── index.html           # HTML-Template
│   ├── vite.config.js       # Vite-Konfiguration
│   └── package.json
├── server/
│   ├── index.js             # Express + WebSocket Server
│   └── package.json
├── tests/
│   └── app.test.js          # Unit-Tests
├── Dockerfile               # Multi-Stage Container-Image
├── docker-compose.yml       # Container-Orchestrierung
└── README.md                # Dokumentation
```

## Lizenz

Dieses Projekt ist ein internes Werkzeug und steht unter keiner öffentlichen Lizenz.
