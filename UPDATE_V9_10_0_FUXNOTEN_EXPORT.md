# V9.10.0 – FuxNoten-Excel-Export

Nach einer erfolgreichen ProFlex-Verteilung kann im Ergebnisbereich eine strikt strukturierte XLSX für das nachgelagerte FuxNoten-Importtool erzeugt werden.

## Tabellenblätter

Die Datei enthält exakt:

1. `ProFlex_Kurse`
2. `ProFlex_Teilnehmer`

Es werden keine weiteren Blätter, Zusatzzeilen, verbundenen Zellen, Kommentare oder kombinierten Schüler-/Lehrkraftlisten erzeugt.

## Exportmaske

- Eindeutige Kurs-IDs werden initial als `PF-01`, `PF-02` usw. vergeben.
- Kurs-IDs und Lehrkraftangaben werden im Projekt gespeichert und bei späteren Exporten wiederverwendet.
- Kursname und Jahrgangsbereich werden aus dem Angebot vorbelegt und können für den FuxNoten-Export angepasst werden.
- HJ1 und HJ2 sind standardmäßig für alle stattfindenden Kurse aktiviert.
- Lehrer 1, Lehrer 2 und Lehrer 3 werden in getrennten Feldern erfasst.
- Individuelle Halbjahreswechsel sind optional möglich. Ein Schüler erhält dann pro Kurs eine eigene Zeile mit `X` nur im zutreffenden Halbjahr.
- Doppelte oder fehlende Kurs-IDs, fehlende Pflichtangaben und widersprüchliche Halbjahreszuordnungen blockieren den Download mit einer konkreten Meldung.
- Unzugeteilte Schüler werden nicht als Teilnehmerzeile exportiert und in der Exportmaske ausgewiesen.

Die normale Projekt-Excel-Datei und die neue FuxNoten-Datei bleiben getrennte Exporte.
