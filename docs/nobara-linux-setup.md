# Rakazo auf Nobara Linux — Setup-Guide

Nobara ist Fedora-basiert, also gilt: DNF für Systempakete, Docker (nicht Podman als Drop-in, das Projekt nutzt Compose v2 und `docker compose`), Node über nvm. Alles hier ist aus dem Repo abgeleitet (`README.md` → *Local development*, `.env.example`), nichts geraten.

---

## 1. Systempakete

```bash
sudo dnf install -y git docker docker-compose-plugin openssl
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

Danach **ab- und neu anmelden** (nicht nur neues Terminal), sonst greift die Docker-Gruppe nicht und jeder `docker`-Befehl scheitert an Permission denied.

Prüfen:

```bash
docker run --rm hello-world
```

## 2. Node 22 + pnpm 9 über nvm

Das Projekt pinnt in `engines` auf `^22.22.2 || ^24.0.0 || >=26.0.0` — **nicht 23.x, nicht 25.x.** In der Praxis nimm trotzdem die neueste 22.x: `@composio/core` verlangt inzwischen `>=22.22.3`, und ein exakt auf 22.22.2 gebautes Node bricht `pnpm install` ab mit:

```
ERR_PNPM_UNSUPPORTED_ENGINE  Expected version: >=22.22.3  Got: v22.22.2
```

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# Shell neu öffnen, dann:
nvm install 22
nvm use 22
corepack enable
corepack prepare pnpm@9.15.0 --activate
```

Prüfen: `node -v` → v22.23.x oder neuer (mindestens 22.22.3), `pnpm -v` → 9.15.0. Mit `nvm alias default 22` bleibt die Version auch in neuen Shells stehen.

Falls `corepack` meckert: `npm install -g pnpm@9.15.0` geht auch — aber **mit** exakter Version, siehe Stolperfalle 3.

## 3. Repository klonen und .env

Dieser Guide liegt in `citrondon/rakazo`; die Abschnitte 1–5 sind aus `README.md` und `.env.example` abgeleitet, die Nobara-Hinweise am Ende nicht.

```bash
git clone https://github.com/citrondon/rakazo.git
cd rakazo
cp .env.example .env
```

Dann `.env` editieren — fünf Werte sind Pflicht, alle unabhängig voneinander generieren:

```bash
openssl rand -hex 16   # → POSTGRES_PASSWORD, und derselbe Wert in DATABASE_URL
openssl rand -hex 32   # → BETTER_AUTH_SECRET
openssl rand -hex 32   # → SCREEN_PROXY_SECRET
openssl rand -hex 32   # → ENCRYPTION_KEY (64 hex chars)
openssl rand -hex 16   # → SANDBOX_SUPERVISOR_TOKEN (für Docker-Sandboxes)
```

`DATABASE_URL` in `.env` muss das Passwort wörtlich enthalten:
`postgres://rakazo:DEIN_PASSWORT@127.0.0.1:5433/rakazo`
Keine Sonderzeichen wie `@ : / ? #` im Passwort — die brechen die Compose-Interpolation.

## 4. Postgres + Install + Migrate

```bash
docker compose --env-file .env \
  -f infra/compose/docker-compose.yml \
  -f infra/compose/docker-compose.postgres-host.yml \
  up postgres -d

pnpm install
pnpm db:generate
pnpm db:migrate
pnpm sandbox:build
```

Das Overlay `postgres-host` published die DB auf loopback `127.0.0.1:5433`, damit Host-seitige `pnpm`-Tools sie erreichen. Ohne das Overlay bleibt Postgres im Compose-Netzwerk.

**Falls `pnpm install` bei `app-builder-lib` hakt:** das Repo patcht dieses Paket (siehe `patches/`), pnpm 9 findet das automatisch. Bei Fehler: `pnpm install --force` statt mit halbfertigem State weiterzuarbeiten.

## 5. Dev-Stack starten

```bash
pnpm dev
```

