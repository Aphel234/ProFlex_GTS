# ProFlex / GTS / Angebotsmanager V9.11.0 bei GitHub Pages veröffentlichen

Diese ZIP enthält die **gesamte Anwendung**. Ein Patch oder eine ältere Programmversion ist nicht erforderlich.

## Dateien hochladen

1. ZIP entpacken.
2. Bei GitHub ein neues Repository anlegen oder das bestehende öffnen.
3. Den **Inhalt** des entpackten Hauptordners hochladen – nicht den umschließenden Ordner selbst.
4. Bei einem bestehenden Repository gleichnamige Dateien ersetzen.
5. Prüfen, dass `docs` direkt auf der obersten Repository-Ebene sichtbar ist.

## GitHub Pages aktivieren

1. **Settings → Pages** öffnen.
2. Als Quelle **Deploy from a branch** auswählen.
3. Branch **main** und Ordner **/docs** auswählen.
4. **Save** anklicken.

Nach wenigen Minuten erscheint dort die öffentliche Adresse:

`https://DEIN-BENUTZERNAME.github.io/REPOSITORYNAME/`

## Nach einer Aktualisierung

Die Seite einmal hart neu laden:

- Windows/Linux: `Strg + Umschalt + R`
- macOS: `Cmd + Umschalt + R`

## Enthalten

- `docs/` – sofort veröffentlichbare GitHub-Pages-Anwendung
- `dist/` – fertiger Produktions-Build
- `public/` und `src/` – vollständiger Quellcode
- `tests/` – alle Optimierer-Tests
- `scripts/` – Build-Skript

V9.11.0 heißt **ProFlex / GTS / Angebotsmanager**. Sie startet ohne Beispieldaten, verwendet allgemeine Begriffe, akzeptiert ein bis vier Wunschspalten sowie kombinierte Namen und bietet eine zentrale Einwahlkontrolle und neue Excel-Vorlagen. Der FuxNoten-Export mit den beiden fest vereinbarten Tabellenblättern `ProFlex_Kurse` und `ProFlex_Teilnehmer` bleibt enthalten. Vorhandene lokale Projekte sowie alte JSON- und Excel-Dateien bleiben kompatibel.

Automatische Berechnungen halten Maximalbelegungen weiterhin ein. Eine Überbelegung ist ausschließlich eine bewusst bestätigte manuelle Nachbearbeitung und wird deutlich gekennzeichnet.
