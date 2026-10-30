# Update V9.5.0 – vollständige Bestmöglich-Zuteilung

## Neue Priorität

Der Solver bewertet Ergebnisse jetzt in dieser Reihenfolge:

1. möglichst wenige Schüler ohne Workshop-Zuteilung,
2. möglichst wenige vorrangige Regelabweichungen,
3. möglichst wenige Regelabweichungen insgesamt,
4. möglichst kleine Abweichung von den Zielwerten,
5. anschließend Wunschqualität und Kursausgleich.

Jahrgangsgrenzen, Kohortenregeln, weitere Zusammensetzungsregeln und die Jahrgangsgruppen-Regel werden weiterhin intensiv durch Verschiebungen, Tausche und globale Neuberechnungen gesucht. Ist keine exakte Kombination erreichbar, wird die beste zulässige Zuteilung ausgegeben. Eine Regel allein entfernt keinen Schüler mehr aus einem bereits zulässigen Workshopplatz.

Verbindlich bleiben die gesamte Kurskapazität, der zugelassene Klassenbereich und Bildungsgang, Sperrungen, feste Setzungen sowie die gesamte Mindest-/Maximalbelegung eines stattfindenden Kurses.

## Hinweise im Ergebnis

Unvermeidbare Abweichungen erscheinen:

- im gelben Hinweisdialog nach der Berechnung,
- in den Regeldetails des betreffenden Kurses,
- in der Spalte `Hinweis` der betroffenen Schüler beim Excel-Export,
- in der Kursübersicht des Excel-Exports.

Beispiel:

`Forscherwerkstatt: Jg. 8: 11 statt höchstens 8`

Die elf Schüler bleiben zugeteilt; die Abweichung wird nachvollziehbar markiert.

## Neuer Regelname

Die bisher sichtbare Bezeichnung „Debattierregel“ wurde durch **„Jahrgangsgruppen-Regel“** ersetzt. Die aktuelle Konfiguration lautet weiterhin:

- Jahrgänge 8+9 zusammen,
- Jahrgang 10 aufwärts zusammen,
- Gruppengröße 4,
- optionaler Ausgleich beider Jahrgangsgruppen.

Neue JSON-Projekte speichern die Einstellung unter `gradeGroupRule`. Das frühere Feld `debateRule` und die bisherigen Excel-Spalten werden beim Import weiterhin erkannt. Die neue Excel-Spalte heißt `Jahrgangsgruppen-Regel 8/9 + 10+`.

## Installation des Patches

Den Inhalt der Patch-ZIP in das Stammverzeichnis der vorhandenen Version kopieren und gleichnamige Dateien ersetzen. Bei GitHub Pages anschließend alle geänderten Dateien committen. Nach der Veröffentlichung die Anwendung einmal hart neu laden.

- macOS: `Cmd + Umschalt + R`
- Windows/Linux: `Strg + F5`

