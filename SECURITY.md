# Sicherheit

## Unterstützte Versionen

Sicherheitskorrekturen gibt es für die jeweils neueste Version 1.x.

## Lücke melden

Bitte **kein öffentliches Issue**. Meldungen per E-Mail an
200050623+Dschonas04@users.noreply.github.com mit Beschreibung, betroffener Version und – wenn möglich –
einem Weg, die Lücke nachzuvollziehen. Eine Eingangsbestätigung kommt innerhalb
von 72 Stunden, eine Einschätzung innerhalb von sieben Tagen.

## Sicherheitsmodell

| Bereich | Umsetzung |
|---|---|
| Passwörter | bcrypt (Kosten 10), mindestens 10 Zeichen; Anmeldung prüft gegen einen Attrappen-Hash, wenn es die Adresse nicht gibt (keine Kontoerkennung über die Antwortzeit) |
| Sitzungen | 32 Byte Zufall im Cookie `blankr_sitzung` (`HttpOnly`, `SameSite=Lax`, `Secure` hinter HTTPS); auf dem Server nur der SHA-256; Passwortänderung beendet alle anderen Sitzungen, Sperren alle |
| Ablage | `konten.json` und `sitzungen.json` mit Rechten `0600`, atomar geschrieben |
| Zugriff | Boards gehören einem Konto; fremde Boards antworten mit 404; Board-Kennungen gewähren keinen Zugang |
| Freigaben | 32 Byte Zufall je Link, getrennt für Bearbeiten und Ansehen; Zurückziehen trennt verbundene Gäste sofort; der Server verwirft Operationen von Betrachtern |
| CSRF | ändernde API-Anfragen nur mit `X-Requested-With: blankr`; kein CORS |
| WebSocket | Herkunft muss der Dienst selbst sein (oder in `BLANKR_HERKUENFTE` stehen) |
| Missbrauch | Anfragebremse je IP (API) sowie je IP und je E-Mail-Adresse (Anmeldung, Registrierung) |
| Browser | CSP `default-src 'self'` ohne fremde Quellen, `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` |
| Protokoll | ohne IP-Adressen und ohne Adressparameter (dort stehen Freigabe-Tokens) |
| Container | läuft als unprivilegierter Nutzer, Healthcheck auf `/healthz` |
