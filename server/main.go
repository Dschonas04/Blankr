package main

// Blankr-Server: statische Auslieferung, Konten, Board-REST-API und die
// WebSocket-Verteilung der CRDT-Operationen.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

// version wird beim Bauen gesetzt: -ldflags "-X main.version=1.0.0".
var version = "dev"

var palette = []string{
	"#e03131", "#1971c2", "#2f9e44", "#f08c00",
	"#9c36b5", "#0c8599", "#e8590c", "#5c940d",
}

var colorIdx atomic.Int64

func logf(format string, args ...any) { log.Printf(format, args...) }

// config sammelt alles, was sich von aussen einstellen laesst. Die Vorgaben
// sind die sichere Wahl fuer den Betrieb in einer Firma: keine offene
// Registrierung, Freigabe-Links fuer Gaeste erlaubt.
type config struct {
	port, daten, static string
	registrierungOffen  bool
	gaeste              bool
	hinterProxy         bool
	sicheresCookie      bool
	metriken            bool
	herkuenfte          []string
	sitzungTage         int
}

func ladeConfig() config {
	tage, err := strconv.Atoi(env("BLANKR_SITZUNG_TAGE", "14"))
	if err != nil || tage < 1 {
		tage = 14
	}
	var herkuenfte []string
	for _, h := range strings.Split(os.Getenv("BLANKR_HERKUENFTE"), ",") {
		if h = strings.TrimSpace(h); h != "" {
			herkuenfte = append(herkuenfte, h)
		}
	}
	return config{
		port:               env("PORT", "8080"),
		daten:              env("BLANKR_DATA", "data"),
		static:             env("BLANKR_STATIC", filepath.Join("..", "client", "dist")),
		registrierungOffen: ja(env("BLANKR_REGISTRIERUNG", "geschlossen"), "offen"),
		gaeste:             ja(env("BLANKR_GAESTE", "ja"), "ja"),
		hinterProxy:        ja(env("BLANKR_HINTER_PROXY", "nein"), "ja"),
		sicheresCookie:     ja(env("BLANKR_SICHERES_COOKIE", "nein"), "ja"),
		metriken:           ja(env("BLANKR_METRIKEN", "nein"), "ja"),
		herkuenfte:         herkuenfte,
		sitzungTage:        tage,
	}
}

func ja(wert, erwartet string) bool {
	w := strings.ToLower(strings.TrimSpace(wert))
	return w == erwartet || w == "true" || w == "1" || (erwartet == "ja" && w == "yes")
}

type server struct {
	cfg           config
	store         *Store
	hub           *Hub
	konten        *Konten
	apiBremse     *Bremse
	anmeldeBremse *Bremse
	upgrader      websocket.Upgrader
}

func neuerServer(cfg config) (*server, error) {
	store, err := NewStore(cfg.daten)
	if err != nil {
		return nil, fmt.Errorf("Datenverzeichnis %s nicht nutzbar: %w", cfg.daten, err)
	}
	konten, err := NeueKonten(cfg.daten, time.Duration(cfg.sitzungTage)*24*time.Hour)
	if err != nil {
		return nil, fmt.Errorf("Konten nicht lesbar: %w", err)
	}
	s := &server{
		cfg:    cfg,
		store:  store,
		hub:    NewHub(store),
		konten: konten,
		// 20 Anfragen je Sekunde im Schnitt, Spitzen bis 120: Boardliste,
		// Umbenennen und Freigaben liegen weit darunter.
		apiBremse: NeueBremse(20, 120),
		// Anmeldung: ein Versuch alle sechs Sekunden, zehn auf Vorrat.
		anmeldeBremse: NeueBremse(1.0/6, 10),
	}
	s.upgrader = websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin:     s.herkunftErlaubt,
	}
	return s, nil
}

