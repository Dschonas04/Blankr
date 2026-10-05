# Änderungen

## Unveröffentlicht

## 1.0.0 – 2026-09-17

Erste Version für den geschäftlichen Einsatz.

### Neu
- **Konten**: Einrichtung (erstes Konto wird Administrator), Anmeldung,
  Registrierung (standardmäßig geschlossen), Passwortänderung, Sperren,
  Rollen Administrator/Nutzer.
- **Eigentum an Boards**: Jeder sieht nur eigene Boards, Administratoren alle.
- **Freigabe-Links** zum Bearbeiten und zum Ansehen, einzeln zurückziehbar;
  Betrachter können nichts ändern.
- **Verwaltung**: Konten anlegen, sperren, Passwort setzen, löschen (Boards
  gehen an den Administrator über); Datensicherung als `tar.gz`.
- **Datenschutz**: Impressum und Datenschutzerklärung (mit Vorlage) in der
  Oberfläche pflegbar und überall verlinkt; Export aller eigenen Daten;
  Konto samt Boards löschen.
- **Sicherheit**: Content-Security-Policy und weitere Sicherheits-Header,
  CSRF-Schutz, Prüfung der WebSocket-Herkunft, Anfragebremse, bcrypt,
  gehashte Sitzungen.
- **Betrieb**: Einstellungen über Umgebungsvariablen, Prometheus-Metriken
  (`BLANKR_METRIKEN=ja`), Versionsangabe unter `/healthz`, Protokoll ohne
  personenbezogene Daten.

### Geändert
- Keine Schrift mehr von Google Fonts; die Oberfläche nutzt Systemschriften.
- Ein Board mit verbundenen Teilnehmern lässt sich löschen; alle werden getrennt.

### Migration von 0.x
- Beim ersten Aufruf nach dem Update richtet jemand das erste Konto ein; alle
  bestehenden Boards gehören danach diesem Konto.
- Alte Links mit `?board=` oder `?room=` geben keinen Zugang mehr. Der
  Eigentümer stellt unter *Teilen* neue Links aus.
