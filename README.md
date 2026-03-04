# Blankr – Whiteboard

Blankr ist eine kollaborative, browserbasierte Whiteboard-Anwendung. Sie nutzt React 19 (Vite 6) als Frontend und Express mit WebSockets für Echtzeit-Zusammenarbeit. Alles läuft komplett containerisiert über Docker.

## Features

### Zeichenwerkzeuge
- **Stift** – Freihandzeichnen mit konfigurierbarer Strichstärke
- **Linie / Pfeil** – Gerade Linien und Pfeile im draw.io-Stil (offene V-Pfeilspitzen)
- **Rechteck / Kreis** – Geometrische Formen, optional mit Füllung
- **Dreieck / Raute / Stern / Hexagon** – Weitere Polygon-Formen mit Füllung
- **Text** – WYSIWYG-Inline-Editor mit formatierter Textbearbeitung (Fett, Kursiv, Schriftgröße)
- **Text auf Formen** – Doppelklick auf Formen fügt ein zentriertes Label hinzu
- **Rahmen (Frame)** – Benannte Bereiche auf dem Canvas zur Organisation
- **Radierer** – Objekt-basierter Radierer (entfernt ganze Strokes per Klick/Ziehen)
- **Laser-Pointer** – Roter Laser-Cursor mit verblassender Spur
- **Connector** – Verbindungspfeile zwischen Objekten mit automatischem Anchor-Snapping

### Auswahl & Bearbeitung
- **Multi-Select** – Shift+Klick oder Gummiband-Auswahl für mehrere Objekte
- **Verschieben** – Alle ausgewählten Objekte gleichzeitig per Drag & Drop bewegen
- **Größe ändern** – Eck-Handles zum Skalieren (bei Einzelauswahl)
- **Drehen** – Rotations-Handle für beliebige Drehwinkel
- **Endpunkte ziehen** – Anfangs-/Endpunkte von Linien, Pfeilen und Connectoren einzeln verschieben
- **Farbe ändern** – Farbauswahl wirkt auf alle ausgewählten Objekte
- **Kopieren / Einfügen / Duplizieren** – `Ctrl+C/V/D` für Zwischenablage-Operationen
- **Ausschneiden** – `Ctrl+X` zum Ausschneiden
- **Pfeil-Nudging** – Pfeiltasten verschieben Auswahl um 1px, mit Shift um 10px
- **Löschen** – Auswahl mit `Delete`/`Backspace` entfernen
- **Z-Order** – `Ctrl+]`/`[` zum Nach-vorne/hinten-Schieben
- **Gruppieren / Auflösen** – `Ctrl+G` / `Ctrl+Shift+G`
- **Rechtsklick-Kontextmenü** – Schnellzugriff auf alle Bearbeitungsaktionen
- **Alignment Guides** – Automatische Ausrichtungshilfen beim Verschieben
- **Raster-Snapping** – Optionales Einrasten am Raster

### Canvas & Navigation
- **Zoom & Pan** – Mausrad-Zoom, Hand-Tool und Space-Drag
- **Pinch-to-Zoom** – Touch-Gesten auf mobilen Geräten
- **Hintergrundmuster** – Punkte, Raster, Linien oder leer
- **HiDPI-Support** – Scharfes Rendering auf Retina-Displays (`devicePixelRatio`)

### Organisation
- **Layer-System** – Ebenen-Panel zur Organisation von Zeichnungen mit Sichtbarkeit und Deckkraft
- **Sticky Notes** – Farbige Haftnotizen direkt auf dem Whiteboard
- **Undo / Redo** – Unbegrenzte Rückgängig-History (bis zu 50 Schritte)

### Import & Export
- **PNG** – Pixel-Export mit korrektem Hintergrund
- **JPEG** – Komprimierter Bild-Export
- **SVG** – Vektorgrafik-Export mit allen Formen und Pfeilen
- **JSON** – Projekt speichern und laden (vollständiger State-Export/Import)
- **Bild einfügen** – `Ctrl+V` zum Einfügen von Bildern aus der Zwischenablage
- **Drucken / PDF** – Über den Browser-Druckdialog

### Echtzeit-Kollaboration
- **WebSocket-Sync** – Strokes, Cursor-Positionen und Clear-Events live synchronisiert
- **Raum-System** – Beitritt über URL-Parameter `?room=<id>`
- **Nutzerfarben** – Jeder Teilnehmer erhält automatisch eine eigene Farbe
- **Remote-Cursor mit Namen** – Cursor anderer Teilnehmer werden mit Name in Echtzeit angezeigt
- **Chat** – Integrierter Chat-Sidebar für Textnachrichten

### Weitere Features
- **Dark Mode** – Umschalten zwischen hellem und dunklem Design mit automatischer Farbanpassung (dunkle Strokes werden im Dark Mode invertiert)
- **Fullscreen** – Vollbild-Modus mit Auto-Hide der UI
- **Drag & Drop Bilder** – Bilder direkt auf das Canvas ziehen
- **Autosave** – Automatisches Speichern im `localStorage`
- **Touch-Support** – Vollständige Touch-Unterstützung inkl. Pinch-Zoom