func main() {
	cfg := ladeConfig()
	s, err := neuerServer(cfg)
	if err != nil {
		log.Fatal(err)
	}

	srv := &http.Server{
		Addr:              ":" + cfg.port,
		Handler:           s.routen(),
		ReadHeaderTimeout: 10 * time.Second,
		// Kein WriteTimeout: WebSocket-Verbindungen bleiben lange offen.
	}

	go func() {
		log.Printf("Blankr %s laeuft auf http://localhost:%s (%d Board(s), %d Konto/Konten, Registrierung %s, Gaeste %s)",
			version, cfg.port, len(s.store.List()), s.konten.Anzahl(),
			map[bool]string{true: "offen", false: "geschlossen"}[cfg.registrierungOffen],
			map[bool]string{true: "erlaubt", false: "gesperrt"}[cfg.gaeste])
		if s.konten.Anzahl() == 0 {
			log.Printf("Noch kein Konto: das erste, das sich registriert, wird Administrator.")
		}
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server beendet: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("Signal empfangen, speichere offene Boards ...")
	s.hub.flushAll()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	log.Println("beendet")
}

func (s *server) routen() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.health)
	if s.cfg.metriken {
		mux.HandleFunc("/metrics", s.metrics)
	}

	mux.HandleFunc("/api/status", s.status)
	mux.HandleFunc("/api/registrierung", s.registrierung)
	mux.HandleFunc("/api/anmeldung", s.anmeldung)
	mux.HandleFunc("/api/abmeldung", s.abmeldung)
	mux.HandleFunc("/api/konto", s.nurMitKonto(s.kontoAPI))
	mux.HandleFunc("/api/konto/passwort", s.nurMitKonto(s.kontoPasswort))
	mux.HandleFunc("/api/konto/export", s.nurMitKonto(s.kontoExport))
	mux.HandleFunc("/api/admin/konten", s.nurAdmin(s.adminKonten))
	mux.HandleFunc("/api/admin/konten/", s.nurAdmin(s.adminKonto))
	mux.HandleFunc("/api/admin/sicherung", s.nurAdmin(s.sicherung))
	mux.HandleFunc("/api/rechtliches/", s.rechtliches)

	mux.HandleFunc("/api/boards", s.nurMitKonto(s.boards))
	mux.HandleFunc("/api/boards/", s.nurMitKonto(s.board))
	mux.HandleFunc("/api/beitritt/", s.beitritt)
	mux.HandleFunc("/ws", s.websocket)
	mux.Handle("/", s.spa())
	return s.schutz(mux)
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// spa liefert das gebaute Frontend aus und faellt fuer unbekannte Pfade auf
// index.html zurueck.
func (s *server) spa() http.Handler {
	files := http.FileServer(http.Dir(s.cfg.static))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(s.cfg.static, filepath.Clean("/"+r.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			files.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(s.cfg.static, "index.html"))
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": version})
}

func (s *server) metrics(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "# HELP blankr_konten Anzahl der Konten\n# TYPE blankr_konten gauge\nblankr_konten %d\n", s.konten.Anzahl())
	fmt.Fprintf(w, "# HELP blankr_boards Anzahl der Boards\n# TYPE blankr_boards gauge\nblankr_boards %d\n", len(s.store.List()))
	fmt.Fprintf(w, "# HELP blankr_verbindungen Offene WebSocket-Verbindungen\n# TYPE blankr_verbindungen gauge\nblankr_verbindungen %d\n", s.hub.verbindungen())
	fmt.Fprintf(w, "# HELP blankr_anfragen_gesamt HTTP-Anfragen seit dem Start\n# TYPE blankr_anfragen_gesamt counter\nblankr_anfragen_gesamt %d\n", anfragenGesamt.Load())
}

// boardSicht ist, was ein Konto von einem Board zu sehen bekommt. Freigabe-
// Links nur fuer Eigentuemer und Administratoren.
type boardSicht struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
	Online    int    `json:"online"`
	Eigen     bool   `json:"eigen"`
	Besitzer  string `json:"besitzer,omitempty"`
	EditToken string `json:"editToken,omitempty"`
	ViewToken string `json:"viewToken,omitempty"`
}

