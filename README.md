# Blankr – Whiteboard

Blankr ist eine kollaborative, browserbasierte Whiteboard-Anwendung. Sie nutzt React 19 (Vite 6) als Frontend und einen Go-Server mit WebSockets für Echtzeit-Zusammenarbeit. Alles läuft komplett containerisiert über Docker.

Boards liegen auf dem Server und überstehen einen Neustart. Gleichzeitiges Bearbeiten wird über einen CRDT zusammengeführt, nicht über ein einfaches Weiterreichen von Ereignissen — auch nach einem Verbindungsabbruch sehen alle Beteiligten wieder denselben Stand.

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
- **Undo / Redo** – bis zu 50 Schritte, auch für gezeichnete Striche

### Import & Export
- **PNG** – Pixel-Export mit korrektem Hintergrund
- **JPEG** – Komprimierter Bild-Export
- **SVG** – Vektorgrafik-Export mit allen Formen und Pfeilen
- **JSON** – Projekt speichern und laden (vollständiger State-Export/Import)
- **Bild einfügen** – `Ctrl+V` zum Einfügen von Bildern aus der Zwischenablage
- **Drucken / PDF** – Über den Browser-Druckdialog

### Boards und Zusammenarbeit
- **Benannte Boards** – anlegen, umbenennen, löschen; die Liste zeigt, wer gerade online ist
- **Serverseitige Persistenz** – jedes Board liegt als JSON-Datei auf der Platte und ist nach einem Neustart wieder da
- **CRDT-Zusammenführung** – gleichzeitiges Zeichnen, Verschieben und Löschen läuft zusammen, statt sich zu überschreiben
- **Automatisches Wiederverbinden** – nach einem Aussetzer wird der vollständige Stand neu abgeglichen
- **Rückgängig ohne Kollateralschaden** – Strg+Z nimmt nur die eigenen Änderungen zurück, nicht die der anderen
- **Beitritt über Link** – `?board=<id>`, alte `?room=`-Links funktionieren weiter
- **Nutzerfarben, Remote-Cursor und Chat** – wie gehabt

### Weitere Features
- **Dark Mode** – Umschalten zwischen hellem und dunklem Design mit automatischer Farbanpassung (dunkle Strokes werden im Dark Mode invertiert)
- **Fullscreen** – Vollbild-Modus mit Auto-Hide der UI
- **Drag & Drop Bilder** – Bilder direkt auf das Canvas ziehen
- **Autosave** – Automatisches Speichern im `localStorage`
- **Touch-Support** – Vollständige Touch-Unterstützung inkl. Pinch-Zoom

## Schnellstart

### Voraussetzungen

