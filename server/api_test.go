package main

// Tests fuer Konten, Zugriffsschutz und Freigaben -- gegen den vollstaendigen
// Handler mit Schutzschicht, so wie ein Browser ihn sieht.

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type testClient struct {
	t    *testing.T
	base string
	http *http.Client
}

func testServer(t *testing.T, anpassen func(*config)) (*server, *httptest.Server) {
	t.Helper()
	cfg := config{daten: t.TempDir(), static: t.TempDir(), gaeste: true, sitzungTage: 14}
	if anpassen != nil {
		anpassen(&cfg)
	}
	s, err := neuerServer(cfg)
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(s.routen())
	t.Cleanup(ts.Close)
	return s, ts
}

func neuerClient(t *testing.T, ts *httptest.Server) *testClient {
	jar, _ := cookiejar.New(nil)
	return &testClient{t: t, base: ts.URL, http: &http.Client{Jar: jar}}
}

func (c *testClient) anfrage(methode, pfad string, body any, mitKennung bool) (int, map[string]any) {
	c.t.Helper()
	var rumpf *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rumpf = bytes.NewReader(raw)
	} else {
		rumpf = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(methode, c.base+pfad, rumpf)
	req.Header.Set("Content-Type", "application/json")
	if mitKennung {
		req.Header.Set(csrfKopf, "blankr")
	}
	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	raw := new(bytes.Buffer)
	raw.ReadFrom(res.Body)
	if strings.HasPrefix(strings.TrimSpace(raw.String()), "{") {
		json.Unmarshal(raw.Bytes(), &out)
	}
	return res.StatusCode, out
}

