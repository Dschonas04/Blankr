package main

// Board-Ablage.
//
// Ein Board ist eine JSON-Datei mit dem CRDT-Schnappschuss, dazu ein Index mit
// Namen und Zeitstempeln. Bewusst keine Datenbank: die Datenmenge ist klein,
// und ein Verzeichnis mit lesbaren Dateien laesst sich sichern, kopieren und
// im Zweifel von Hand reparieren.
//
// Geschrieben wird immer erst in eine temporaere Datei und dann umbenannt.
// os.Rename ist auf einem POSIX-Dateisystem atomar -- ein Absturz mitten im
// Schreiben kann so kein halbes Board hinterlassen.

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

type BoardMeta struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
	Online    int    `json:"online"`
}

type Store struct {
	mu     sync.Mutex
	dir    string
	boards map[string]*BoardMeta
}

var unsafeID = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

func NewStore(dir string) (*Store, error) {
	s := &Store{dir: dir, boards: map[string]*BoardMeta{}}
	if err := os.MkdirAll(filepath.Join(dir, "boards"), 0o755); err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(s.indexFile())
	if err == nil {
		var idx struct {
			Boards []*BoardMeta `json:"boards"`
		}
		if json.Unmarshal(raw, &idx) == nil {
			for _, b := range idx.Boards {
				if b != nil && b.ID != "" {
					b.Online = 0
					s.boards[b.ID] = b
				}
			}
		}
	}
	return s, nil
}

func (s *Store) indexFile() string { return filepath.Join(s.dir, "index.json") }

// boardFile reduziert die ID auf unbedenkliche Zeichen. Ohne das koennte
// eine praeparierte ID aus dem Datenverzeichnis herausfuehren.
func (s *Store) boardFile(id string) string {
	return filepath.Join(s.dir, "boards", unsafeID.ReplaceAllString(id, "")+".json")
}

func writeAtomic(path string, data []byte) error {
	tmp := fmt.Sprintf("%s.%d.tmp", path, os.Getpid())
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (s *Store) persistIndex() {
	list := make([]*BoardMeta, 0, len(s.boards))
	for _, b := range s.boards {
		list = append(list, b)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].CreatedAt < list[j].CreatedAt })
	raw, err := json.MarshalIndent(struct {
		Boards []*BoardMeta `json:"boards"`
	}{list}, "", "  ")
	if err != nil {
		return
	}
	if err := writeAtomic(s.indexFile(), raw); err != nil {
		logf("Index konnte nicht geschrieben werden: %v", err)
	}
}

func (s *Store) List() []BoardMeta {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]BoardMeta, 0, len(s.boards))
	for _, b := range s.boards {
		out = append(out, *b)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt > out[j].UpdatedAt })
	return out
}

func (s *Store) Get(id string) (BoardMeta, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.boards[id]
	if !ok {
		return BoardMeta{}, false
	}
	return *b, true
}

func (s *Store) Create(name string) BoardMeta {
	s.mu.Lock()
	defer s.mu.Unlock()
	buf := make([]byte, 4)
	rand.Read(buf)
	now := time.Now().UnixMilli()
	b := &BoardMeta{ID: hex.EncodeToString(buf), Name: trim(name, 80), CreatedAt: now, UpdatedAt: now}
	s.boards[b.ID] = b
	s.persistIndex()
	return *b
}

func (s *Store) Rename(id, name string) (BoardMeta, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.boards[id]
	if !ok {
		return BoardMeta{}, false
	}
	b.Name = trim(name, 80)
	b.UpdatedAt = time.Now().UnixMilli()
	s.persistIndex()
	return *b, true
}

func (s *Store) Remove(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.boards[id]; !ok {
		return false
	}
	delete(s.boards, id)
	s.persistIndex()
	os.Remove(s.boardFile(id))
	return true
}

func (s *Store) LoadSnapshot(id string) Snapshot {
	raw, err := os.ReadFile(s.boardFile(id))
	if err != nil {
		return Snapshot{}
	}
	var snap Snapshot
	if json.Unmarshal(raw, &snap) != nil {
		return Snapshot{}
	}
	return snap
}

func (s *Store) SaveSnapshot(id string, snap Snapshot) error {
	raw, err := json.Marshal(snap)
	if err != nil {
		return err
	}
	if err := writeAtomic(s.boardFile(id), raw); err != nil {
		return err
	}
	s.mu.Lock()
	if b, ok := s.boards[id]; ok {
		b.UpdatedAt = time.Now().UnixMilli()
		s.persistIndex()
	}
	s.mu.Unlock()
	return nil
}

func trim(s string, max int) string {
	s = strings.TrimSpace(s)
	if s == "" {
		s = "Neues Board"
	}
	r := []rune(s)
	if len(r) > max {
		return string(r[:max])
	}
	return s
}