- [Docker](https://www.docker.com/) und [Docker Compose](https://docs.docker.com/compose/)
- Für die Entwicklung ohne Container: Node.js 22 und Go 1.25

### Mit Docker starten

```bash
docker compose up -d --build
```

Die Anwendung ist dann unter [http://localhost:8080](http://localhost:8080) erreichbar.

### Ohne Container

```bash
cd client && npm ci && npm run build && cd ..
cd server && go run .          # bedient :8080 samt Frontend aus client/dist
```

Für die Frontend-Entwicklung mit Neuladen zusätzlich `cd client && npm run dev`
— der Vite-Server auf :5173 reicht `/api` und `/ws` an den Go-Server weiter.

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
- **Backend** – Go 1.25, `gorilla/websocket`, sonst nur Standardbibliothek
- **Runtime** – statisch gelinkte Binärdatei in Alpine, Docker
- **State** – Custom Store mit `useSyncExternalStore` (kein Redux/Zustand)
- **Synchronisation** – LWW-Element-Set, zweimal implementiert (JS und Go),
  abgesichert über gemeinsame Testvektoren
- **Ablage** – JSON-Dateien, atomar geschrieben (keine Datenbank)

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
├── shared/
│   ├── lww.mjs               # CRDT-Kern (JavaScript-Seite)
│   └── testvectors.json      # verbindliche Fälle für BEIDE Seiten
├── client/
│   ├── src/
│   │   ├── App.jsx           # Haupt-Komponente + Keyboard Shortcuts
│   │   ├── App.css           # Styles (inkl. Dark Mode Tokens)
│   │   ├── store.js          # State, Undo/Redo, Abgleich mit dem CRDT
│   │   ├── collab.js         # WebSocket-Transport + Board-API
│   │   ├── sync/project.js   # Ebenen <-> CRDT-Dokument
│   │   ├── main.jsx          # Entry Point
│   │   └── components/
│   │       ├── Canvas.jsx    # React-Shell (WYSIWYG-Editor + Toolbar)
│   │       ├── canvas/       # Canvas-Engine (modular)
│   │       │   ├── constants.js
│   │       │   ├── geometry.js
│   │       │   ├── hitTest.js
│   │       │   ├── render.js
│   │       │   ├── keyboard.js   # Tastatur + Zwischenablage
│   │       │   ├── events.js     # Zeiger + Render-Schleife
│   │       │   └── index.js
│   │       ├── BoardPicker.jsx   # Board-Verwaltung
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
├── server/                   # Go
│   ├── main.go               # HTTP, REST-API, WebSocket, Shutdown
│   ├── hub.go                # Verbindungen und Boards im Speicher
│   ├── boards.go             # Board-Ablage auf der Platte
│   ├── lww.go                # CRDT-Kern (Go-Seite)
│   ├── lww_test.go           # gemeinsame Testvektoren
│   └── boards_test.go        # Ablage gegen ein echtes Verzeichnis
├── tests/                    # JavaScript
│   ├── crdt.test.mjs         # Zusammenführung, Abgleich, Projektion
│   └── vectors.test.mjs      # dieselben Vektoren wie die Go-Seite
├── Dockerfile                # Multi-Stage Build (Node + Go -> Alpine)
├── docker-compose.yml        # Container-Orchestrierung
└── README.md
```

### Wie die Synchronisation funktioniert

Jedes Objekt trägt eine stabile ID, eine Lamport-Uhr und die ID seines letzten
Schreibers. Beim Zusammenführen gewinnt die höhere Uhr, bei Gleichstand die
größere Site-ID. Diese Regel ist kommutativ, assoziativ und idempotent —
Operationen dürfen also in beliebiger Reihenfolge, mehrfach oder verspätet
eintreffen und ergeben trotzdem überall denselben Zustand. Gelöschtes
hinterlässt einen Grabstein, damit eine verspätete Änderung nichts wiederbelebt.

Der Editor arbeitet intern weiterhin mit Array-Indizes; die Übersetzung nach
außen passiert an genau einer Stelle in `store.setState`. Jede Änderung an den
Ebenen wird dort mit dem Dokument abgeglichen und als Operationsfolge
verschickt — keine der rund zwanzig Schreibstellen im Editor kann den Abgleich
umgehen.

Der Server hält dasselbe Dokument, wendet eingehende Operationen an und gibt
nur weiter, was seinen Zustand tatsächlich verändert. Beim Beitritt und nach
jedem Wiederverbinden bekommt ein Client den vollständigen Schnappschuss.

### Tests

```bash
node --test "tests/**/*.test.mjs"   # JavaScript-Seite
cd server && go test ./...          # Go-Seite
```

Geprüft wird der Code aus `shared/`, `client/src/sync/` und `server/` direkt —
inklusive Konvergenz zweier Clients, Idempotenz, Grabsteinen und der Frage, ob
eine präparierte Board-ID aus dem Datenverzeichnis herausführen kann.

**Zwei Implementierungen, eine Wahrheit.** Die Zusammenführung existiert
zweimal: in JavaScript für den Browser und in Go für den Server. Damit sie
nicht auseinanderlaufen, lesen beide Testläufe dieselbe Datei
`shared/testvectors.json` und prüfen jeden Fall dreifach — vorwärts, rückwärts
und mit doppelt zugestellten Operationen. Wer die Regel auf einer Seite
ändert, ohne die andere anzupassen, bekommt sofort einen roten Testlauf.

## Betrieb

- **Health-Check** – `/healthz` meldet Anzahl der Boards und offenen Sitzungen
- **Restart-Policy** – der Container startet nach einem Ausfall selbst neu
- **Datenvolume** – Boards liegen unter `/data` (`BLANKR_DATA`); ohne eingebundenes
  Volume sind sie beim nächsten Image-Build weg
- **Geordnetes Beenden** – bei `SIGTERM` werden offene Boards noch geschrieben

**Nur eine Instanz.** Der Board-Zustand liegt im Speicher des jeweiligen
Prozesses. Zwei Repliken hinter einem Load Balancer würden zwei getrennte
Wahrheiten führen — dafür bräuchte es einen gemeinsamen Nachrichtenbus.

## Grenzen

- **Kein Zugriffsschutz.** Wer die URL kennt, kann jedes Board öffnen und ändern.
  Für den Betrieb im Internet gehört eine Authentifizierung davor.
- **Text wird als Ganzes zusammengeführt.** Ändern zwei Leute gleichzeitig
  denselben Textblock, gewinnt der spätere Schreiber — es wird nicht
  zeichenweise gemischt.
- **Sticky Notes und Chat werden nicht synchronisiert.** Beide bleiben lokal
  bzw. flüchtig.

## Lizenz

Business Source License 1.1 — siehe [LICENSE](LICENSE).

Kurz gefasst: lesen, ändern, selbst betreiben und beitragen ist erlaubt,
einschließlich Nutzung in der eigenen Organisation. Nicht erlaubt ist es, Blankr
als kommerzielles Angebot für Dritte zu betreiben oder zu verkaufen. Am
**10. August 2030** geht diese Version automatisch in die **Apache-2.0**-Lizenz über.

BSL ist quelloffen, aber keine von der OSI anerkannte Open-Source-Lizenz —
GitHub weist sie deshalb als „Other" aus.
