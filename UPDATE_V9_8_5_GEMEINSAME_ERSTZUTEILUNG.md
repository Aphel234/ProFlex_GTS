# V9.8.5 – gemeinsame Erstzuteilung

Die erste automatische Zuteilung wird nun in einem gemeinsamen globalen Kostenfluss berechnet. Kursmindestplätze und alle weiteren Plätze konkurrieren darin gleichzeitig um dieselben Schüler.

## Wirkung

- Knappe Plätze bleiben für Schüler erhalten, die keine geeignete Alternative haben.
- Vielseitige Schüler können unmittelbar einem anderen Wunsch zugeordnet werden.
- Kursmindestbelegungen werden im selben Modell wie Wunschqualität, Restkapazitäten und Kursausgleich berücksichtigt.
- Nichtzuteilungen bleiben weiterhin die wichtigste zu minimierende Größe.

## Sicherheitsvergleich

Die bisherige zweistufige Berechnung wird intern weiterhin ausgeführt. Beide Ergebnisse werden mit derselben Prioritätsfolge verglichen:

1. Zahl der nicht zugeteilten Schüler
2. Abweichung von Kursmindestzielen
3. Wunschqualität
4. Verteilung von Dritt- und Viertwünschen
5. Kursausgleich

Nur wenn die gemeinsame Zuteilung mindestens gleich gut ist, wird sie übernommen. Kapazitäten, Kurszugang, Sperrungen und feste Setzungen werden vor der Übernahme erneut geprüft.

## Prüfung

Ein neuer Regressionstest bildet den kritischen Fall ab: Ein flexibler Schüler kann Kurs A oder B besuchen, ein anderer ausschließlich Kurs A. Das gemeinsame Modell setzt den flexiblen Schüler in B und reserviert A für den gebundenen Schüler. Beide Mindestbelegungen werden erfüllt und niemand bleibt unzugeteilt.