func (c *testClient) liste(pfad string) (int, []map[string]any) {
	c.t.Helper()
	req, _ := http.NewRequest(http.MethodGet, c.base+pfad, nil)
	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	var out []map[string]any
	json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func (c *testClient) registrieren(email, passwort string) int {
	code, _ := c.anfrage("POST", "/api/registrierung", map[string]string{"email": email, "name": "", "passwort": passwort}, true)
	return code
}

func TestErstesKontoWirdAdminUndUebernimmtAlteBoards(t *testing.T) {
	s, ts := testServer(t, nil)
	alt := s.store.Create("Aus der Zeit vor den Konten", "")

	a := neuerClient(t, ts)
	if code := a.registrieren("chefin@example.org", "sehr-geheim-1"); code != http.StatusCreated {
		t.Fatalf("Einrichtung: %d", code)
	}
	_, status := a.anfrage("GET", "/api/status", nil, false)
	konto, _ := status["konto"].(map[string]any)
	if konto["rolle"] != RolleAdmin {
		t.Fatalf("erstes Konto ist %v, erwartet admin", konto["rolle"])
	}
	if b, _ := s.store.Get(alt.ID); b.Owner != konto["id"] {
		t.Errorf("altes Board gehoert %q, erwartet dem ersten Konto", b.Owner)
	}
}

func TestRegistrierungIstNachDemErstenKontoGeschlossen(t *testing.T) {
	_, ts := testServer(t, nil)
	neuerClient(t, ts).registrieren("chefin@example.org", "sehr-geheim-1")
	if code := neuerClient(t, ts).registrieren("fremd@example.org", "sehr-geheim-2"); code != http.StatusForbidden {
		t.Errorf("zweite Registrierung: %d, erwartet 403", code)
	}
}

func TestOffeneRegistrierungLegtNutzerAn(t *testing.T) {
	_, ts := testServer(t, func(c *config) { c.registrierungOffen = true })
	neuerClient(t, ts).registrieren("chefin@example.org", "sehr-geheim-1")
	b := neuerClient(t, ts)
	if code := b.registrieren("mitarbeiter@example.org", "sehr-geheim-2"); code != http.StatusCreated {
		t.Fatalf("Registrierung: %d", code)
	}
	_, status := b.anfrage("GET", "/api/status", nil, false)
	if konto := status["konto"].(map[string]any); konto["rolle"] != RolleNutzer {
		t.Errorf("zweites Konto ist %v, erwartet nutzer", konto["rolle"])
	}
}

func TestAnmeldungUndFalschesPasswort(t *testing.T) {
	_, ts := testServer(t, nil)
	neuerClient(t, ts).registrieren("chefin@example.org", "sehr-geheim-1")

	c := neuerClient(t, ts)
	if code, _ := c.anfrage("POST", "/api/anmeldung", map[string]string{"email": "chefin@example.org", "passwort": "falsch-falsch"}, true); code != http.StatusUnauthorized {
		t.Errorf("falsches Passwort: %d, erwartet 401", code)
	}
	if code, _ := c.anfrage("POST", "/api/anmeldung", map[string]string{"email": "CHEFIN@example.org ", "passwort": "sehr-geheim-1"}, true); code != http.StatusOK {
		t.Errorf("Anmeldung: %d, erwartet 200", code)
	}
	if code, _ := c.liste("/api/boards"); code != http.StatusOK {
		t.Errorf("Boardliste nach Anmeldung: %d", code)
	}
	c.anfrage("POST", "/api/abmeldung", nil, true)
	if code, _ := c.liste("/api/boards"); code != http.StatusUnauthorized {
		t.Errorf("Boardliste nach Abmeldung: %d, erwartet 401", code)
	}
}

func TestOhneAnmeldungKeineBoards(t *testing.T) {
	s, ts := testServer(t, nil)
	s.store.Create("geheim", "irgendwer")
	c := neuerClient(t, ts)
	if code, _ := c.liste("/api/boards"); code != http.StatusUnauthorized {
		t.Errorf("GET /api/boards ohne Anmeldung: %d, erwartet 401", code)
	}
}

func TestKontenSehenNurIhreBoards(t *testing.T) {
	s, ts := testServer(t, func(c *config) { c.registrierungOffen = true })
	admin := neuerClient(t, ts)
	admin.registrieren("chefin@example.org", "sehr-geheim-1")
	a := neuerClient(t, ts)
	a.registrieren("anna@example.org", "sehr-geheim-2")
	b := neuerClient(t, ts)
	b.registrieren("bert@example.org", "sehr-geheim-3")

	_, board := a.anfrage("POST", "/api/boards", map[string]string{"name": "Annas Board"}, true)
	id := board["id"].(string)

	if _, liste := b.liste("/api/boards"); len(liste) != 0 {
		t.Errorf("Bert sieht %d fremde Boards", len(liste))
	}
	if code, _ := b.anfrage("DELETE", "/api/boards/"+id, nil, true); code != http.StatusNotFound {
		t.Errorf("Bert loescht Annas Board: %d, erwartet 404", code)
	}
	if code, _ := b.anfrage("PATCH", "/api/boards/"+id, map[string]string{"name": "übernommen"}, true); code != http.StatusNotFound {
		t.Errorf("Bert benennt Annas Board um: %d, erwartet 404", code)
	}
	if _, liste := admin.liste("/api/boards"); len(liste) != 1 || liste[0]["besitzer"] != "anna" {
		t.Errorf("Administratorin sieht %v", liste)
	}
	if _, ok := s.store.Get(id); !ok {
		t.Error("Board ist verschwunden")
	}
}

func TestAendernOhneKennungWirdAbgelehnt(t *testing.T) {
	_, ts := testServer(t, nil)
	c := neuerClient(t, ts)
	c.registrieren("chefin@example.org", "sehr-geheim-1")
	if code, _ := c.anfrage("POST", "/api/boards", map[string]string{"name": "x"}, false); code != http.StatusForbidden {
		t.Errorf("POST ohne X-Requested-With: %d, erwartet 403", code)
	}
}

func TestSicherheitsKoepfe(t *testing.T) {
	_, ts := testServer(t, nil)
	res, err := http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	for _, kopf := range []string{"Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"} {
		if res.Header.Get(kopf) == "" {
			t.Errorf("Kopf %s fehlt", kopf)
		}
	}
}

func wsVerbinden(t *testing.T, ts *httptest.Server, c *testClient, query string) (*websocket.Conn, map[string]any, int) {
	t.Helper()
	u, _ := url.Parse(ts.URL)
	dialer := websocket.Dialer{Jar: c.http.Jar, HandshakeTimeout: 5 * time.Second}
	conn, res, err := dialer.Dial("ws://"+u.Host+"/ws?"+query, nil)
	if err != nil {
		code := 0
		if res != nil {
			code = res.StatusCode
		}
		return nil, nil, code
	}
	var init map[string]any
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if err := conn.ReadJSON(&init); err != nil {
		t.Fatal(err)
	}
	return conn, init, http.StatusSwitchingProtocols
}

func TestFreigabeLinksUndNurAnsehen(t *testing.T) {
	s, ts := testServer(t, nil)
	eigen := neuerClient(t, ts)
	eigen.registrieren("chefin@example.org", "sehr-geheim-1")
	_, board := eigen.anfrage("POST", "/api/boards", map[string]string{"name": "Workshop"}, true)
	id := board["id"].(string)

	// Ohne Link kommt ein Gast nicht hinein, auch nicht mit der Kennung.
	gast := neuerClient(t, ts)
	if _, _, code := wsVerbinden(t, ts, gast, "board="+id); code != http.StatusUnauthorized {
		t.Errorf("Gast mit Board-Kennung: %d, erwartet 401", code)
	}

	_, mitLinks := eigen.anfrage("POST", "/api/boards/"+id+"/freigabe", map[string]string{"rolle": FreigabeAnsehen}, true)
	ansehen := mitLinks["viewToken"].(string)
	if len(ansehen) < 32 {
		t.Fatalf("Link zu kurz: %q", ansehen)
	}

	conn, init, code := wsVerbinden(t, ts, gast, "freigabe="+ansehen+"&name=Gast")
	if code != http.StatusSwitchingProtocols {
		t.Fatalf("Gast mit Ansehen-Link: %d", code)
	}
	defer conn.Close()
	if init["rolle"] != FreigabeAnsehen {
		t.Errorf("Rolle %v, erwartet ansehen", init["rolle"])
	}

	// Operationen eines Betrachters aendern nichts am Board.
	conn.WriteJSON(map[string]any{"type": "ops", "ops": []Op{{T: "set", ID: "x1", Kind: "stroke", Data: json.RawMessage(`{"v":1}`), Clock: 1, Site: "g"}}})
	time.Sleep(200 * time.Millisecond)
	s.hub.mu.Lock()
	offen := s.hub.boards[id]
	s.hub.mu.Unlock()
	if offen == nil || offen.doc.LiveCount() != 0 {
		t.Errorf("Betrachter hat das Board veraendert")
	}

	// Zurueckziehen trennt die Verbindung und macht den Link ungueltig.
	eigen.anfrage("DELETE", "/api/boards/"+id+"/freigabe?rolle="+FreigabeAnsehen, nil, true)
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
	if code, _ := gast.anfrage("GET", "/api/beitritt/"+ansehen, nil, false); code != http.StatusNotFound {
		t.Errorf("zurueckgezogener Link: %d, erwartet 404", code)
	}
}

func TestGaesteGesperrtVerlangtAnmeldung(t *testing.T) {
	_, ts := testServer(t, func(c *config) { c.gaeste = false })
	eigen := neuerClient(t, ts)
	eigen.registrieren("chefin@example.org", "sehr-geheim-1")
	_, board := eigen.anfrage("POST", "/api/boards", map[string]string{"name": "intern"}, true)
	_, mitLinks := eigen.anfrage("POST", "/api/boards/"+board["id"].(string)+"/freigabe", map[string]string{"rolle": FreigabeBearbeiten}, true)
	if code, _ := neuerClient(t, ts).anfrage("GET", "/api/beitritt/"+mitLinks["editToken"].(string), nil, false); code != http.StatusUnauthorized {
		t.Errorf("Gast bei gesperrten Gaesten: %d, erwartet 401", code)
	}
}

func TestKontoLoeschenEntferntBoardsUndVerlangtPasswort(t *testing.T) {
	s, ts := testServer(t, func(c *config) { c.registrierungOffen = true })
	neuerClient(t, ts).registrieren("chefin@example.org", "sehr-geheim-1")
	a := neuerClient(t, ts)
	a.registrieren("anna@example.org", "sehr-geheim-2")
	_, board := a.anfrage("POST", "/api/boards", map[string]string{"name": "weg damit"}, true)

	if code, _ := a.anfrage("DELETE", "/api/konto", map[string]string{"passwort": "falsch-falsch"}, true); code != http.StatusForbidden {
		t.Errorf("Loeschen mit falschem Passwort: %d, erwartet 403", code)
	}
	if code, _ := a.anfrage("DELETE", "/api/konto", map[string]string{"passwort": "sehr-geheim-2"}, true); code != http.StatusNoContent {
		t.Fatalf("Loeschen: %d", code)
	}
	if _, ok := s.store.Get(board["id"].(string)); ok {
		t.Error("Board des geloeschten Kontos existiert noch")
	}
	if code, _ := a.anfrage("POST", "/api/anmeldung", map[string]string{"email": "anna@example.org", "passwort": "sehr-geheim-2"}, true); code != http.StatusUnauthorized {
		t.Errorf("Anmeldung nach Loeschen: %d, erwartet 401", code)
	}
}

func TestLetzterAdminBleibt(t *testing.T) {
	_, ts := testServer(t, func(c *config) { c.registrierungOffen = true })
	admin := neuerClient(t, ts)
	admin.registrieren("chefin@example.org", "sehr-geheim-1")
	neuerClient(t, ts).registrieren("anna@example.org", "sehr-geheim-2")
	if code, _ := admin.anfrage("DELETE", "/api/konto", map[string]string{"passwort": "sehr-geheim-1"}, true); code != http.StatusConflict {
		t.Errorf("letzte Administratorin loescht sich: %d, erwartet 409", code)
	}
}

func TestDatenexportEnthaeltEigeneBoards(t *testing.T) {
	_, ts := testServer(t, nil)
	c := neuerClient(t, ts)
	c.registrieren("chefin@example.org", "sehr-geheim-1")
	c.anfrage("POST", "/api/boards", map[string]string{"name": "Export"}, true)
	code, export := c.anfrage("GET", "/api/konto/export", nil, false)
	if code != http.StatusOK {
		t.Fatalf("Export: %d", code)
	}
	boards, _ := export["boards"].([]any)
	if len(boards) != 1 {
		t.Errorf("%d Boards im Export, erwartet 1", len(boards))
	}
	if konto, _ := export["konto"].(map[string]any); konto["email"] != "chefin@example.org" {
		t.Errorf("Konto im Export: %v", konto)
	}
}

func TestPasswortRegeln(t *testing.T) {
	_, ts := testServer(t, nil)
	if code := neuerClient(t, ts).registrieren("chefin@example.org", "kurz"); code != http.StatusBadRequest {
		t.Errorf("zu kurzes Passwort: %d, erwartet 400", code)
	}
	if code := neuerClient(t, ts).registrieren("keine-adresse", "sehr-geheim-1"); code != http.StatusBadRequest {
		t.Errorf("ungueltige Adresse: %d, erwartet 400", code)
	}
}