func (s *server) sicht(b BoardMeta, k *Konto) boardSicht {
	v := boardSicht{
		ID: b.ID, Name: b.Name, CreatedAt: b.CreatedAt, UpdatedAt: b.UpdatedAt,
		Online: s.hub.onlineCount(b.ID), Eigen: b.Owner == k.ID,
		EditToken: b.EditToken, ViewToken: b.ViewToken,
	}
	if !v.Eigen {
		if besitzer, ok := s.konten.Konto(b.Owner); ok {
			v.Besitzer = besitzer.Name
		} else {
			v.Besitzer = "–"
		}
	}
	return v
}

func darf(k *Konto, b BoardMeta) bool {
	return k != nil && (b.Owner == k.ID || k.Rolle == RolleAdmin)
}

func (s *server) boards(w http.ResponseWriter, r *http.Request, k *Konto) {
	switch r.Method {
	case http.MethodGet:
		// Jeder sieht seine eigenen Boards, Administratoren alle -- sie
		// muessen verwaiste Boards eines geloeschten Kontos finden koennen.
		out := []boardSicht{}
		for _, b := range s.store.List() {
			if darf(k, b) {
				out = append(out, s.sicht(b, k))
			}
		}
		writeJSON(w, http.StatusOK, out)

	case http.MethodPost:
		var body struct {
			Name string `json:"name"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body) != nil {
			writeErr(w, http.StatusBadRequest, "Anfrage nicht lesbar")
			return
		}
		b := s.store.Create(body.Name, k.ID)
		writeJSON(w, http.StatusCreated, s.sicht(b, k))

	default:
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
	}
}

// board bedient /api/boards/<id> und /api/boards/<id>/freigabe.
func (s *server) board(w http.ResponseWriter, r *http.Request, k *Konto) {
	teile := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/boards/"), "/")
	id := teile[0]
	b, ok := s.store.Get(id)
	// Fremde Boards melden dasselbe wie unbekannte: wer keinen Zugriff hat,
	// soll auch nicht erfahren, dass es sie gibt.
	if id == "" || !ok || !darf(k, b) || len(teile) > 2 {
		writeErr(w, http.StatusNotFound, "Board unbekannt")
		return
	}
	if len(teile) == 2 {
		if teile[1] != "freigabe" {
			writeErr(w, http.StatusNotFound, "unbekannter Pfad")
			return
		}
		s.freigabe(w, r, k, b)
		return
	}

	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, s.sicht(b, k))

	case http.MethodPatch:
		var body struct {
			Name string `json:"name"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body) != nil ||
			strings.TrimSpace(body.Name) == "" {
			writeErr(w, http.StatusBadRequest, "Name fehlt")
			return
		}
		meta, _ := s.store.Rename(id, body.Name)
		s.hub.mu.Lock()
		offen := s.hub.boards[id]
		s.hub.mu.Unlock()
		if offen != nil {
			offen.broadcast(nil, map[string]any{"type": "board-renamed", "name": meta.Name})
		}
		writeJSON(w, http.StatusOK, s.sicht(meta, k))

	case http.MethodDelete:
		s.boardLoeschen(id)
		w.WriteHeader(http.StatusNoContent)

	default:
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
	}
}

// boardLoeschen trennt alle Teilnehmer und entfernt das Board. Frueher wurde
// ein Board mit aktiven Verbindungen abgelehnt -- damit liess sich ein Board,
// auf dem ein Gast haengen blieb, nie loeschen.
func (s *server) boardLoeschen(id string) {
	s.hub.trennen(id, func(*client) bool { return true })
	s.hub.drop(id)
	s.store.Remove(id)
}

