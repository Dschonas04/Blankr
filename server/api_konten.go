package main

// HTTP-Schnittstelle fuer Konten: Einrichtung, Anmeldung, das eigene Konto
// und die Verwaltung durch Administratoren.

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

const sitzungsCookie = "blankr_sitzung"

// konto liest die Sitzung aus dem Cookie. nil heisst: nicht angemeldet.
func (s *server) konto(r *http.Request) *Konto {
	c, err := r.Cookie(sitzungsCookie)
	if err != nil {
		return nil
	}
	k, ok := s.konten.SitzungKonto(c.Value)
	if !ok {
		return nil
	}
	return k
}

func (s *server) setzeCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sitzungsCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   s.istHTTPS(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   s.cfg.sitzungTage * 24 * 3600,
	})
}

func (s *server) loescheCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: sitzungsCookie, Value: "", Path: "/", HttpOnly: true,
		Secure: s.istHTTPS(r), SameSite: http.SameSiteLaxMode, MaxAge: -1,
	})
}

func (s *server) nurMitKonto(h func(http.ResponseWriter, *http.Request, *Konto)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		k := s.konto(r)
		if k == nil {
			writeErr(w, http.StatusUnauthorized, "Bitte melde dich an.")
			return
		}
		h(w, r, k)
	}
}

func (s *server) nurAdmin(h any) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		k := s.konto(r)
		if k == nil {
			writeErr(w, http.StatusUnauthorized, "Bitte melde dich an.")
			return
		}
		if k.Rolle != RolleAdmin {
			writeErr(w, http.StatusForbidden, "Nur für Administratoren.")
			return
		}
		switch f := h.(type) {
		case func(http.ResponseWriter, *http.Request, *Konto):
			f(w, r, k)
		case func(http.ResponseWriter, *http.Request):
			f(w, r)
		}
	}
}

func lies(w http.ResponseWriter, r *http.Request, ziel any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(ziel); err != nil {
		writeErr(w, http.StatusBadRequest, "Anfrage nicht lesbar")
		return false
	}
	return true
}

// status ist der erste Aufruf der Oberflaeche: Muss eingerichtet werden, ist
// jemand angemeldet, was darf man?
func (s *server) status(w http.ResponseWriter, r *http.Request) {
	anzahl := s.konten.Anzahl()
	_, impressum := s.rechtstext("impressum")
	antwort := map[string]any{
		"version":       version,
		"einrichtung":   anzahl == 0,
		"registrierung": anzahl == 0 || s.cfg.registrierungOffen,
		"gaeste":        s.cfg.gaeste,
		"impressum":     impressum,
	}
	if k := s.konto(r); k != nil {
		antwort["konto"] = k.Sicht()
	}
	writeJSON(w, http.StatusOK, antwort)
}

func (s *server) registrierung(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
		return
	}
	if !s.anmeldeBremse.Erlaubt("reg:" + s.clientIP(r)) {
		writeErr(w, http.StatusTooManyRequests, "Zu viele Versuche. Bitte warte eine Minute.")
		return
	}
	erstes := s.konten.Anzahl() == 0
	if !erstes && !s.cfg.registrierungOffen {
		writeErr(w, http.StatusForbidden, "Die Registrierung ist geschlossen. Konten legt ein Administrator an.")
		return
	}
	var body struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Passwort string `json:"passwort"`
	}
	if !lies(w, r, &body) {
		return
	}
	k, err := s.konten.Anlegen(body.Email, body.Name, body.Passwort, RolleNutzer)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if k.Rolle == RolleAdmin {
		if n := s.store.WaisenZuordnen(k.ID); n > 0 {
			logf("%d Board(s) ohne Eigentuemer dem ersten Administrator zugeordnet", n)
		}
	}
	s.setzeCookie(w, r, s.konten.SitzungAnlegen(k.ID))
	writeJSON(w, http.StatusCreated, k.Sicht())
}