Startet API, Worker, Web und Sandbox-Supervisor via turbo. Danach: [http://127.0.0.1:5173](http://127.0.0.1:5173), Account anlegen, Modell verbinden, ersten Bot erstellen.

## 6. Desktop (Electron, optional)

```bash
# in zweitem Terminal, während pnpm dev läuft:
pnpm --filter @rakazo/desktop dev
```

## 7. Mobile (Expo, optional)

```bash
pnpm --filter @rakazo/mobile android
```

Braucht Android SDK/adb auf dem Host — separates Thema, nicht Teil des Basis-Setups.

---

## Tests

```bash
pnpm check          # tsc über alle Pakete
pnpm lint           # biome check . (0 errors nötig, warnings ok)
pnpm test           # vitest, offline
pnpm test:integration   # braucht Docker, fährt eigene Testcontainers-Postgres hoch
pnpm test:e2e           # braucht Docker + Playwright-Chromium
```

Playwright-Browser einmalig installieren:
`pnpm --filter @rakazo/web exec playwright install chromium`

---

## Nobara-spezifische Stolperfallen

1. **SELinux**: Nobara aktiviert es. Wenn Docker Volumes nicht schreiben kann (Permission denied im Compose-Log trotz richtiger Gruppe), sind `:z`/`:Z` an den Volume-Mounts die erste Stelle zum Suchen — normalerweise trifft es hier nicht zu, weil Compose unter `/var/lib/docker` arbeitet.

2. **Firewall**: `firewalld` blockt Fremdzugriff — für reines Loopback-Development (`127.0.0.1`) irrelevant, nichts tun. Erst wenn du von einem anderen Gerät (z.B. Android im LAN) auf die Web-App willst:
   ```bash
   sudo firewall-cmd --add-port=5173/tcp --permanent
   sudo firewall-cmd --reload
   ```
   Und in `.env` `API_HOST=0.0.0.0` statt `127.0.0.1` — sonst lauscht die API nur auf loopback.

3. **pnpm auf der gepinnten Version halten**: Die Warnung „The pnpm field in package.json is no longer read“ stammt von **pnpm 11**, nicht von 9.15.0 — pnpm 9 liest `pnpm.overrides` und `pnpm.patchedDependencies` normal aus `package.json`. Sie taucht nur auf, wenn versehentlich ein neueres pnpm läuft (typischerweise nach `npm i -g pnpm` ohne Versionsangabe). Dann werden beide Felder **still** ignoriert, das `app-builder-lib`-Patch greift nicht mehr und der Electron-Build bricht später mit einer kryptischen Fehlermeldung ab. Dagegen: Corepack nicht umgehen und die im Repo gepinnte Version fahren — `corepack enable && corepack install -g pnpm@9.15.0` oder `npm i -g pnpm@9.15.0`. Kontrolle: `pnpm -v` muss 9.15.0 ergeben.

4. **Node-Version dauerhaft festhalten**: Am zuverlässigsten ist eine `.nvmrc` mit `22` im Repo-Root — `nvm use` liest sie automatisch. Für neue Shells zusätzlich `nvm alias default 22`. Ein `nvm use 22` in `~/.bashrc` wirkt nur in interaktiven Shells, weil nvm dort in Cron- oder IDE-Task-Kontexten gar nicht geladen ist — verlass dich nicht darauf allein.

5. **Disk space**: Docker + node_modules + Playwright-Browser + Testcontainers-Images ≈ 10–15 GB. `df -h` vorher checken.

---

## Kompletter Ablauf als Copy-Paste-Block

```bash
sudo dnf install -y git docker docker-compose-plugin openssl
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# -> abmelden, neu anmelden <-

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# -> Shell neu öffnen <-
nvm install 22
nvm use 22
nvm alias default 22
corepack enable
corepack prepare pnpm@9.15.0 --activate

git clone https://github.com/citrondon/rakazo.git
cd rakazo
cp .env.example .env
# .env editieren: die 5 openssl-Werte + DATABASE_URL-Passwort eintragen

docker compose --env-file .env \
  -f infra/compose/docker-compose.yml \
  -f infra/compose/docker-compose.postgres-host.yml \
  up postgres -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm sandbox:build
pnpm dev
```

Dann Browser auf [http://127.0.0.1:5173](http://127.0.0.1:5173).