func (s *server) freigabe(w http.ResponseWriter, r *http.Request, k *Konto, b BoardMeta) {
	switch r.Method {
	case http.MethodPost:
		var body struct {
			Rolle string `json:"rolle"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body) != nil {
			writeErr(w, http.StatusBadRequest, "Anfrage nicht lesbar")
			return
		}
		if _, ok := s.store.Freigeben(b.ID, body.Rolle); !ok {
			writeErr(w, http.StatusBadRequest, "Rolle muss „bearbeiten“ oder „ansehen“ sein")
			return
		}
		neu, _ := s.store.Get(b.ID)
		writeJSON(w, http.StatusOK, s.sicht(neu, k))

	case http.MethodDelete:
		rolle := r.URL.Query().Get("rolle")
		if !s.store.FreigabeZurueckziehen(b.ID, rolle) {
			writeErr(w, http.StatusBadRequest, "Rolle muss „bearbeiten“ oder „ansehen“ sein")
			return
		}
		// Wer ueber diesen Link drin ist, fliegt sofort raus. Ein
		// zurueckgezogener Link, mit dem man weiterarbeiten kann, bis man die
		// Seite schliesst, waere keiner.
		s.hub.trennen(b.ID, func(c *client) bool { return c.freigabe == rolle })
		neu, _ := s.store.Get(b.ID)
		writeJSON(w, http.StatusOK, s.sicht(neu, k))

	default:
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
	}
}

// beitritt beantwortet, wohin ein Freigabe-Link fuehrt, ohne die Kennung des
// Boards preiszugeben.
func (s *server) beitritt(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
		return
	}
	b, rolle, ok := s.store.PerToken(strings.TrimPrefix(r.URL.Path, "/api/beitritt/"))
	if !ok {
		writeErr(w, http.StatusNotFound, "Dieser Link ist ungültig oder wurde zurückgezogen.")
		return
	}
	if !s.cfg.gaeste && s.konto(r) == nil {
		writeErr(w, http.StatusUnauthorized, "Für diesen Link ist eine Anmeldung nötig.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"name": b.Name, "rolle": rolle})
}

// saubererName macht aus einer Eingabe einen anzeigbaren Namen.
//
// Er landet ungeprueft in der Oberflaeche der anderen Teilnehmer, also faellt
// alles weg, was dort nichts zu suchen hat: Steuerzeichen, Zeilenumbrueche und
// alles jenseits von 24 Zeichen. Gekuerzt wird nach Runen und nicht nach
// Bytes, sonst zerschneidet die Grenze einen Umlaut.
func saubererName(roh string) string {
	roh = strings.TrimSpace(roh)
	gefiltert := strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, roh)
	runen := []rune(gefiltert)
	if len(runen) > 24 {
		runen = runen[:24]
	}
	return strings.TrimSpace(string(runen))
}

type wsMessage struct {
	Type string          `json:"type"`
	Ops  []Op            `json:"ops,omitempty"`
	X    float64         `json:"x,omitempty"`
	Y    float64         `json:"y,omitempty"`
	Text string          `json:"text,omitempty"`
	ID   json.RawMessage `json:"id,omitempty"`
}

func (s *server) websocket(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	k := s.konto(r)

	var meta BoardMeta
	rolle, freigabe := FreigabeBearbeiten, ""
	if token := q.Get("freigabe"); token != "" {
		b, r2, ok := s.store.PerToken(token)
		if !ok {
			http.Error(w, "Link ungültig oder zurückgezogen", http.StatusNotFound)
			return
		}
		if !s.cfg.gaeste && k == nil {
			http.Error(w, "Anmeldung nötig", http.StatusUnauthorized)
			return
		}
		meta, rolle, freigabe = b, r2, r2
		// Eigentuemer, die ihren eigenen Link oeffnen, bleiben Eigentuemer.
		if darf(k, b) {
			rolle, freigabe = FreigabeBearbeiten, ""
		}
	} else {
		b, ok := s.store.Get(q.Get("board"))
		if !ok || !darf(k, b) {
			// Ohne Anmeldung 401, mit Anmeldung aber fremdem Board 404 -- so
			// weiss der Client, ob er zur Anmeldung schicken muss.
			if k == nil {
				http.Error(w, "Anmeldung nötig", http.StatusUnauthorized)
			} else {
				http.Error(w, "Board unbekannt", http.StatusNotFound)
			}
			return
		}
		meta = b
	}

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	board := s.hub.open(meta.ID)
	n := colorIdx.Add(1)
	// Angemeldete heissen wie ihr Konto. Gaeste bringen den Namen mit, den sie
	// sich gegeben haben; ohne Angabe bleibt es bei der Nummer.
	name := saubererName(q.Get("name"))
	if k != nil && name == "" {
		name = k.Name
	}
	if name == "" {
		name = "Gast " + itoa(n)
	}
	c := &client{
		user: User{
			ID:    zufall(8),
			Color: palette[int(n-1)%len(palette)],
			Name:  name,
		},
		conn:     conn,
		send:     make(chan []byte, sendBuffer),
		rolle:    rolle,
		freigabe: freigabe,
	}
	board.add(c)

	go s.writePump(c)

	init, _ := json.Marshal(map[string]any{
		"type":      "init",
		"userId":    c.user.ID,
		"boardName": meta.Name,
		"rolle":     rolle,
		"users":     board.users(),
		"snapshot":  board.doc.Snapshot(),
	})
	c.send <- init
	board.broadcast(c, map[string]any{"type": "user-joined", "user": c.user})

	s.readPump(board, c)
}

func (s *server) writePump(c *client) {
	defer c.conn.Close()
	for raw := range c.send {
		c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
		if err := c.conn.WriteMessage(websocket.TextMessage, raw); err != nil {
			return
		}
	}
	c.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
}

func (s *server) readPump(board *Board, c *client) {
	defer func() {
		rest := board.remove(c)
		board.broadcast(nil, map[string]any{"type": "user-left", "userId": c.user.ID})
		if rest == 0 {
			board.doc.CollectGarbage(5000)
			board.flush(s.store)
			board.mu.Lock()
			board.unloadTimer = time.AfterFunc(unloadDelay, func() {
				if s.hub.onlineCount(board.id) == 0 {
					s.hub.drop(board.id)
				}
			})
			board.mu.Unlock()
		}
	}()

	c.conn.SetReadLimit(8 << 20) // eingefuegte Bilder koennen gross sein
	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		var msg wsMessage
		if json.Unmarshal(raw, &msg) != nil {
			continue
		}

		switch msg.Type {
		case "ops":
			// Wer nur ansehen darf, aendert nichts -- egal, was der Client
			// schickt. Die Oberflaeche sperrt das Zeichnen ohnehin, aber
			// darauf verlaesst sich der Server nicht.
			if c.rolle != FreigabeBearbeiten || len(msg.Ops) == 0 {
				continue
			}
			// Nur weiterreichen, was den Serverzustand wirklich veraendert --
			// verspaetete oder doppelte Operationen sterben hier.
			if !board.doc.ApplyOps(msg.Ops) {
				continue
			}
			board.broadcast(c, map[string]any{"type": "ops", "ops": msg.Ops})
			board.scheduleSave(s.store, saveDelay)

		case "cursor":
			board.broadcast(c, map[string]any{
				"type": "cursor", "userId": c.user.ID, "x": msg.X, "y": msg.Y,
			})

		case "chat":
			text := []rune(strings.TrimSpace(msg.Text))
			if len(text) == 0 {
				continue
			}
			if len(text) > 2000 {
				text = text[:2000]
			}
			board.broadcast(c, map[string]any{
				"type": "chat", "userId": c.user.ID, "text": string(text), "id": msg.ID,
			})

		case "name":
			// Der Name wird unter derselben Sperre gesetzt, unter der die
			// Nutzerliste gelesen wird -- sonst liest ein anderer Verbund
			// mitten im Schreiben.
			neu := saubererName(msg.Text)
			if neu == "" {
				continue
			}
			board.setzeName(c, neu)
			board.broadcast(c, map[string]any{
				"type": "user-renamed", "userId": c.user.ID, "name": neu,
			})

		case "resync":
			// Notanker fuer den Client: kompletten Zustand erneut anfordern.
			out, _ := json.Marshal(map[string]any{"type": "ops", "ops": board.doc.SnapshotOps()})
			select {
			case c.send <- out:
			default:
			}
		}
	}
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