func (s *server) anmeldung(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
		return
	}
	var body struct {
		Email    string `json:"email"`
		Passwort string `json:"passwort"`
	}
	if !lies(w, r, &body) {
		return
	}
	// Zwei Eimer: je IP und je E-Mail-Adresse. Der zweite haelt verteiltes
	// Raten gegen ein einzelnes Konto auf.
	if !s.anmeldeBremse.Erlaubt("ip:"+s.clientIP(r)) ||
		!s.anmeldeBremse.Erlaubt("mail:"+strings.ToLower(strings.TrimSpace(body.Email))) {
		writeErr(w, http.StatusTooManyRequests, "Zu viele Anmeldeversuche. Bitte warte eine Minute.")
		return
	}
	k, err := s.konten.Pruefen(body.Email, body.Passwort)
	if err != nil {
		code := http.StatusUnauthorized
		if errors.Is(err, ErrKontoGesperrt) {
			code = http.StatusForbidden
		}
		writeErr(w, code, err.Error())
		return
	}
	s.setzeCookie(w, r, s.konten.SitzungAnlegen(k.ID))
	writeJSON(w, http.StatusOK, k.Sicht())
}

func (s *server) abmeldung(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
		return
	}
	if c, err := r.Cookie(sitzungsCookie); err == nil {
		s.konten.SitzungBeenden(c.Value)
	}
	s.loescheCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) kontoAPI(w http.ResponseWriter, r *http.Request, k *Konto) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, k.Sicht())

	case http.MethodPatch:
		var body struct {
			Name string `json:"name"`
		}
		if !lies(w, r, &body) {
			return
		}
		neu, err := s.konten.NameSetzen(k.ID, body.Name)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, neu.Sicht())

	case http.MethodDelete:
		// Loeschen verlangt das Passwort: eine offen gelassene Sitzung am
		// fremden Rechner soll nicht reichen, um alles zu vernichten.
		var body struct {
			Passwort string `json:"passwort"`
		}
		if !lies(w, r, &body) {
			return
		}
		if _, err := s.konten.Pruefen(k.Email, body.Passwort); err != nil {
			writeErr(w, http.StatusForbidden, "Das Passwort stimmt nicht.")
			return
		}
		if err := s.konten.Loeschen(k.ID); err != nil {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		for _, b := range s.store.VonKonto(k.ID) {
			s.boardLoeschen(b.ID)
		}
		s.loescheCookie(w, r)
		w.WriteHeader(http.StatusNoContent)

	default:
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
	}
}

func (s *server) kontoPasswort(w http.ResponseWriter, r *http.Request, k *Konto) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
		return
	}
	var body struct {
		Alt string `json:"alt"`
		Neu string `json:"neu"`
	}
	if !lies(w, r, &body) {
		return
	}
	behalte := ""
	if c, err := r.Cookie(sitzungsCookie); err == nil {
		behalte = c.Value
	}
	if err := s.konten.PasswortAendern(k.ID, body.Alt, body.Neu, behalte); err != nil {
		code := http.StatusBadRequest
		if errors.Is(err, ErrPasswortFalsch) {
			code = http.StatusForbidden
		}
		writeErr(w, code, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// kontoExport liefert alle Daten eines Kontos als Datei (Art. 15 und 20
// DSGVO): die Kontoangaben und jedes eigene Board samt Inhalt.
func (s *server) kontoExport(w http.ResponseWriter, r *http.Request, k *Konto) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
		return
	}
	s.hub.flushAll()
	type exportBoard struct {
		Name      string   `json:"name"`
		CreatedAt int64    `json:"createdAt"`
		UpdatedAt int64    `json:"updatedAt"`
		Inhalt    Snapshot `json:"inhalt"`
	}
	boards := []exportBoard{}
	for _, b := range s.store.VonKonto(k.ID) {
		boards = append(boards, exportBoard{Name: b.Name, CreatedAt: b.CreatedAt, UpdatedAt: b.UpdatedAt, Inhalt: s.store.LoadSnapshot(b.ID)})
	}
	w.Header().Set("Content-Disposition", `attachment; filename="blankr-meine-daten-`+time.Now().Format("2006-01-02")+`.json"`)
	writeJSON(w, http.StatusOK, map[string]any{
		"exportiert": time.Now().Format(time.RFC3339),
		"konto": map[string]any{
			"email": k.Email, "name": k.Name, "rolle": k.Rolle, "angelegt": time.UnixMilli(k.Angelegt).Format(time.RFC3339),
		},
		"boards": boards,
	})
}

