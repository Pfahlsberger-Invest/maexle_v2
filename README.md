# Mäxle Score-Board

Mehrspieler-fähiges Score-Board mit React Frontend, Netlify Functions als API und Neon Postgres als Datenbank.

## Architektur

```
Browser  ──HTTPS──>  Netlify Function (/api/*)  ──Postgres──>  Neon
```

Die Daten werden zentral in Neon gespeichert, alle Browser sehen denselben Stand.
Polling alle 30 Sekunden synchronisiert Updates zwischen mehreren Geräten.

## Erste Einrichtung

### 1. Datenbank-Schema in Neon anwenden

Falls noch nicht passiert: das beigelegte `neon-schema.sql` einmal in der Neon SQL-Console ausführen
(oder via psql).

### 2. Lokale Konfiguration

```bash
cp .env.example .env
# .env mit deinem echten Neon-Passwort öffnen und ersetzen
npm install
```

### 3. Lokal entwickeln

Da das Frontend `/api/*` aufruft, brauchst du Netlify Dev zum lokalen Testen:

```bash
npm install -g netlify-cli   # einmalig
netlify dev
```

Das startet Vite + die Functions auf http://localhost:8888 — der Frontend-Code
spricht /api direkt mit den Functions.

Alternativ ohne Functions (Frontend allein, API-Calls schlagen fehl):

```bash
npm run dev
```

## Deployment auf Netlify

### Variante A: ZIP-Upload (Drag & Drop)

Drag & Drop funktioniert hier **nicht direkt**, weil Functions Build-time einen Server brauchen.
Du musst über GitHub deployen (siehe Variante B).

### Variante B: Git-Deploy (empfohlen)

1. Repo auf GitHub pushen
2. Auf Netlify "Add new site → Import existing project" → GitHub-Repo wählen
3. Build settings sollten automatisch erkannt werden (Build: `npm run build`, Publish: `dist`)
4. **Wichtig: Environment Variable setzen**
   - Site settings → Environment variables → Add
   - Key: `DATABASE_URL`
   - Value: Dein vollständiger Neon-Connection-String mit Passwort
5. Deploy triggern

Nach erfolgreichem Deploy ist die Seite live unter deiner Netlify-Domain. Die Functions
laufen automatisch unter `/api/*`.

### Variante C: Netlify CLI

```bash
npm install -g netlify-cli
netlify login
netlify init     # mit dem Site verknüpfen
netlify env:set DATABASE_URL "postgresql://..."
netlify deploy --prod
```

## API-Endpoints

Alle unter `/api/*`:

| Method | Pfad             | Body                                  | Zweck                            |
|--------|------------------|---------------------------------------|----------------------------------|
| GET    | `/state`         | —                                     | Volle App-Daten + IP             |
| POST   | `/players`       | `{ name, color }`                     | Spieler hinzufügen               |
| PATCH  | `/players/:id`   | `{ in_game: bool }`                   | Im-Spiel-Toggle                  |
| DELETE | `/players/:id`   | —                                     | Spieler archivieren (soft delete)|
| POST   | `/rounds`        | `{ loser_id, participants: [id,…] }`  | Runde aufzeichnen                |
| DELETE | `/rounds`        | —                                     | Alle Runden zurücksetzen         |
| POST   | `/schande`       | `{ player_id, delta }`                | Schande-Score anpassen           |

## Funktionsweise

- **Schande-Decay**: Wird "lazy" beim `/state`-Call angewendet — bei jedem Refresh prüft
  die API, wie viele 5-Minuten-Intervalle seit letzter Anwendung vergangen sind, und
  zieht entsprechend ab. Funktioniert auch nach längerem Stillstand.
- **Multi-User-Sync**: Frontend pollt alle 30 Sekunden. Bei Aktionen anderer Nutzer
  erscheinen die Updates beim nächsten Poll-Cycle.
- **Optimistische UI**: Klicks und Toggles werden lokal sofort angezeigt und im Hintergrund
  an die API gesendet. Bei Fehlern wird der State refresht.
- **IP-Logging**: Wird serverseitig aus dem `x-nf-client-connection-ip`-Header gezogen,
  nicht mehr von einer externen API.

## Schemaschnellüberblick

- `players` — Personen mit `in_game`, `color`, `schande_score`, soft-delete via `archived_at`
- `rounds` — Eine Zeile pro Klick mit `loser_id`, `played_at`, `ip_address`
- `round_participants` — M:N-Tabelle: wer war im Spiel
- `schande_adjustments` — Audit-Log aller manuellen Schande-Änderungen
- `app_state` — Globale Werte (z.B. `last_decay_at`)
- View `player_stats` — Berechnete Statistiken (für Ad-hoc-SQL-Queries)
