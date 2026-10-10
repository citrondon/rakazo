# Erste Schritte mit BobBot

Diese Anleitung ist für den Einstieg gedacht: du musst nichts programmieren und
musst keine Datei anfassen. Alles passiert im Browser — mit der App für Handy
geht fast alles genauso, die Unterschiede stehen unter *Mit dem Handy
arbeiten*.

## Was BobBot für dich tut

BobBot ist eine Plattform für AI-Kollegen. Ein Bot ist kein Chatfenster, sondern
ein Mitarbeiter mit eigenem Chat, eigenem Gedächtnis, eigenen Routinen und einem
eigenen Computer. Mehrere Bots lassen sich zu einem Team zusammenstellen, das
gemeinsam an einem Projekt arbeitet: einer plant, andere bauen, einer prüft und
einer liest gegen.

## Schritt 1: Anmelden und ein Modell verbinden

1. Im Browser öffnen. Auf der Anmeldeseite ein Konto anlegen oder anmelden.
2. Danach führt dich die Einrichtung durch **Connect a model**. Dort wählst du
   den Anbieter, gibst die Adresse und den Schlüssel ein und lässt dir die
   Modelle mit **Find models** anzeigen. Ein Modell auswählen und speichern.
3. Zum Schluss entsteht dein erster Bot — Name und Rolle kannst du später
   ändern.

Ohne Modell kann kein Bot arbeiten. Wenn ein Lauf mit „Connect a model to start a
run" abbricht, fehlt genau dieser Schritt.

## Schritt 2: Ein Team aufstellen

1. **Team from template** auswählen.
2. Ein Roster aussuchen. Für ein eigenes Projekt ist **Software Factory** der
   direkteste Weg: es stellt vier Bots auf — einen Lead, einen Bau-Bot, einen
   Bot für Verifikation und einen für Review — und legt dafür eine Gruppe an.
   Es gibt außerdem Roster für Ops, Research, Vertrieb, Marketing und andere
   Aufgaben.
3. Ein Klick erzeugt alles zusammen: Gruppe, Bots, Rollen, Instruktionen und
   einen gemeinsamen Team-Computer. Optional kommt eine Automations-Routine
   dazu, die den Lead von allein weckt.

Jedes Mitglied bringt zwei Dinge mit: eine Rolle (das Etikett, das du im Team
siehst) und Instruktionen (die eigentliche Anweisung, was der Bot tun soll).
Du kannst beides jederzeit im Bot-Panel ändern.

## Schritt 3: Einen Auftrag geben

Schreibe im Gruppenchat der Gruppe, was du willst. Ein gutes Briefing hat vier
Teile:

- **Ziel**: was am Ende existieren soll.
- **Ergebnis**: in welcher Form — Programm, Dokument, Tabelle, Präsentation.
- **Vorgaben**: was zu beachten ist, was nicht angefasst werden darf.
- **Fertig, wenn**: woran man erkennt, dass es geklappt hat.

Beispiel: „Baue ein kleines Kommandozeilen-Programm `unitconv`, das Längen,
Gewichte und Temperaturen umrechnet. Ergebnis: JavaScript-Dateien plus Tests in
einem Ordner `unitconv`. Vorgaben: keine externen Pakete, alles offline.
Fertig, wenn `node bin/unitconv.js 3 km mi` das Ergebnis ausgibt."

Der Lead schreibt daraus einen Plan in `shared/PLAN.md` und übergibt die
Abschnitte an die anderen Bots. Die Übergabe ist eine echte Aufgabe: der
empfangende Bot bekommt die Aufgabe, die Vorgaben und das Abnahmekriterium —
sonst nichts. Deshalb lohnt sich ein präzises Briefing.

## Schritt 4: Zusehen und eingreifen

- Im Gruppenchat siehst du jede Übergabe und jede Antwort.
- Wenn ein Bot eine Freigabe braucht, steht im Chat eine Karte mit **Allow
  once** oder **Deny**. Riskante Schritte warten auf dich, statt einfach zu
  passieren.
- Rückfragen eines Bots beantwortest du direkt im Chat.
- Du kannst jederzeit selbst in einen Bot-Chat schreiben; er antwortet dort in
  seinem eigenen Chat weiter.

## Schritt 5: Das Ergebnis holen

Fertige Dateien liegen als Artefakte im Thread und gesammelt unter
**Artifacts**. Dort kannst du sie ansehen und herunterladen. Ein Bot darf
Ergebnisse auch als Datei an eine Nachricht anhängen — das ist der Weg, auf dem
Deliverables entstehen.

## Mit dem Handy arbeiten

Die App für Android und iOS verbindet sich mit demselben BobBot wie der
Browser. Beim Anmelden tippst du unten auf **Use a custom server** und trägst
die Adresse deines Servers ein; zuhause im selben Netz ist das
`http://127.0.0.1:3100`.

