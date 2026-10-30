# Update V9.6.0 – Wünsche und Jahrgangsverteilung gewichten

## Neue Einstellung

Unter **Übersicht → Einstellungen** gibt es den Regler **„Priorität: Wünsche ↔ Jahrgangsverteilung“**.

- **0 % – Nur Wünsche:** Der Solver schützt die Wunschqualität maximal.
- **50 % – Ausgewogen:** Wünsche und Jahrgangsverteilung zählen gleichrangig. Dies ist die Standardstellung.
- **100 % – Jahrgangsverteilung maximal:** Der Solver nimmt bei Bedarf schlechtere Wünsche in Kauf, um Jahrgangsregeln möglichst genau zu erfüllen.

Zwischenwerte in Zehnerschritten erlauben eine feinere Abstimmung.

## Unveränderte Prioritäten

Die Gewichtung kann keine absoluten Grenzen lockern. Vorrang behalten:

1. möglichst vollständige Zuteilung,
2. Kapazitäten und Kurszugang,
3. Sperrungen und feste Setzungen.

Regelabweichungen werden weiterhin mit Kurs, Ist-Wert und Zielwert angezeigt. Alte JSON-Projekte bleiben kompatibel und erhalten automatisch die ausgewogene Standardstellung von 50 %.

## Technische Prüfung

Neben allen bisherigen Optimiererfällen wird nun ausdrücklich getestet, dass derselbe lösbare Zielkonflikt bei 0 % die Erstwünsche schützt und bei 100 % die Jahrgangsgrenzen erfüllt, ohne jemanden unzugeteilt zu lassen.
