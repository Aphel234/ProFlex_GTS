# V9.8.4 – gemeinsame Logik für Jahrgang + Bildungsgang

Zwei weiterhin getrennt bedienbare Einstellungen verwenden intern nun dieselbe Regeltechnik:

- globale beziehungsweise kursbezogene **Mindestgruppe Jahrgang + Bildungsgang**
- flexible Zusammensetzungsregel **Jahrgang + Bildungsgang**

## Zusammenführung

- Identische harte Mindestzahlen ergeben eine gemeinsame Vorgabe.
- Bei mehreren harten Mindestzahlen gilt die höchste.
- Ein bevorzugtes Ziel unterhalb oder auf Höhe des harten Minimums ist bereits abgedeckt.
- Ein höheres bevorzugtes Ziel greift erst, nachdem das harte Minimum erfüllt ist.
- Reparatur, Bewertung, Abweichungswert und Warnung verwenden denselben gemeinsamen Regelzustand.

Damit wird dieselbe Gruppe nicht mehr doppelt gesucht, doppelt bestraft oder doppelt gemeldet. Oberfläche, Projektdaten und Excel-Kompatibilität bleiben unverändert.

## Prüfung

Neue Regressionstests decken reine Kohorteneinstellungen, reine flexible Regeln, identische Doppelkonfigurationen und gestufte harte beziehungsweise bevorzugte Ziele ab.
