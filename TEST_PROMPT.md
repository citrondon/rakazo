# Alles testen — Web, API und die Mobile-App am Handy

Kopiere diesen Prompt in einen Coding-Agenten. Ein schnelles Modell reicht; die Schritte sind
explizit. Arbeite sie der Reihe nach ab und berichte am Ende knapp, was grün und was rot ist.

**Ziel:** Beweisen, dass der aktuelle `main`-Stand auf allen Ebenen läuft — API/Worker, Web-UI und
die Expo-App auf einem echten Handy — und jede Abweichung mit Befehl + Ausgabe belegen.

## Regeln

- **Keine Secrets.** Werte aus `.env` nie ausgeben; nur Schlüsselnamen prüfen.
- **Keine Daten löschen.** Ein `down` nie mit `-v`.
- **Kein Erfolg ohne Beleg.** Bei Fehlschlag den exakten Befehl und die Ausgabe nennen.
- **Sicherheit nicht aufweichen.** Signups bleiben zu, MCP-stdio bleibt aus — nur um einen Test
  grün zu bekommen, wird nichts davon wieder eingeschaltet.

## 0. Kontext

Der Stand enthält: den Upstream-Merge, das Security-Hardening (MCP-stdio aus, Signups zu,
Web-Härtung), die universelle Bot-Safety-Präambel, Operator-Skripte über oRPC, die
`runs.stopReason`-Spalte, die gewichtete Cache-Abrechnung, den Mid-Run-Budget-Stopp und das
grokbot-Fix-Paket. Belege dafür: `docs/bot-safety-preamble.md`, `scripts/lib/api.ts`,
`packages/adapters/src/pi-runtime.ts`, `packages/db/prisma/migrations/20261010150000_run_stop_reason/`.

## 1. Werkzeugketten prüfen

```bash
git log --oneline -5
node -v && pnpm -v && docker --version
```

Erwartet: Node 22.22.2 (oder 24.x / 26+), pnpm 9, Docker-Daemon läuft.

## 2. Statische Prüfung

```bash
pnpm install
pnpm db:generate
pnpm check          # turbo check + scripts typecheck
pnpm lint           # biome: 0 Fehler, Warnungen sind ok
pnpm test           # volle Suite
```

Die exakten `Test Files`- und `Tests`-Zahlen nennen. Jeden roten Test mit Ausgabe wiedergeben.

## 3. Laufender Stack

```bash
docker ps --format '{{.Names}}\t{{.Status}}'
curl -s http://127.0.0.1:3100/internal/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173
```

Erwartet: `api` meldet `ok: true`, `web` liefert `200`. Ist der Stack aus, mit der Source-Build-
Compose hochfahren:

```bash
docker compose -p rakazo --env-file .env -f infra/compose/docker-compose.build.yml up -d
```

## 4. Sicherheits-Stichproben (müssen stimmen)

```bash
docker inspect rakazo-web-1 --format '{{.HostConfig.SecurityOpt}} {{.HostConfig.CapDrop}}'
docker inspect rakazo-web-1 --format 'pids={{.HostConfig.PidsLimit}} mem={{.HostConfig.Memory}}'
docker exec rakazo-postgres-1 psql -U rakazo -d rakazo -tc 'SELECT "signupsEnabled" FROM deployment_settings;'
docker exec rakazo-postgres-1 psql -U rakazo -d rakazo -c '\d runs' | grep -i stopreason
```

Erwartet: `[no-new-privileges:true] [ALL]`, `pids=128`, `mem=536870912`, `signupsEnabled = f`,
eine `stopReason`-Spalte.

## 5. Web-UI (Browser)

- `http://127.0.0.1:5173` öffnen.
- Registrierung versuchen: **muss abgelehnt** werden („Registration is closed"). Meldung notieren.
- Mit vorhandenem Konto anmelden, einen Bot öffnen. Ist ein Modell verbunden? Wenn ja: harmlose
  Testnachricht senden und die Antwort abwarten. Wenn nein: klar sagen, dass Bots ohne Modell
  nicht antworten.
- Computer-Pane öffnen, bis der Container `running` zeigt und der Desktop rendert.
- MCP-Server-Overlay: Es darf nur der Preset **„Web-Recherche & Fetch"** erscheinen (gepinnt,
  keine Auto-Zuweisung). Das Feld „Erlaubte Tools für {bot}" zeigt neue Server mit 0 Tools.
- Browser-Konsole auf Fehler prüfen.

## 6. Mobile-App am Handy  ← der Kern

Voraussetzungen: Handy und Entwicklerrechner im selben WLAN (oder USB mit `adb`). Die App spricht
dieselbe API wie das Web.

```bash
# Auf dem Handy ist 127.0.0.1 der Rechner selbst — die LAN-IP des Rechners eintragen:
hostname -I | awk '{print $1}'        # z. B. 192.168.0.42
EXPO_PUBLIC_API_URL=http://<LAN-IP>:3100 pnpm --filter @rakazo/mobile start
```

1. Auf dem Handy **Expo Go** öffnen und den QR-Code scannen. (Für SDK-57-Module oder wenn Expo Go
   die App nicht lädt: `pnpm --filter @rakazo/mobile android` an einem USB-Handy mit `adb`.)
2. In der App anmelden (bestehendes Konto), einen Bot öffnen, den Modell-Status prüfen.
3. Eine harmlose Testnachricht senden und die Antwort abwarten.
4. Mobile-Unit-Tests im Repo laufen lassen: `pnpm --filter @rakazo/mobile test`.
   Optional der Geräte-Smoke: `pnpm --filter @rakazo/mobile test:e2e` (Maestro, braucht ein Gerät).
5. Nur wenn Push eingerichtet ist: eine Benachrichtigung auslösen und den Eingang prüfen.

## 7. Bericht

Am Ende knapp auflisten:

- Commit (`git rev-parse --short HEAD`) und ob Working Tree clean ist.
- Node/pnpm/Docker-Versionen.
- `pnpm check` (22/22?), `pnpm lint` (0 Fehler?), `pnpm test` (Files/Tests).
- Health-Ergebnis für API und Web; Zustand der Container.
- Sicherheits-Stichproben: Web-Härtung, Signups, `stopReason`.
- Web-UI: Registrierung blockiert?, Anmeldung ok?, Modell verbunden?, Antwort?, Computer läuft?
- **Handy:** verbunden?, Anmeldung ok?, Nachricht/Antwort?, welche API-URL genutzt wurde.
- Jede Abweichung mit dem exakten Befehl und der Ausgabe; offene Punkte zum Schluss.
