# Update V9.6.1 – Jahrgangsregeln konsequent bestmöglich

## Korrektur

Die Vorprüfung behandelte ein kursbezogenes Jahrgangsminimum teilweise noch als absolute Kursmindestbelegung. Dadurch konnte die Berechnung beispielsweise mit folgender Meldung abbrechen:

> Jahrgang 10 benötigt mindestens 4 Schüler, verfügbar sind nur 2.

Das widersprach dem vereinbarten Verhalten und ist korrigiert.

## Neues Verhalten

- Jahrgangs-Minima und -Maxima sind immer bestmögliche Zusammensetzungsziele.
- Eine unerreichbare Jahrgangsregel beendet die Berechnung nicht.
- Vorhandene zulässige Schüler bleiben zugeteilt.
- Kurs, Ist-Wert, Zielwert und Abweichung erscheinen als gelber Hinweis.
- Die Gewichtung aus V9.6.0 entscheidet weiterhin zwischen Wunschqualität und Jahrgangsverteilung.

Mit Stand V9.6.1 blieben gesamte Kursmindest- und -maximalbelegungen, Kurszugang, Sperrungen und feste Setzungen absolut. Seit V9.6.2 wird auch eine unerreichbare Kursmindestzahl bestmöglich behandelt; Maximalbelegung, Kurszugang, Sperrungen und feste Setzungen bleiben verbindlich.

## Regressionstest

Der Fall „Schülerfirma: Jahrgang 10 mindestens 4, aber nur 2 zulässige Schüler“ wird ausdrücklich geprüft. Erwartet wird eine vollständige Zuteilung mit Abweichung `−2`, nicht ein Abbruch.
