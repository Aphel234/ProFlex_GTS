# Update V9.8.0 – Planungszentrale

## Neue Auswertungen

- Beliebtheit nach Kursart und Wunschposition
- zulässige und kritische Nachfrage
- Kapazitätsdruck, tatsächliche Zuteilung und gefährdete Mindestgrößen
- globale Engpasshinweise mit konkreten Maßnahmen
- Wirkungsvorschau nach einer vorhandenen Berechnung

## Lösungsvergleich

Die Profile **Wunschorientiert**, **Ausgewogen** und **Verteilungsorientiert** können mit identischen absoluten Grenzen berechnet und verglichen werden. Angezeigt werden unzugeteilte Schüler, Erstwünsche, Regelabweichungen, Kursspannweite und die Zahl tatsächlich veränderter Schülerzuordnungen.

## Nicht zugeteilte Schüler

- vollständige Diagnose mit Person-ID, Name und Klasse
- bis zu drei getrennt auswählbare Vorschläge nur innerhalb der Wünsche
- direkte Zuteilung auf freie Wunschplätze
- einfacher Platztausch, falls dadurch ein Wunschplatz frei wird
- bewusst bestätigte manuelle Überbelegung
- laufende Aktualisierung aller offenen Fälle und Überbelegungen (`+1`, `+2`, …)
- geführter Prüfmodus Fall für Fall

Regulär umgesetzte Vorschläge werden als feste Setzungen vor einer späteren Neuberechnung geschützt. Überbelegungen werden protokolliert und markiert, aber nicht als automatische feste Setzung gespeichert, da sie die konfigurierte Maximalgröße bewusst überschreiten.

## Prüfung und Nachvollziehbarkeit

Mehrfachwünsche nennen Person-ID, Name, Klasse, Kurs und Wunschpositionen. Ein Änderungsprotokoll dokumentiert manuelle Zuordnungen, Tausche, Überbelegungen, feste Setzungen, Lösungsprofile und übernommene Planungsempfehlungen.
