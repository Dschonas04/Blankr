package main

// LWW-Element-Set -- der CRDT-Kern.
//
// Diese Datei ist die Go-Entsprechung von shared/lww.mjs. Beide muessen exakt
// dieselbe Zusammenfuehrung rechnen, sonst laufen Client und Server
// auseinander. Damit das nicht unbemerkt passieren kann, pruefen beide Seiten
// dieselben Testvektoren aus shared/testvectors.json:
//   Go: go test ./...        JS: node --test tests/vectors.test.mjs
//
// Modell: eine Menge von Eintraegen mit stabiler ID, jeder mit Lamport-Uhr und
// Site-ID des letzten Schreibers. Beim Zusammenfuehren gewinnt die hoehere
// Uhr, bei Gleichstand die lexikografisch groessere Site-ID. Diese Regel ist
// kommutativ, assoziativ und idempotent -- Operationen duerfen in beliebiger
// Reihenfolge, mehrfach und verspaetet eintreffen.
//
// Loeschen setzt einen Grabstein statt den Eintrag zu entfernen, sonst koennte
// eine verspaetete Aenderung ein geloeschtes Objekt wiederbeleben.

import (
	"encoding/json"
	"sync"
)

type Entry struct {
	ID      string          `json:"id"`
	Clock   int64           `json:"clock"`
	Site    string          `json:"site"`
	Deleted bool            `json:"deleted"`
	Kind    string          `json:"kind"`
	Data    json.RawMessage `json:"data,omitempty"`
}

type Op struct {
	T     string          `json:"t"` // "set" oder "del"
	ID    string          `json:"id"`
	Kind  string          `json:"kind,omitempty"`
	Data  json.RawMessage `json:"data,omitempty"`
	Clock int64           `json:"clock"`
	Site  string          `json:"site"`
}

type Snapshot struct {
	Clock   int64   `json:"clock"`
	Entries []Entry `json:"entries"`
}

// Doc ist nebenlaeufig sicher: mehrere WebSocket-Verbindungen desselben
// Boards schreiben gleichzeitig hinein.
type Doc struct {
	mu      sync.RWMutex
	site    string
	clock   int64
	entries map[string]Entry
}

func NewDoc(site string) *Doc {
	return &Doc{site: site, entries: map[string]Entry{}}
}

// wins entscheidet, ob a den bestehenden Eintrag b verdraengt.
func wins(a, b Entry, exists bool) bool {
	if !exists {
		return true
	}
	if a.Clock != b.Clock {
		return a.Clock > b.Clock
	}
	return a.Site > b.Site
}

// ApplyOp wendet eine Operation an und meldet, ob sich dadurch etwas geaendert
// hat. Nur tatsaechliche Aenderungen werden weiterverteilt -- verspaetete oder
// doppelte Operationen sterben hier.
func (d *Doc) ApplyOp(op Op) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.applyLocked(op)
}

func (d *Doc) applyLocked(op Op) bool {
	if op.Clock > d.clock {
		d.clock = op.Clock
	}
	cur, exists := d.entries[op.ID]

	kind := op.Kind
	if kind == "" && exists {
		kind = cur.Kind
	}
	if kind == "" {
		kind = "stroke"
	}

	next := Entry{
		ID:      op.ID,
		Clock:   op.Clock,
		Site:    op.Site,
		Deleted: op.T == "del",
		Kind:    kind,
		Data:    op.Data,
	}
	if next.Deleted {
		next.Data = nil
	}
	if !wins(next, cur, exists) {
		return false
	}
	d.entries[op.ID] = next
	return true
}

func (d *Doc) ApplyOps(ops []Op) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	changed := false
	for _, op := range ops {
		if d.applyLocked(op) {
			changed = true
		}
	}
	return changed
}

func (d *Doc) Snapshot() Snapshot {
	d.mu.RLock()
	defer d.mu.RUnlock()
	out := Snapshot{Clock: d.clock, Entries: make([]Entry, 0, len(d.entries))}
	for _, e := range d.entries {
		out.Entries = append(out.Entries, e)
	}
	// Stabile Reihenfolge: sonst unterscheiden sich zwei Schnappschuesse
	// desselben Zustands, und die Ablage schreibt bei jedem Speichern eine
	// andere Datei.
	sortEntries(out.Entries)
	return out
}

func (d *Doc) Load(s Snapshot) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.entries = make(map[string]Entry, len(s.Entries))
	d.clock = s.Clock
	for _, e := range s.Entries {
		if e.ID == "" {
			continue
		}
		if e.Kind == "" {
			e.Kind = "stroke"
		}
		if e.Deleted {
			e.Data = nil
		}
		d.entries[e.ID] = e
		if e.Clock > d.clock {
			d.clock = e.Clock
		}
	}
}

// SnapshotOps gibt den Zustand als Operationsfolge aus -- fuer den
// Erstabgleich beim Verbinden.
func (d *Doc) SnapshotOps() []Op {
	snap := d.Snapshot()
	ops := make([]Op, 0, len(snap.Entries))
	for _, e := range snap.Entries {
		op := Op{ID: e.ID, Kind: e.Kind, Clock: e.Clock, Site: e.Site}
		if e.Deleted {
			op.T = "del"
		} else {
			op.T = "set"
			op.Data = e.Data
		}
		ops = append(ops, op)
	}
	return ops
}

func (d *Doc) LiveCount() int {
	d.mu.RLock()
	defer d.mu.RUnlock()
	n := 0
	for _, e := range d.entries {
		if !e.Deleted {
			n++
		}
	}
	return n
}

// CollectGarbage entfernt Grabsteine -- aber erst, wenn genug zusammengekommen
// sind, damit keine verspaetete Operation etwas wiederbeleben kann.
func (d *Doc) CollectGarbage(keep int) int {
	d.mu.Lock()
	defer d.mu.Unlock()
	dead := 0
	for _, e := range d.entries {
		if e.Deleted {
			dead++
		}
	}
	if dead < keep {
		return 0
	}
	for id, e := range d.entries {
		if e.Deleted {
			delete(d.entries, id)
		}
	}
	return dead
}

func sortEntries(es []Entry) {
	// Kleine Einfuegesortierung nach ID; die Mengen sind klein und so bleibt
	// die Datei ohne zusaetzliche Abhaengigkeit deterministisch.
	for i := 1; i < len(es); i++ {
		for j := i; j > 0 && es[j].ID < es[j-1].ID; j-- {
			es[j], es[j-1] = es[j-1], es[j]
		}
	}
}
