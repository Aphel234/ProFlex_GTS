# V9.8.3 – Reparaturkette bis zur Stabilität

Die fünf bestehenden Reparaturstufen laufen nun als gemeinsame Kette:

1. Kohorten
2. Jahrgangsgrenzen
3. vorrangige Zusammensetzungsregeln
4. bevorzugte Zusammensetzungsregeln
5. Jahrgangsgruppen-Regel

Verändert eine spätere Stufe eine zuvor geprüfte Zusammensetzung, beginnt die Kette erneut. Dadurch können überlappende Regeln Lösungen erreichen, für die ein einzelner Gesamtdurchlauf nicht ausgereicht hat.

## Sicherheitsmechanismen

- Ende, sobald alle Zusammensetzungsregeln erfüllt sind
- Ende, wenn eine Runde keine Zuteilung verändert
- Erkennung bereits besuchter Zuteilungszustände gegen Pendeln
- höchstens acht Gesamtrunden
- Speicherung aller vollständigen Zwischenlösungen
- abschließende Auswahl weiterhin nach dem Regler Wünsche ↔ Jahrgangsverteilung

Regeldefinitionen, Gewichte, Kapazitäten, Sperrungen und feste Setzungen wurden nicht verändert.

## Regressionstest

Ein neuer Prüffall kombiniert Jahrgangsgrenzen, bevorzugte Klassen- und Jahrgangsregeln sowie die Jahrgangsgruppen-Regel. Die vollständige Zuteilung bleibt erhalten; der Abweichungswert sinkt durch die erneute Reparaturrunde von 16 auf 10.
