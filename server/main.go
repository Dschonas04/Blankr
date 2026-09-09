package main

// Blankr-Server: statische Auslieferung, Board-REST-API und die
// WebSocket-Verteilung der CRDT-Operationen.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

var palette = []string{
	"#e03131", "#1971c2", "#2f9e44", "#f08c00",
	"#9c36b5", "#0c8599", "#e8590c", "#5c940d",
}

var colorIdx atomic.Int64

func logf(format string, args ...any) { log.Printf(format, args...) }

type server struct {
	store  *Store
	hub    *Hub
	static string
}

func main() {
	port := env("PORT", "8080")
	dataDir := env("BLANKR_DATA", "data")
	staticDir := env("BLANKR_STATIC", filepath.Join("..", "client", "dist"))

	store, err := NewStore(dataDir)
	if err != nil {
		log.Fatalf("Datenverzeichnis %s nicht nutzbar: %v", dataDir, err)
	}
	s := &server{store: store, hub: NewHub(store), static: staticDir}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.health)
	mux.HandleFunc("/api/boards", s.boards)
	mux.HandleFunc("/api/boards/", s.board)
	mux.HandleFunc("/ws", s.websocket)
	mux.Handle("/", s.spa())

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		// Kein WriteTimeout: WebSocket-Verbindungen bleiben lange offen.
	}

	go func() {
		log.Printf("Blankr laeuft auf http://localhost:%s (%d Board(s), Daten in %s)",
			port, len(store.List()), dataDir)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server beendet: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("Signal empfangen, speichere offene Boards ...")

	s.hub.mu.Lock()
	for _, b := range s.hub.boards {
		b.flush(store)
	}
	s.hub.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	log.Println("beendet")
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
	files := http.FileServer(http.Dir(s.static))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(s.static, filepath.Clean(r.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			files.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(s.static, "index.html"))
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"boards": len(s.store.List()),
		"open":   len(s.hub.boards),
	})
}

func (s *server) boards(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list := s.store.List()
		for i := range list {
			list[i].Online = s.hub.onlineCount(list[i].ID)
		}
		writeJSON(w, http.StatusOK, list)

	case http.MethodPost:
		var body struct {
			Name string `json:"name"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body) != nil ||
			strings.TrimSpace(body.Name) == "" {
			writeErr(w, http.StatusBadRequest, "Name fehlt")
			return
		}
		writeJSON(w, http.StatusCreated, s.store.Create(body.Name))

	default:
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
	}
}

func (s *server) board(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/boards/")
	if id == "" || strings.Contains(id, "/") {
		writeErr(w, http.StatusNotFound, "Board unbekannt")
		return
	}

	switch r.Method {
	case http.MethodPatch:
		var body struct {
			Name string `json:"name"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body) != nil ||
			strings.TrimSpace(body.Name) == "" {
			writeErr(w, http.StatusBadRequest, "Name fehlt")
			return
		}
		meta, ok := s.store.Rename(id, body.Name)
		if !ok {
			writeErr(w, http.StatusNotFound, "Board unbekannt")
			return
		}
		if b := s.hub.boards[id]; b != nil {
			b.broadcast(nil, map[string]any{"type": "board-renamed", "name": meta.Name})
		}
		writeJSON(w, http.StatusOK, meta)

	case http.MethodDelete:
		if s.hub.busy(id) {
			writeErr(w, http.StatusConflict, "Board wird gerade bearbeitet")
			return
		}
		if !s.store.Remove(id) {
			writeErr(w, http.StatusNotFound, "Board unbekannt")
			return
		}
		s.hub.drop(id)
		w.WriteHeader(http.StatusNoContent)

	default:
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
	}
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// Der Dienst laeuft im Heimnetz hinter dem Reverse Proxy; die Herkunft
	// wird bewusst nicht geprueft, weil sie je nach Zugriffsweg variiert.
	CheckOrigin: func(*http.Request) bool { return true },
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
	// "room" bleibt als Alias erhalten, damit alte Links weiter funktionieren.
	boardID := q.Get("board")
	if boardID == "" {
		boardID = q.Get("room")
	}
	if boardID == "" {
		http.Error(w, "board fehlt", http.StatusBadRequest)
		return
	}

	meta, known := s.store.Get(boardID)
	if !known {
		http.Error(w, "Board unbekannt", http.StatusNotFound)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	board := s.hub.open(boardID)
	idBuf := make([]byte, 8)
	rand.Read(idBuf)
	n := colorIdx.Add(1)
	// Der Client bringt den Namen mit, den sich jemand gegeben hat. Ohne
	// Angabe bleibt es bei der Nummer: "Gast 3" ist besser als ein leerer
	// Kreis, aber schlechter als ein Name.
	name := saubererName(q.Get("name"))
	if name == "" {
		name = "Gast " + itoa(n)
	}
	c := &client{
		user: User{
			ID:    hex.EncodeToString(idBuf),
			Color: palette[int(n-1)%len(palette)],
			Name:  name,
		},
		conn: conn,
		send: make(chan []byte, sendBuffer),
	}
	board.add(c)

	go s.writePump(c)

	init, _ := json.Marshal(map[string]any{
		"type":      "init",
		"userId":    c.user.ID,
		"boardName": meta.Name,
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
			if len(msg.Ops) == 0 {
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
			board.broadcast(c, map[string]any{
				"type": "chat", "userId": c.user.ID, "text": msg.Text, "id": msg.ID,
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
