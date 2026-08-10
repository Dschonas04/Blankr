package main

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

type vectorCase struct {
	Name   string `json:"name"`
	Ops    []Op   `json:"ops"`
	Expect []struct {
		ID    string          `json:"id"`
		Clock int64           `json:"clock"`
		Site  string          `json:"site"`
		Data  json.RawMessage `json:"data"`
	} `json:"expect"`
}

type vectorFile struct {
	Cases []vectorCase `json:"cases"`
}

func loadVectors(t *testing.T) vectorFile {
	t.Helper()
	raw, err := os.ReadFile("../shared/testvectors.json")
	if err != nil {
		t.Fatalf("Testvektoren nicht lesbar: %v", err)
	}
	var vf vectorFile
	if err := json.Unmarshal(raw, &vf); err != nil {
		t.Fatalf("Testvektoren nicht auswertbar: %v", err)
	}
	if len(vf.Cases) == 0 {
		t.Fatal("keine Faelle in den Testvektoren")
	}
	return vf
}

// liveState liefert die lebenden Eintraege in stabiler Reihenfolge.
func liveState(d *Doc) []Entry {
	snap := d.Snapshot()
	out := []Entry{}
	for _, e := range snap.Entries {
		if !e.Deleted {
			out = append(out, e)
		}
	}
	return out
}

func normalize(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return string(raw)
	}
	return v
}

// TestVektoren prueft jeden Fall dreifach: in der angegebenen Reihenfolge,
// rueckwaerts und mit doppelt zugestellten Operationen. Faellt einer davon um,
// ist die Regel nicht mehr kommutativ oder nicht mehr idempotent -- und
// Client und Server wuerden auseinanderlaufen.
func TestVektoren(t *testing.T) {
	vf := loadVectors(t)

	for _, c := range vf.Cases {
		c := c
		t.Run(c.Name, func(t *testing.T) {
			reihenfolgen := map[string][]Op{
				"vorwaerts": c.Ops,
				"rueckwaerts": func() []Op {
					r := make([]Op, len(c.Ops))
					for i, op := range c.Ops {
						r[len(c.Ops)-1-i] = op
					}
					return r
				}(),
				"doppelt": append(append([]Op{}, c.Ops...), c.Ops...),
			}

			for name, ops := range reihenfolgen {
				d := NewDoc("test")
				d.ApplyOps(ops)
				got := liveState(d)

				if len(got) != len(c.Expect) {
					t.Fatalf("%s: %d lebende Eintraege, erwartet %d", name, len(got), len(c.Expect))
				}
				for i, want := range c.Expect {
					if got[i].ID != want.ID {
						t.Errorf("%s: Eintrag %d hat ID %q, erwartet %q", name, i, got[i].ID, want.ID)
					}
					if got[i].Clock != want.Clock {
						t.Errorf("%s: %s hat Uhr %d, erwartet %d", name, want.ID, got[i].Clock, want.Clock)
					}
					if got[i].Site != want.Site {
						t.Errorf("%s: %s hat Site %q, erwartet %q", name, want.ID, got[i].Site, want.Site)
					}
					if !reflect.DeepEqual(normalize(got[i].Data), normalize(want.Data)) {
						t.Errorf("%s: %s hat Daten %v, erwartet %v",
							name, want.ID, normalize(got[i].Data), normalize(want.Data))
					}
				}
			}
		})
	}
}

func TestSchnappschussRundlauf(t *testing.T) {
	d := NewDoc("a")
	d.ApplyOps([]Op{
		{T: "set", ID: "l1", Kind: "layer", Data: json.RawMessage(`{"name":"Ebene 1"}`), Clock: 1, Site: "a"},
		{T: "set", ID: "s1", Kind: "stroke", Data: json.RawMessage(`{"type":"pen"}`), Clock: 2, Site: "a"},
		{T: "del", ID: "s1", Kind: "stroke", Clock: 3, Site: "a"},
	})

	raw, err := json.Marshal(d.Snapshot())
	if err != nil {
		t.Fatalf("Schnappschuss nicht serialisierbar: %v", err)
	}
	var snap Snapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		t.Fatalf("Schnappschuss nicht lesbar: %v", err)
	}

	wieder := NewDoc("b")
	wieder.Load(snap)

	if wieder.LiveCount() != 1 {
		t.Errorf("%d lebende Eintraege nach dem Laden, erwartet 1", wieder.LiveCount())
	}
	// Der Grabstein muss mitkommen, sonst kaeme s1 beim naechsten Abgleich zurueck.
	if _, ok := wieder.entries["s1"]; !ok {
		t.Error("Grabstein von s1 fehlt nach dem Rundlauf")
	}
	if wieder.clock != d.clock {
		t.Errorf("Uhr %d nach dem Laden, erwartet %d", wieder.clock, d.clock)
	}
}

func TestSchnappschussIstStabil(t *testing.T) {
	d := NewDoc("a")
	for i, id := range []string{"z", "a", "m", "b"} {
		d.ApplyOp(Op{T: "set", ID: id, Kind: "stroke", Data: json.RawMessage(`{}`), Clock: int64(i + 1), Site: "a"})
	}
	// Zwei Schnappschuesse desselben Zustands muessen byteweise gleich sein,
	// sonst schreibt die Ablage bei jedem Speichern eine andere Datei.
	a, _ := json.Marshal(d.Snapshot())
	b, _ := json.Marshal(d.Snapshot())
	if string(a) != string(b) {
		t.Errorf("Schnappschuss nicht stabil:\n%s\n%s", a, b)
	}
}

func TestGrabsteineWerdenErstSpaeterGeraeumt(t *testing.T) {
	d := NewDoc("a")
	d.ApplyOps([]Op{
		{T: "set", ID: "s1", Kind: "stroke", Data: json.RawMessage(`{}`), Clock: 1, Site: "a"},
		{T: "del", ID: "s1", Kind: "stroke", Clock: 2, Site: "a"},
	})
	if n := d.CollectGarbage(5000); n != 0 {
		t.Errorf("%d Grabsteine geraeumt, erwartet 0 unterhalb der Schwelle", n)
	}
	if n := d.CollectGarbage(1); n != 1 {
		t.Errorf("%d Grabsteine geraeumt, erwartet 1 ab der Schwelle", n)
	}
}

func TestNurEchteAenderungenMelden(t *testing.T) {
	d := NewDoc("a")
	op := Op{T: "set", ID: "x", Kind: "stroke", Data: json.RawMessage(`{"v":1}`), Clock: 5, Site: "a"}

	if !d.ApplyOp(op) {
		t.Error("erste Operation haette eine Aenderung sein muessen")
	}
	if d.ApplyOp(op) {
		t.Error("dieselbe Operation nochmal darf keine Aenderung melden")
	}
	alt := Op{T: "set", ID: "x", Kind: "stroke", Data: json.RawMessage(`{"v":0}`), Clock: 2, Site: "a"}
	if d.ApplyOp(alt) {
		t.Error("verspaetete Operation darf keine Aenderung melden")
	}
}