## Schnellstart

### Voraussetzungen

- [Docker](https://www.docker.com/) und [Docker Compose](https://docs.docker.com/compose/)

### Mit Docker starten

```bash
docker compose up -d --build
```

Die Anwendung ist dann unter [http://localhost:8080](http://localhost:8080) erreichbar.

### Stoppen

```bash
docker compose down
```

## Tastenkombinationen

| Kürzel             | Aktion              |
|--------------------|---------------------|
| `V`                | Auswählen           |
| `P`                | Stift               |
| `L`                | Linie               |
| `A`                | Pfeil               |
| `R`                | Rechteck            |
| `O`                | Kreis               |
| `T`                | Text                |
| `E`                | Radierer            |
| `C`                | Connector           |
| `Z`                | Laser-Pointer       |
| `H`                | Hand (Pan)          |
| `F`                | Fullscreen          |
| `D`                | Dark Mode           |
| `Space` (halten)   | Pan (temporär)      |
| `Delete`/`Backspace` | Auswahl löschen   |
| `Ctrl + C`         | Kopieren            |
| `Ctrl + X`         | Ausschneiden        |
| `Ctrl + V`         | Einfügen (auch Bilder) |
| `Ctrl + D`         | Duplizieren         |
| `Ctrl + A`         | Alles auswählen     |
| `Ctrl + G`         | Gruppieren          |
| `Ctrl + Shift + G` | Gruppierung aufheben |
| `Ctrl + ]`         | Eine Ebene nach vorne |
| `Ctrl + [`         | Eine Ebene nach hinten |
| `Ctrl + Shift + ]` | Ganz nach vorne     |
| `Ctrl + Shift + [` | Ganz nach hinten    |
| `Ctrl + Z`         | Rückgängig          |
| `Ctrl + Shift + Z` | Wiederholen         |
| `↑ ↓ ← →`         | Auswahl um 1px verschieben |
| `Shift + ↑ ↓ ← →` | Auswahl um 10px verschieben |
| `Escape`           | Auswahl aufheben / Fullscreen beenden |

## Architektur

### Tech-Stack
- **Frontend** – React 19, Vite 6, HTML5 Canvas 2D
- **Backend** – Express 4, ws 8 (WebSockets)
- **Runtime** – Node.js 20 (Alpine), Docker
- **State** – Custom Store mit `useSyncExternalStore` (kein Redux/Zustand)

### Canvas-Modul
Die Canvas-Logik ist in eigenständige Module aufgeteilt:

| Modul         | Verantwortung                                     |
|---------------|--------------------------------------------------|
| `constants.js` | Shared Konstanten (Spacing, Handle-Größen etc.) |
| `geometry.js`  | Pure Geometrie-Funktionen (BBox, Move, Resize)  |
| `hitTest.js`   | Hit Testing mit Rotations-Support               |
| `render.js`    | Alle Draw-Calls (Background, Strokes, Selection)|
| `events.js`    | Event-Handler + Render-Loop                     |

## Projektstruktur

```
Blankr/
├── client/
│   ├── src/
│   │   ├── App.jsx           # Haupt-Komponente + Keyboard Shortcuts
│   │   ├── App.css           # Styles (inkl. Dark Mode Tokens)
│   │   ├── store.js          # State-Management (useSyncExternalStore)
│   │   ├── collab.js         # WebSocket-Kollaboration
│   │   ├── main.jsx          # Entry Point
│   │   └── components/
│   │       ├── Canvas.jsx    # React-Shell (WYSIWYG-Editor + Toolbar)
│   │       ├── canvas/       # Canvas-Engine (modular)
│   │       │   ├── constants.js
│   │       │   ├── geometry.js
│   │       │   ├── hitTest.js
│   │       │   ├── render.js
│   │       │   ├── events.js
│   │       │   └── index.js
│   │       ├── Toolbar.jsx
│   │       ├── PropertiesBar.jsx
│   │       ├── ActionBar.jsx
│   │       ├── ZoomControls.jsx
│   │       ├── LayerPanel.jsx
│   │       ├── CollabBar.jsx
│   │       ├── ContextMenu.jsx
│   │       ├── ChatPanel.jsx
│   │       ├── StickyNotes.jsx
│   │       └── Toast.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── server/
│   ├── index.js              # Express + WebSocket Server
│   └── package.json
├── tests/
│   └── app.test.js
├── Dockerfile                # Multi-Stage Build (node:20-alpine)
├── docker-compose.yml        # Container-Orchestrierung
└── README.md
```

## Hochverfügbarkeit (HA)

Die `docker-compose.yml` unterstützt:

- **Health-Checks** – Server wird regelmäßig auf Erreichbarkeit geprüft
- **Restart-Policy** – Container wird bei Ausfall automatisch neu gestartet
- **Replicas** – Mehrere Instanzen können über `deploy.replicas` konfiguriert werden

## Lizenz

Dieses Projekt ist ein internes Werkzeug und steht unter keiner öffentlichen Lizenz.
