# Telegram Bot Bridge für BobBot (GrokBot Mobile Alternative)

BobBot unterstützt nativ die Anbindung an Telegram über `@chat-adapter/telegram`. Damit kannst du deine Bots (`GrokCoder`, `OpenResearch`, `TrendScout`, `ExecutiveChief`, `DataAnalyst`) direkt über die Telegram-App auf dem Smartphone oder Desktop nutzen — ganz ohne laufenden Browser.

---

## 1. Telegram-Bot erstellen (BotFather)

1. Öffne Telegram und suche nach dem offiziellen Bot **[@BotFather](https://t.me/BotFather)**.
2. Sende den Befehl `/newbot`.
3. Gib deinem Bot einen Anzeigenamen (z. B. `Mein BobBot Assistent`).
4. Wähle einen eindeutigen Benutzernamen, der auf `bot` endet (z. B. `mein_rakazo_bot`).
5. BotFather gibt dir deinen geheimen **API Token** (Format: `1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ`).
   *(Halte diesen Token geheim!)*

---

## 2. Webhook-Secret generieren

Generiere ein zufälliges 32-stelliges Token für die Webhook-Signierung:

```bash
# Unter Linux / macOS / Git Bash:
openssl rand -hex 16

# Unter Windows PowerShell:
-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})
```

---

## 3. Umgebungsvariablen in BobBot konfigurieren

Füge die beiden Variablen zu deiner `.env` (oder `docker-compose.images.yml`) hinzu:

```env
TELEGRAM_BOT_TOKEN="1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ"
TELEGRAM_WEBHOOK_SECRET_TOKEN="dein_generiertes_32_zeichen_secret"
```

> **Hinweis zum Betriebsmodus:**
> - **Lokal / ohne öffentliche Domain**: BobBot schaltet automatisch auf **Long-Polling (`getUpdates`)** um. Du brauchst keinen Portforwarding und kein SSL-Zertifikat!
> - **Mit VPS / öffentlicher Domain**: Wenn du einen Webhook bei Telegram registriert hast (`https://deine-domain.de/api/messaging/telegram/webhook`), nutzt BobBot den performanten Push-Webhook.

---

## 4. Container neu starten

```bash
docker compose -f infra/compose/docker-compose.images.yml restart api worker
```

Sobald der API-Container startet, initialisiert er den Telegram-Poller.

---

## 5. Kopplung mit deinem BobBot-Account (Pairing Flow)

1. Öffne deine BobBot Web-UI (`http://localhost:5174` oder deine Instanz).
2. Gehe auf **Settings → Messaging** und kopiere deinen persönlichen **Pairing-Code** (oder erstelle einen neuen Code).
3. Öffne deinen Bot in Telegram und sende:
   ```text
   /pair <DEIN-PAIRING-CODE>
   ```
4. Der Bot bestätigt die Verbindung: *„Account erfolgreich verknüpft!“*
5. Jetzt kannst du direkt chatten!
   - Erwähne Bots mit `@OpenResearch`, `@GrokCoder`, `@TrendScout` etc.
   - Oder weise in den Bot-Einstellungen einen Standard-Bot für direkte Direktnachrichten (DMs) zu.