type adminKontoSicht struct {
	KontoSicht
	Boards int `json:"boards"`
}

func (s *server) adminKonten(w http.ResponseWriter, r *http.Request, k *Konto) {
	switch r.Method {
	case http.MethodGet:
		zaehler := map[string]int{}
		for _, b := range s.store.List() {
			zaehler[b.Owner]++
		}
		out := []adminKontoSicht{}
		for _, konto := range s.konten.Liste() {
			out = append(out, adminKontoSicht{KontoSicht: konto, Boards: zaehler[konto.ID]})
		}
		writeJSON(w, http.StatusOK, out)

	case http.MethodPost:
		var body struct {
			Email    string `json:"email"`
			Name     string `json:"name"`
			Passwort string `json:"passwort"`
			Rolle    string `json:"rolle"`
		}
		if !lies(w, r, &body) {
			return
		}
		if body.Rolle == "" {
			body.Rolle = RolleNutzer
		}
		neu, err := s.konten.Anlegen(body.Email, body.Name, body.Passwort, body.Rolle)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, neu.Sicht())

	default:
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
	}
}

func (s *server) adminKonto(w http.ResponseWriter, r *http.Request, k *Konto) {
	id := strings.TrimPrefix(r.URL.Path, "/api/admin/konten/")
	ziel, ok := s.konten.Konto(id)
	if id == "" || !ok {
		writeErr(w, http.StatusNotFound, "Konto unbekannt")
		return
	}
	switch r.Method {
	case http.MethodPatch:
		var body struct {
			Rolle    *string `json:"rolle"`
			Gesperrt *bool   `json:"gesperrt"`
			Passwort string  `json:"passwort"`
		}
		if !lies(w, r, &body) {
			return
		}
		if body.Passwort != "" {
			if err := s.konten.PasswortSetzen(id, body.Passwort); err != nil {
				writeErr(w, http.StatusBadRequest, err.Error())
				return
			}
		}
		if body.Rolle != nil || body.Gesperrt != nil {
			if _, err := s.konten.Aendern(id, body.Rolle, body.Gesperrt); err != nil {
				writeErr(w, http.StatusConflict, err.Error())
				return
			}
			if body.Gesperrt != nil && *body.Gesperrt {
				// Laufende Verbindungen eines gesperrten Kontos gehen nicht
				// ueber die Sitzung, sie muessen eigens getrennt werden: alle
				// seine Boards werden fuer Nicht-Gaeste geschlossen.
				for _, b := range s.store.VonKonto(id) {
					s.hub.trennen(b.ID, func(c *client) bool { return c.freigabe == "" })
				}
			}
		}
		neu, _ := s.konten.Konto(id)
		writeJSON(w, http.StatusOK, neu.Sicht())

	case http.MethodDelete:
		if id == k.ID {
			writeErr(w, http.StatusConflict, "Das eigene Konto löschst du unter „Konto“.")
			return
		}
		// Boards gehen standardmaessig an den loeschenden Administrator, damit
		// die Arbeit eines ausscheidenden Mitarbeiters nicht verschwindet.
		// ?boards=loeschen entfernt sie stattdessen.
		loeschen := r.URL.Query().Get("boards") == "loeschen"
		if err := s.konten.Loeschen(id); err != nil {
			writeErr(w, http.StatusConflict, err.Error())
			return
		}
		if loeschen {
			for _, b := range s.store.VonKonto(ziel.ID) {
				s.boardLoeschen(b.ID)
			}
		} else {
			s.store.Uebertragen(ziel.ID, k.ID)
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
	}
}
