# V9.8.2 – schnellere Jahrgangsgruppen-Suche

Diese Version ändert ausschließlich die technische Ausführung der bestehenden Jahrgangsgruppen-Suche.

## Optimierung

- Jahrgangszugehörigkeit und zulässige Kurse werden pro Berechnung einmal vorbereitet.
- Wunschkosten und Zustands-Hashwerte werden wiederverwendet.
- Ein Kandidatenzug berechnet nur die betroffenen Kurse neu.
- Kursauslastungen und Jahrgangsgruppenzahlen werden inkrementell fortgeschrieben.
- Unveränderte Kurse werden nicht erneut analysiert.

Suchbreite, Reparaturschritte, Prioritäten, Regelwirkung, Warnungen und Ergebnisvergleich wurden nicht verändert.

## Nachweis

Der Benchmark `scripts/benchmark-grade-groups.mjs` erzeugt einen deterministischen Belastungsfall und gibt neben der Laufzeit einen SHA-256-Fingerabdruck der Zuteilung aus.

Referenzaufruf:

```bash
npm run benchmark:grade-groups -- 80 8 fast
```

Beim Entwicklungsvergleich blieb der Fingerabdruck exakt gleich. Die Laufzeit sank auf dem verwendeten System von rund 5,3 auf rund 1,7 Sekunden – etwa Faktor 3. Abweichende Geräte und Datensätze können andere Laufzeiten ergeben.
