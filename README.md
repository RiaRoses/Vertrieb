# Vertrieb · Dein Notion-Workspace

Privater Vertriebs-Workspace mit deutscher Oberfläche: Kontakte und Prospects, Pipeline, Aufgaben, Kontaktportfolio und ein KI-Assistent. Die tatsächlichen Daten kommen aus deinen freigegebenen Notion-Datenbanken. Ohne Verbindung zeigt die Anwendung ausdrücklich markierte Beispieldaten.

## Starten

Voraussetzung: Node.js 22 oder neuer (getestet mit Node.js 24), npm und Internetzugang zu `registry.npmjs.org`, `api.notion.com` und `api.openai.com`.

```sh
npm ci
npm run dev
```

Die Anwendung läuft lokal auf Port 3000. Für den Produktionsbetrieb:

```sh
npm run build
npm start
```

Der Server liefert Frontend und API gemeinsam aus. Er bindet standardmäßig nur an `127.0.0.1`. Variablen können beim Start gesetzt werden, zum Beispiel `PORT=4000 npm start`. `.env.example` dokumentiert die Optionen; `.env` wird nicht automatisch eingelesen. Alternativ unterstützt Node `--env-file` oder ein Prozessmanager die Übergabe.

## Notion verbinden

1. Unter [Notion Integrationen](https://www.notion.so/profile/integrations) eine interne Integration für deinen Workspace anlegen. Lesen, Einfügen und Aktualisieren von Inhalten erlauben.
2. Die vorhandenen Original-Datenbanken in Notion über das Seitenmenü → Verbindungen mit der Integration teilen. Bei verknüpften Ansichten muss auch die zugrunde liegende Datenbank freigegeben sein.
3. In der App **Notion verbinden** öffnen und das Integration-Token eingeben. Es wird serverseitig geprüft.
4. Die Datenquellen den Rollen **Leads**, **Prospects** und **Aufgaben** zuordnen. Nicht benötigte Rollen leer lassen. Jede Quelle kann einmal zugeordnet werden.
5. Die vorhandenen Felder auswählen. Der Titel wird automatisch erkannt. Unterstützt sind Status/Select/Checkbox, Unternehmen als Text, Deal-Wert als Zahl, Fälligkeit als Datum, E-Mail, Telefon und Kontaktverknüpfungen als Relation. Optionale Felder dürfen leer bleiben.
6. Bei einer gemeinsamen CRM-Datenbank nur **Leads** zuordnen und die Statuswerte auswählen, die als **Prospects** erscheinen sollen. Bei Aufgaben mit Status/Select ausdrücklich die erledigten Statuswerte markieren. Checkboxen werden direkt erkannt.
7. **Zuordnung speichern**. Nach Änderungen direkt in Notion die Daten über das Aktualisieren-Symbol erneut abrufen. Es gibt keinen Hintergrund-Sync und keine Webhooks.

Die App verändert keine Datenbankschemata. Statuswerte müssen bereits in Notion existieren. Jede Quelle wird paginiert bis maximal 5.000 Einträge gelesen; größere Quellen führen zu einer erklärenden Meldung statt unvollständigen Kennzahlen. Die Pipeline zeigt alle zugeordneten Kontaktstatus; der Pipeline-Wert ist die Summe aller zugeordneten Kontaktwerte, ohne Umsatz- oder Abschlussprognose. Die Währung der Darstellung ist EUR.

## Mit dem Agenten arbeiten

In den Einstellungen einen eigenen [OpenAI API-Schlüssel](https://platform.openai.com/api-keys) und ein Responses-API-kompatibles Modell mit Function Calling hinterlegen. Standard: `gpt-4.1-mini`; das Konto benötigt Zugriff auf das gewählte Modell und ausreichendes API-Guthaben.

Beispiele:

- „Welche Kontakte sollte ich heute nachfassen?“
- „Erstelle für Mara eine Follow-up-Aufgabe für kommenden Montag.“
- „Setze die Aufgabe Angebotsversand auf Erledigt.“
- „Ändere den Status von Studio Nord auf Angebot.“

Der Agent erhält deine Nachricht, die letzten Chatnachrichten, die zugeordneten Feldschemata und maximal die 150 zuletzt bearbeiteten Datensätze je Datenquelle. Die übrigen Datensätze sind weiterhin in den Übersichten sichtbar. Diese Daten werden an OpenAI gesendet; es entstehen API-Kosten. Responses-Anfragen setzen `store: false`. Der Chatverlauf bleibt lokal in der verschlüsselten Sitzung gespeichert.

Jede Schreibaktion wird als serverseitiger Vorschlag vorbereitet. Erst **In Notion speichern** führt sie aus. Auch Änderungen über Kontaktformulare und Aufgaben-Checkboxen werden zunächst zur Prüfung vorbereitet. Die App validiert Datenquelle, Felder, Notion-Statuswerte und Seitenzugehörigkeit. Vorhandene Seiten werden vor dem Schreiben auf zwischenzeitliche Änderungen geprüft. Vorschläge laufen nach einer Stunde ab. Doppelte Freigaben werden abgewiesen; bei einem unklaren Netzwerkausgang wird dieselbe Aktion nicht automatisch erneut ausgeführt. Prüfe in diesem Fall Notion, bevor du einen neuen Vorschlag erstellst. Die Notion API bietet keine atomare Compare-and-Swap-Operation; zwischen letzter Prüfung und Schreiben bleibt ein kleines Konfliktfenster.

Unterstützt werden das Erstellen von Kontakten/Aufgaben und das Aktualisieren zugeordneter Eigenschaften. Seiteninhalte, Kommentare, Datenbankschemata und Löschungen sind nicht Teil dieser Version. Die Anwendung benötigt ein funktionierendes Notion-Token; ein öffentlicher OAuth-Installationsprozess für mehrere Kunden ist noch nicht enthalten.

## Speicherung und Betrieb

- Zugangsschlüssel, Zuordnungen, Änderungsvorschläge und Chatverlauf werden serverseitig mit AES-256-GCM in `DATA_DIR` (Standard `.local/`) verschlüsselt gespeichert. Schlüsseldatei und Sitzungsdateien erhalten Dateirechte `0600`. Diese Dateien gehören nicht in Git.
- Die Schlüsseldatei liegt auf demselben Server. Verschlüsselung ersetzt keine Serverzugriffskontrolle. Das Datenverzeichnis und die Schlüsseldatei gemeinsam sichern und nur vertrauenswürdigen Administratoren zugänglich machen.
- Ein zufälliges HttpOnly-/SameSite-Strict-Cookie identifiziert den Browser. Andere Browser erhalten eigene Verbindungen. Wer ein Sitzungs-Cookie besitzt, kann auf diese Sitzung zugreifen. Das Cookie läuft nach 30 Tagen ab; lokale Sitzungsdateien werden nicht automatisch gelöscht. Notion lässt sich in der App trennen, der OpenAI-Schlüssel separat entfernen.
- **Privater Einzelserverbetrieb:** Die App bringt keine Benutzerkonten oder Teamrechte mit. Für Zugriff außerhalb des eigenen Rechners einen HTTPS-Reverse-Proxy mit Authentifizierung davor schalten; `APP_ORIGIN` auf die vollständige HTTPS-Origin und `COOKIE_SECURE=true` setzen. Standardmäßig keine öffentliche Bereitstellung. Ein einzelner Node-Prozess muss exklusiv auf das Datenverzeichnis zugreifen; kein Clusterbetrieb mit gemeinsamem Dateispeicher.
- Die Anwendung unterstützt den geerbten HTTPS-Proxy samt CA-Vertrauen über Undici. TLS-Prüfung bleibt aktiv. Keine Schlüssel in Chat, Logs oder Repository-Dateien kopieren.

## Prüfen

```sh
npm run build                 # TypeScript und Produktions-Bundle
npm test                      # Domain- und API-Integrationstests mit simuliertem Notion
npx playwright install chromium  # entfällt bei vorhandenem /usr/bin/chromium
npx playwright test           # Desktop- und mobile Browserabläufe
```

API-Tests prüfen unter anderem verschlüsselte Schlüsselablage, Datenzuordnung, Schreibfreigabe, Sitzungsisolation, doppelte Freigaben, Änderungskonflikte und Paginierung. Browser-Tests prüfen Navigation, Suche, Portfolio, Einstellungsdialog und Demo-Agent. Es werden keine Zugangsdaten benötigt und keine echten Notion-Daten verändert. Live-Tests gegen Notion und OpenAI müssen nach dem Verbinden mit den eigenen Konten erfolgen.

## Technik

React, TypeScript und Vite im Frontend; Express im Backend. Notion REST API mit festgelegter Version `2025-09-03` und Data-Source-Endpunkten; OpenAI Responses API mit Function Calling. Kein Docker und keine zusätzliche Datenbank nötig.

Referenzen: [Notion Datenquellen abfragen](https://developers.notion.com/reference/query-a-data-source), [Notion Suche](https://developers.notion.com/reference/post-search), [OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling).
