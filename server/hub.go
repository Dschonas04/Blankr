package main

// Verbindungsverwaltung je Board.
//
// Ein Board bleibt geladen, solange jemand darauf arbeitet, und wird danach
// entladen -- der Inhalt liegt dann auf der Platte, nicht im Nichts wie in der
// ersten Fassung, wo der Raum beim Weggehen des letzten Nutzers verschwand.
//
// Geschrieben wird gebuendelt: beim Zeichnen aendert sich ein Board viele Male
// pro Sekunde, auf die Platte muss es aber nur gelegentlich.

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	saveDelay    = 2 * time.Second
	unloadDelay  = 5 * time.Second
	writeTimeout = 10 * time.Second
	sendBuffer   = 256
)

type User struct {
	ID    string `json:"id"`
	Color string `json:"color"`
	Name  string `json:"name"`
}

type client struct {
	user User
	conn *websocket.Conn
	send chan []byte
	once sync.Once
}

// close beendet den Sendekanal genau einmal -- sonst kann ein zweiter
// Aufruf auf einem geschlossenen Kanal in Panik enden.
func (c *client) close() {
	c.once.Do(func() { close(c.send) })
}

type Board struct {
	id      string
	doc     *Doc
	mu      sync.Mutex
	clients map[*client]bool

	saveTimer   *time.Timer
	unloadTimer *time.Timer
}

type Hub struct {
	mu     sync.Mutex
	store  *Store
	boards map[string]*Board
}

func NewHub(store *Store) *Hub {
	return &Hub{store: store, boards: map[string]*Board{}}
}

func (h *Hub) open(id string) *Board {
	h.mu.Lock()
	defer h.mu.Unlock()
	if b, ok := h.boards[id]; ok {
		if b.unloadTimer != nil {
			b.unloadTimer.Stop()
			b.unloadTimer = nil
		}
		return b
	}
	b := &Board{id: id, doc: NewDoc("server"), clients: map[*client]bool{}}
	b.doc.Load(h.store.LoadSnapshot(id))
	h.boards[id] = b
	return b
}

func (h *Hub) onlineCount(id string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	b, ok := h.boards[id]
	if !ok {
		return 0
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.clients)
}

// busy meldet, ob gerade jemand auf dem Board arbeitet -- ein Board mit
// aktiven Verbindungen wird nicht geloescht.
func (h *Hub) busy(id string) bool {
	return h.onlineCount(id) > 0
}

func (h *Hub) drop(id string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.boards, id)
}

func (b *Board) add(c *client) {
	b.mu.Lock()
	b.clients[c] = true
	b.mu.Unlock()
}

func (b *Board) remove(c *client) int {
	b.mu.Lock()
	delete(b.clients, c)
	n := len(b.clients)
	b.mu.Unlock()
	c.close()
	return n
}

func (b *Board) users() []User {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]User, 0, len(b.clients))
	for c := range b.clients {
		out = append(out, c.user)
	}
	return out
}

// broadcast stellt an alle ausser exclude zu. Ist der Puffer eines Clients
// voll, wird die Verbindung getrennt statt den ganzen Server auszubremsen.
func (b *Board) broadcast(exclude *client, msg any) {
	raw, err := json.Marshal(msg)
	if err != nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	for c := range b.clients {
		if c == exclude {
			continue
		}
		select {
		case c.send <- raw:
		default:
			logf("Client %s haengt, Verbindung wird getrennt", c.user.ID)
			delete(b.clients, c)
			c.close()
		}
	}
}

func (b *Board) scheduleSave(store *Store, delay time.Duration) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.saveTimer != nil {
		return // ein Schreibvorgang steht bereits an
	}
	b.saveTimer = time.AfterFunc(delay, func() {
		b.mu.Lock()
		b.saveTimer = nil
		b.mu.Unlock()
		if err := store.SaveSnapshot(b.id, b.doc.Snapshot()); err != nil {
			logf("Board %s konnte nicht gespeichert werden: %v", b.id, err)
		}
	})
}

// flush schreibt sofort und bricht einen anstehenden Schreibvorgang ab.
func (b *Board) flush(store *Store) {
	b.mu.Lock()
	if b.saveTimer != nil {
		b.saveTimer.Stop()
		b.saveTimer = nil
	}
	b.mu.Unlock()
	if err := store.SaveSnapshot(b.id, b.doc.Snapshot()); err != nil {
		logf("Board %s konnte nicht gespeichert werden: %v", b.id, err)
	}
}
