package main

// Impressum und Datenschutzerklaerung.
//
// Wer Blankr geschaeftlich anbietet, braucht beides (§ 5 DDG, Art. 13 DSGVO).
// Der Inhalt haengt am Betreiber und laesst sich deshalb nicht mitliefern --
// wohl aber ein Ort dafuer: Administratoren bearbeiten beide Texte in der
// Oberflaeche, gespeichert werden sie als Datei im Datenverzeichnis.
//
// Fuer die Datenschutzerklaerung gibt es eine Vorlage, die beschreibt, was
// Blankr tatsaechlich verarbeitet. Sie ersetzt keine Pruefung, aber sie ist
// zutreffend, solange niemand etwas an Blankr aendert.

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

var rechtlicheTexte = map[string]bool{"impressum": true, "datenschutz": true}

const maxRechtstext = 64 << 10

const datenschutzVorlage = `Datenschutzerklärung

Verantwortlich ist der im Impressum genannte Betreiber dieser Blankr-Instanz.

1. Welche Daten verarbeitet werden
- Konto: E-Mail-Adresse, Anzeigename, Rolle und ein Hash des Passworts (bcrypt). Das Passwort selbst wird nicht gespeichert.
- Sitzung: ein zufälliges Sitzungs-Token im Cookie „blankr_sitzung“. Auf dem Server liegt nur ein Hash davon. Das Cookie ist technisch notwendig (§ 25 Abs. 2 TDDDG) und wird nicht für Werbung oder Analyse genutzt.
- Inhalte: Boards mit allem, was darauf gezeichnet, geschrieben oder eingefügt wird, sowie Board-Name und Zeitstempel.
- Zusammenarbeit: Während einer Sitzung werden Anzeigename, Zeigerposition und Chatnachrichten an die anderen Teilnehmenden desselben Boards übertragen. Chatnachrichten werden nicht gespeichert.
- Protokoll: Methode, Pfad, Statuscode und Dauer jeder Anfrage. IP-Adressen und Adressparameter werden nicht protokolliert. Zur Abwehr von Missbrauch hält der Server IP-Adressen höchstens zehn Minuten im Arbeitsspeicher.
- Im Browser: Name, zuletzt benutztes Board und Darstellungseinstellungen im lokalen Speicher des Browsers.

2. Zweck und Rechtsgrundlage
Bereitstellung des Dienstes und Zusammenarbeit auf Boards (Art. 6 Abs. 1 lit. b DSGVO), Sicherheit des Dienstes (Art. 6 Abs. 1 lit. f DSGVO).

3. Empfänger
Keine Weitergabe an Dritte. Blankr lädt keine Schriften, Skripte oder Bilder von fremden Servern und setzt keine Analyse- oder Werbedienste ein.

4. Speicherdauer
Kontodaten bis zur Löschung des Kontos. Boards bis zu ihrer Löschung durch den Eigentümer. Sitzungen enden spätestens nach der eingestellten Laufzeit.

5. Deine Rechte
Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch (Art. 15–21 DSGVO). Unter „Konto“ kannst du deine Daten jederzeit als Datei herunterladen und dein Konto samt deiner Boards löschen. Du hast außerdem das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren.`

func (s *server) rechtsDatei(name string) string {
	return filepath.Join(s.cfg.daten, "rechtliches", name+".txt")
}

func (s *server) rechtstext(name string) (string, bool) {
	raw, err := os.ReadFile(s.rechtsDatei(name))
	if err == nil && strings.TrimSpace(string(raw)) != "" {
		return string(raw), true
	}
	if name == "datenschutz" {
		return datenschutzVorlage, false
	}
	return "", false
}

// rechtliches bedient GET /api/rechtliches/<name> fuer alle und PUT fuer
// Administratoren.
func (s *server) rechtliches(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/api/rechtliches/")
	if !rechtlicheTexte[name] {
		writeErr(w, http.StatusNotFound, "Unbekannter Text")
		return
	}
	switch r.Method {
	case http.MethodGet:
		text, eigen := s.rechtstext(name)
		writeJSON(w, http.StatusOK, map[string]any{"text": text, "eigen": eigen})

	case http.MethodPut:
		konto := s.konto(r)
		if konto == nil || konto.Rolle != RolleAdmin {
			writeErr(w, http.StatusForbidden, "Nur für Administratoren.")
			return
		}
		var body struct {
			Text string `json:"text"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, maxRechtstext)).Decode(&body) != nil {
			writeErr(w, http.StatusBadRequest, "Text nicht lesbar oder zu lang.")
			return
		}
		if err := os.MkdirAll(filepath.Dir(s.rechtsDatei(name)), 0o755); err != nil {
			writeErr(w, http.StatusInternalServerError, "Speichern fehlgeschlagen.")
			return
		}
		if err := writeAtomic(s.rechtsDatei(name), []byte(body.Text)); err != nil {
			writeErr(w, http.StatusInternalServerError, "Speichern fehlgeschlagen.")
			return
		}
		text, eigen := s.rechtstext(name)
		writeJSON(w, http.StatusOK, map[string]any{"text": text, "eigen": eigen})

	default:
		writeErr(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
	}
}