Was auf dem Handy (noch) anders ist:

- Über das **+**-Symbol legst du einen Bot, eine Gruppe oder einen Space an.
  Ein fertiges Team aus einer Vorlage gibt es dort nicht — Teams stellst du im
  Browser mit **Team from template** auf, sie erscheinen danach auch im Handy.
  Ein einzelner Bot funktioniert auch ohne Vorlage: lege ihn an und schreibe
  ihm, was er werden soll; er fragt dann selbst nach Rolle, Auftrag und
  Vorgaben.
- Auf der Models-Seite steht oben **Active model**. Steht dort ein Modell, kannst
  du sofort loslegen: es ist das Modell, das die Installation vorgibt, und es
  gehört dir nicht — der Betreiber kann es ändern. Steht dort **No model
  connected**, verbinde zuerst einen Anbieter mit deinem eigenen Schlüssel.
  Unten in der Liste stehen alle Anbieter; der Schlüssel gehört in das Feld über
  der Modellliste.
- In den Kontoeinstellungen stellst du ein, wofür das Handy klingelt: den
  Live-Status während der Arbeit, Antworten der Bots, Alarme aus Routinen und
  alles, was Aufmerksamkeit braucht (Fragen, Freigaben, Übernahme).
- Während ein Bot arbeitet, siehst du seinen Zwischenstand im Chat und kannst
  ihn über den Stopp-Knopf anhalten.
- Artefakte schaust du unter **Artifacts** an; Computer-Dateien eines Bots
  öffnest du im Chat über die Computer-Ansicht.

## Was von allein läuft

- **Routinen** wecken einen Bot zu festen Zeiten in dem Chat, den du festlegst.
  Der Software-Factory-Lead bekommt zum Beispiel eine Routine, die ihn an
  Werktagen weckt und nach dem Stand fragt.
- Läufe ohne Menschen sammelt die Aktivitätsliste unter **Ran on their own**.
  Dort steht nur, was eine Routine, ein anderer Bot oder ein Ereignis gestartet
  hat — nicht, was du selbst getippt hast.
- **Reaktive Trigger** lassen Bots auf Ereignisse reagieren, zum Beispiel auf
  ein eingehendes Webhook oder ein GitHub-Ereignis, geprüft gegen Bedingungen
  wie `ist gleich`, `enthält`, `größer`, `kleiner`.

## Wenn etwas nicht klappt

- **Ein Bot antwortet nicht.** Modell prüfen (verbunden? Guthaben?) und den
  Lauf in der Aktivität ansehen. Fehlermeldungen stehen unter der Nachricht.
- **Ein Bot wartet.** Dann braucht er eine Freigabe oder eine Antwort auf eine
  Frage — beides steht im Chat.
- **Das Ergebnis passt nicht.** Briefing schärfen: Ziel, Vorgaben und
  Abnahmekriterium konkreter machen. Der Bot hält sich an das, was du
  geschrieben hast, nicht an das, was du gemeint hast.
- **Erfundene Angaben.** Bots sollen nichts erfinden, sondern Belege aus dem
  Thread, aus Dateien oder aus dem Netz anführen. Prüfe trotzdem, was du
  weitergibst: ein falscher Schluss kommt selbstbewusst, nicht vorsichtig.
- **Ein Schreibversuch wird abgelehnt.** Ein Sicherheitsfilter blockiert
  Inhalte, die wie Zugangsdaten aussehen. Lass den Bot den Inhalt umformulieren
  — er kann das selbst und meldet es dir.

## Deinen eigenen BobBot betreiben

Wenn BobBot auf deinem eigenen Server läuft, gilt für den Betrieb:

- Starten und stoppen mit Docker Compose (siehe `docs/self-host.md`).
- Ports ändern: `BOBBOT_WEB_PORT` und `BOBBOT_API_PORT` in der `.env`.
- Sicherung: `infra/compose/backup-prod.sh`, Wiederherstellung:
  `infra/compose/restore-prod.sh`. Sicherungen regelmäßig auf einen anderen
  Rechner kopieren, nicht nur daneben liegen lassen.
- Updates kommen über die App selbst; der Stand lässt sich im
  Einstellungsbereich einsehen.
- Ältere Einstellungen heißen noch `RAKAZO_*`. Beide Namen funktionieren, der
  neue gewinnt, wenn beide gesetzt sind — du kannst also in Ruhe umbenennen.

## Für die Vorführung

Im Gruppenchat der Software Factory liegt unter `shared/rakazo-deck/` ein
Foliensatz samt Redetext für eine Live-Vorführung: `index.html` im Browser
öffnen, `redetext.md` danebenlegen. Die Folien führen in fünf Schritten von
"BobBot im Browser öffnen" bis "Artefakt herunterladen".
