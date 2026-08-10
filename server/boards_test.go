package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func neuerStore(t *testing.T) *Store {
	t.Helper()
	s, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("Store nicht anlegbar: %v", err)
	}
	return s
}

func TestBoardsAnlegenUmbenennenSortieren(t *testing.T) {
	s := neuerStore(t)

	a := s.Create("Sprint Planung")
	b := s.Create("Architektur")

	if meta, ok := s.Get(a.ID); !ok || meta.Name != "Sprint Planung" {
		t.Fatalf("Board a nicht wiedergefunden: %+v", meta)
	}

	// Nach Aktualisierungszeit absteigend
	s.Rename(a.ID, "Sprint Planung Q3")
	list := s.List()
	if len(list) != 2 {
		t.Fatalf("%d Boards, erwartet 2", len(list))
	}
	if list[0].ID != a.ID {
		t.Errorf("zuletzt geaendertes Board steht nicht vorn: %s", list[0].Name)
	}
	if _, ok := s.Get(b.ID); !ok {
		t.Error("Board b fehlt")
	}
}

func TestNameWirdBegrenztUndLeerErsetzt(t *testing.T) {
	s := neuerStore(t)

	leer := s.Create("   ")
	if leer.Name != "Neues Board" {
		t.Errorf("leerer Name wurde zu %q, erwartet \"Neues Board\"", leer.Name)
	}

	lang := s.Create(strings.Repeat("x", 200))
	if len([]rune(lang.Name)) != 80 {
		t.Errorf("Name hat %d Zeichen, erwartet 80", len([]rune(lang.Name)))
	}
}

func TestSchnappschussSchreibenUndLesen(t *testing.T) {
	s := neuerStore(t)
	board := s.Create("Speichertest")

	doc := NewDoc("a")
	doc.ApplyOp(Op{T: "set", ID: "s1", Kind: "stroke", Data: json.RawMessage(`{"v":1}`), Clock: 7, Site: "a"})

	if err := s.SaveSnapshot(board.ID, doc.Snapshot()); err != nil {
		t.Fatalf("Speichern fehlgeschlagen: %v", err)
	}

	wieder := NewDoc("b")
	wieder.Load(s.LoadSnapshot(board.ID))
	if wieder.LiveCount() != 1 {
		t.Errorf("%d lebende Eintraege nach dem Laden, erwartet 1", wieder.LiveCount())
	}
	if wieder.clock != 7 {
		t.Errorf("Uhr %d, erwartet 7", wieder.clock)
	}
}

func TestUnbekanntesBoardLiefertLeeresDokument(t *testing.T) {
	s := neuerStore(t)
	snap := s.LoadSnapshot("gibtsnicht")
	if len(snap.Entries) != 0 || snap.Clock != 0 {
		t.Errorf("erwartet leeres Dokument, bekommen %+v", snap)
	}
}

// Ohne die Bereinigung der ID koennte ein praeparierter Wert aus dem
// Datenverzeichnis herausfuehren und fremde Dateien ueberschreiben.
func TestBoardIDKannNichtAusdemVerzeichnisFuehren(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}

	if err := s.SaveSnapshot("../../etc/passwd", Snapshot{}); err != nil {
		t.Fatalf("Speichern fehlgeschlagen: %v", err)
	}

	eintraege, err := os.ReadDir(filepath.Join(dir, "boards"))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range eintraege {
		if !strings.HasSuffix(e.Name(), ".json") || strings.Contains(e.Name(), "/") {
			t.Errorf("verdaechtiger Dateiname: %s", e.Name())
		}
	}
	gefunden := false
	for _, e := range eintraege {
		if e.Name() == "etcpasswd.json" {
			gefunden = true
		}
	}
	if !gefunden {
		t.Error("Pfadanteile sollen entfernt, nicht befolgt werden")
	}
}

func TestLoeschenEntferntEintragUndDatei(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	board := s.Create("Wegwerf")
	s.SaveSnapshot(board.ID, Snapshot{})

	if !s.Remove(board.ID) {
		t.Fatal("Loeschen meldete false")
	}
	if _, ok := s.Get(board.ID); ok {
		t.Error("Board steht noch im Index")
	}
	if _, err := os.Stat(filepath.Join(dir, "boards", board.ID+".json")); !os.IsNotExist(err) {
		t.Error("Datei existiert noch")
	}
	if s.Remove(board.ID) {
		t.Error("zweites Loeschen sollte false melden")
	}
}

// Der Index muss einen Neustart ueberstehen -- genau das konnte die erste
// Fassung des Servers nicht, dort verschwand ein Raum mit dem letzten Nutzer.
func TestIndexUeberlebtNeustart(t *testing.T) {
	dir := t.TempDir()
	s1, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	board := s1.Create("Bleibt bestehen")

	s2, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	meta, ok := s2.Get(board.ID)
	if !ok {
		t.Fatal("Board nach dem Neustart verschwunden")
	}
	if meta.Name != "Bleibt bestehen" {
		t.Errorf("Name %q nach dem Neustart", meta.Name)
	}
}
