# V9.9.0 – regelbewusste globale Optimierung

Die Zuteilung erhält nach Erstverteilung und Reparaturkette zwei zusätzliche globale Suchstufen.

## Gemeinsamer Kostenfluss

Für jede zulässige Person-Kurs-Kombination bewertet der Solver gleichzeitig:

- Wunschposition
- Kursmindestziel und Kapazität
- Jahrgangs-Minima und -Maxima
- Mindestgruppen nach Jahrgang, Klasse und Bildungsgang
- Jahrgangsgruppen-Regel
- weitere vorrangige und bevorzugte Zusammensetzungsregeln
- Kursausgleich

Der Kostenfluss kann alle Kurse in einem Schritt neu belegen. Feste Setzungen, Sperrungen, Kurszugang und automatische Maximalbelegungen bleiben verbindlich.

## Adaptive Mehrschritt-Koordination

Kleine gekoppelte Restkonflikte werden zusätzlich mit einer begrenzten Mehrschritt-Suche untersucht. Sie darf intern vorübergehend ein Kursmindestziel unterschreiten, um eine mehrgliedrige Verschiebungskette aufzubauen. Ein solcher Zwischenstand wird nie als Endergebnis verwendet. In die Auswahl gelangen ausschließlich wieder vollständig zulässige Verteilungen.

Breite Regelbilder mit sehr vielen Aktionsmöglichkeiten bleiben beim skalierbaren Kostenfluss und den spezialisierten Reparaturen. Dadurch wächst die zusätzliche Tiefensuche nicht unkontrolliert.

## Nachgewiesener Konfliktfall

Der neue Regressionstest kombiniert drei Kurse, kursbezogene Jahrgangs-Minima und eine 0-oder-mindestens-2-Klassenregel. Die bisherige Pipeline blieb trotz vorhandener exakter Lösung bei zwei Abweichungen stehen. V9.9.0 findet die gekoppelte Mehrkurs-Lösung mit null Abweichungen und ohne Nichtzuteilung.
