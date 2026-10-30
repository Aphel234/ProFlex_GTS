# ProFlex / GTS / Angebotsmanager

Statische Browseranwendung für bis zu **500 Teilnehmende und 30 Durchführungen**. Die Berechnung läuft vollständig im Browser; ein eigener Server ist nicht erforderlich.

## Neu in dieser Version

### Allgemeine Angebotsplanung und toleranter Einwahlimport (Version 9.11.0)

Die Anwendung verwendet in der Oberfläche durchgängig die allgemeinen Begriffe **Angebot**, **Durchführung**, **Teilnehmende** und **Zuteilung**. Acht klar getrennte Bereiche bündeln Übersicht, Angebote, Teilnehmende, Einwahl, Zuteilung, Auswertung, Datenaustausch und Einstellungen.

Neue Projekte starten ohne Beispieldaten. Schulprojekte können eine Klasse verlangen; für Fortbildungen und allgemeine Veranstaltungen ist die Klassenangabe optional. Klassen mit abschließendem `G/g` werden als gymnasial erkannt, andere vorhandene Klassenbezeichnungen als regional.

Der Umfrageimport akzeptiert ein bis vier Wunschspalten, Überschriften wie `Erstwunsch` oder `Wunsch 1`, kombinierte Namen im Format `Nachname, Vorname` und beliebig platzierte Zeitstempel. Mehrfachwünsche werden nur einmal gewertet und zusammen mit unvollständigen Einwahlen, fehlenden Klassen und unbekannten Angeboten namentlich in der Datenprüfung angezeigt.

Unter **Vorlagen & Datenaustausch** stehen eine Angebots-Zulieferervorlage, eine Schüler-/Klassenlistenvorlage, eine Umfragevorlage, die vollständige Projektvorlage sowie die bisherigen Sicherungen, Listen und FuxNoten-Exporte zur Verfügung. Alte Projektdateien und Bezeichnungen wie `Workshops`, `Workshop-ID` oder `Kursart-ID` bleiben importierbar.

### Frühere Umbenennung (Version 9.10.1)

In V9.10.1 hieß die Anwendung vorübergehend **ProFlex / GTS / Workshop Manager**. Seit V9.11.0 lautet der allgemeine Name **ProFlex / GTS / Angebotsmanager**. Interne Speicherschlüssel sowie die fest vereinbarten FuxNoten-Blattnamen bleiben unverändert, damit bestehende Projekte und der nachgelagerte Import kompatibel bleiben.

### FuxNoten-Excel-Export (Version 9.10.0)

Nach einer berechneten Verteilung steht im Ergebnisbereich **„FuxNoten-Excel erstellen“** zur Verfügung. Die Exportmaske vergibt und speichert eindeutige Kurs-IDs, übernimmt Kursname und Jahrgangsbereich, erfasst HJ1/HJ2 sowie bis zu drei Lehrkräfte in getrennten Feldern und unterstützt optionale individuelle Halbjahreswechsel.

Die erzeugte XLSX enthält exakt zwei Tabellenblätter: `ProFlex_Kurse` und `ProFlex_Teilnehmer`. Kopfzeilen, Reihenfolge und Einzelzeilen entsprechen dem vereinbarten FuxNoten-Importformat; es werden keine zusätzlichen Blätter, Überschriftszeilen, verbundenen Zellen, Kommentare oder Listen in Einzelzellen erzeugt.

### Kompaktere Kurstabelle (Version 9.9.2)

Die Bearbeitungsfelder für Durchführungs-ID, Kursart-ID, Gruppe, Klassenbereich, Bildungsgang, Kohortenminimum sowie Mindest- und Maximalbelegung sind jetzt an die typischen Eingabelängen angepasst. Dadurch sind mehr Spalten gleichzeitig sichtbar und die horizontale Scrollstrecke ist deutlich kürzer. Auf schmalen Bildschirmen bleibt horizontales Scrollen als Sicherheitsnetz erhalten.

### Neuer Anwendungsname (Version 9.9.1)

In V9.9.1 wurde die Anwendung zunächst in **ProFlex / Workshop Planer** umbenannt. Diese historische Bezeichnung wurde mit V9.10.1 durch **ProFlex / GTS / Workshop Manager** und mit V9.11.0 durch **ProFlex / GTS / Angebotsmanager** ersetzt.

Die bisherigen internen Browser-Speicherschlüssel bleiben absichtlich unverändert. Dadurch werden vorhandene lokal gespeicherte Projekte weiterhin gefunden; auch alte JSON- und Excel-Dateien bleiben kompatibel.

### Regelbewusste globale Optimierung (Version 9.9.0)

Nach der gemeinsamen Erstzuteilung und der bewährten Reparaturkette erzeugt der Solver nun zusätzliche vollständige Mehrkurs-Verteilungen, in denen Wünsche, Jahrgangsgrenzen, Mindestgruppen, Jahrgangsgruppen-Regel und weitere Zusammensetzungsregeln gleichzeitig bewertet werden. Dadurch können gekoppelte Verschiebungen über mehrere Kurse gefunden werden, die bei einer rein nacheinander arbeitenden Reparaturfolge verborgen bleiben.

Die neue Suche besteht aus einem skalierbaren globalen Kostenfluss und einer adaptiven Mehrschritt-Koordination für kleine Restkonflikte. Interne Zwischenstände dürfen vorübergehend ein Kursmindestziel unterschreiten, werden jedoch niemals als Ergebnis angeboten. Nur wieder vollständig zulässige Verteilungen gelangen in die Kandidatenauswahl. Dort gelten unverändert: möglichst wenige Nichtzuteilungen, danach Kursmindestziele und anschließend die über den Prozentregler gewichtete Abwägung zwischen Wünschen und Zusammensetzungsregeln.

### Gemeinsame Erstzuteilung (Version 9.8.5)

Kursmindestplätze und alle übrigen Plätze werden nun in einem einzigen globalen Kostenfluss vergeben. Dadurch kann der Solver gleichzeitig erkennen, welcher Schüler einen knappen Kursplatz besonders benötigt und welcher Schüler auf einen anderen Wunsch ausweichen kann. Die frühere Zweiphasenlogik konnte einen vielseitigen Schüler bereits für ein Kursminimum binden und dadurch eine später nicht mehr korrigierbare schlechtere Zuteilung erzeugen.

Die bisherige Zweiphasenberechnung bleibt intern als Sicherheitsvergleich erhalten. Das neue gemeinsame Ergebnis wird nur übernommen, wenn es nach derselben Prioritätsfolge mindestens gleich gut ist: zuerst möglichst wenige Nichtzuteilungen, dann Kursmindestziele, Wunschqualität, Verteilung schlechterer Wünsche und Kursausgleich. Kapazitäten, Kurszugang, Sperrungen und feste Setzungen bleiben unverändert verbindlich.

### Gemeinsame Logik für Jahrgang + Bildungsgang (Version 9.8.4)

Die globale beziehungsweise kursbezogene **Mindestgruppe Jahrgang + Bildungsgang** und die flexible Regel **Jahrgang + Bildungsgang** verwenden nun dieselbe Prüfung und dieselbe Reparaturtechnik. Beide Einstellmöglichkeiten bleiben in der Oberfläche unverändert erhalten.

Überlappende Vorgaben werden zusammengeführt: Identische harte Mindestzahlen werden nur einmal berechnet, gezählt und gemeldet. Bei unterschiedlichen harten Mindestzahlen gilt die stärkere. Ein höheres bevorzugtes Ziel wird erst dann bewertet, wenn das harte Minimum bereits erfüllt ist. Dadurch entstehen keine doppelten Warnungen oder doppelten Strafwerte für dieselbe Gruppe.

### Reparaturkette bis zur Stabilität (Version 9.8.3)

Kohorten, Jahrgangsgrenzen, vorrangige und bevorzugte Zusammensetzungsregeln sowie die Jahrgangsgruppen-Regel werden nicht mehr nur einmal nacheinander geprüft. Hat eine spätere Reparatur eine frühere Regel erneut verschlechtert, startet die gesamte Kette mit der veränderten Zuteilung erneut.

Die Suche endet, sobald alle Zusammensetzungsregeln erfüllt sind, keine Zuteilung mehr verändert wird, ein bereits bekannter Zustand wiederkehrt oder die Sicherheitsgrenze von acht Gesamtrunden erreicht ist. Sämtliche Zwischenstände bleiben als Kandidaten erhalten; übernommen wird weiterhin die nach dem Prozentregler beste vollständige Lösung. Im neuen Konflikttest sinkt die Regelabweichung dadurch von 16 auf 10, ohne einen Schüler unzugeteilt zu lassen.

### Schnellere Jahrgangsgruppen-Suche (Version 9.8.2)

Die globale Suche der Jahrgangsgruppen-Regel bewertet Kandidatenzüge jetzt inkrementell: Jahrgangszugehörigkeit, zulässige Kurse, Wunschkosten und Kursauslastungen werden einmal vorbereitet; anschließend werden nur noch die ein oder zwei tatsächlich betroffenen Kurse neu geprüft. Suchbreite, Prioritäten, Regelwirkung und Auswahl des Ergebnisses bleiben unverändert.

Der mitgelieferte reproduzierbare Benchmark kann mit `npm run benchmark:grade-groups -- 80 8 fast` ausgeführt werden. Im Referenzfall sank die Laufzeit bei identischem Zuteilungs-Fingerabdruck von rund 5,3 auf rund 1,7 Sekunden – etwa Faktor 3. Die konkrete Laufzeit hängt von Gerät und Datensatz ab.

### Sichtbarer Lösungsvergleich (Version 9.8.1)

Der Vergleich der drei Lösungsprofile zeigt nun sofort einen Fortschritt von 1 bis 3, benennt das gerade berechnete Profil und deaktiviert den Knopf bis zum Abschluss. Für einen verlässlichen und zugleich handhabbaren Vergleich werden je Profil sechs Varianten geprüft – auch wenn die normale Berechnungsqualität auf „Gründlich“ steht. Ein unerwarteter Abbruch wird direkt im Vergleichsbereich erklärt.

### Planungszentrale und geführte Nachbearbeitung (Version 9.8)

Der neue Bereich **Planung** fasst Nachfrage und Beliebtheit jeder Kursart zusammen: Wunschpositionen, zulässige und kritische Nachfrage, Gesamtkapazität, tatsächliche Belegung und Kapazitätsdruck. Globale Engpässe werden mit konkreten Maßnahmen und – nach einer vorhandenen Berechnung – einer Wirkungsvorschau angezeigt.

Mit **Drei Lösungen vergleichen** werden eine wunschorientierte, eine ausgewogene und eine verteilungsorientierte Lösung nebeneinandergestellt. Die Anwendung nennt ausdrücklich, wie viele Schülerzuordnungen sich unterscheiden oder ob die Einstellungen bei den aktuellen Daten zum gleichen Ergebnis führen.

Unzugeteilte Schüler erhalten einen geführten Prüfmodus mit Name, Klasse, vollständigem Grund und bis zu drei einzeln auswählbaren Vorschlägen ausschließlich innerhalb ihrer Wünsche. Freie Plätze, einfache Platztausche und ausdrücklich bestätigte manuelle Überbelegungen können direkt umgesetzt werden. Überbelegungen werden bei jeder weiteren Prüfung mit der aktuellen Abweichung `+1`, `+2` usw. ausgewiesen. Manuelle Entscheidungen und Planungseingriffe stehen im Änderungsprotokoll; regulär umgesetzte Vorschläge werden als feste Setzung geschützt.

Validierungswarnungen zu mehrfach eingetragenen Wünschen nennen nun Person-ID, Namen, Klasse, Kurs und betroffene Wunschpositionen.

### Unerreichbare Kursmindestzahlen blockieren nicht mehr (Version 9.6.2)

Der Solver versucht Kursmindestzahlen weiterhin zuerst exakt zu erfüllen. Ist das mit Teilnehmerzahl, Wünschen, Zugangsbedingungen, Sperrungen und festen Setzungen nicht möglich, startet automatisch ein Bestmöglich-Durchlauf. Alle zulässig zuordenbaren Schüler bleiben zugeteilt; unterbesetzte Pflichtkurse werden gelb mit Ist-Wert, Mindestziel und Abweichung gekennzeichnet.

Verbindlich bleiben Maximalbelegungen, Kurszugang, Sperrungen und feste Setzungen. Optionale Durchführungen dürfen weiterhin entfallen, wenn ihr Mindestziel nicht erreichbar ist.

### Jahrgangsregeln blockieren nicht mehr (Version 9.6.1)

Jahrgangs-Minima und -Maxima sind jetzt durchgehend bestmögliche Ziele. Sie erhöhen nicht mehr indirekt die gesamte Kursmindestbelegung und lösen vor der globalen Suche keinen Abbruch mehr aus. Sind beispielsweise für ein Jahrgangsminimum von 4 nur 2 zulässige Schüler verfügbar, werden diese 2 zugeteilt und die Abweichung wird gelb ausgewiesen.

Nur absolute Vorgaben dürfen weiterhin eine Berechnung verhindern: Kursmaximalbelegung, Kurszugang, Sperrungen und feste Setzungen. Eine unerreichbare Kursmindestzahl wird seit Version 9.6.2 als gelbe Zielabweichung ausgegeben.

### Gewichtung Wünsche ↔ Jahrgangsverteilung (Version 9.6)

Unter **Übersicht → Einstellungen** steht jetzt ein Regler von `0 %` bis `100 %` zur Verfügung:

- `0 %`: Wünsche werden maximal geschützt; unvermeidbare Jahrgangsabweichungen werden ausgewiesen.
- `50 %`: Wünsche und Jahrgangsverteilung werden ausgewogen berücksichtigt (empfohlen).
- `100 %`: Die bestmögliche Jahrgangsverteilung hat Vorrang vor der Wunschqualität.

Der Solver merkt sich während seiner Suche mehrere vollständige Zwischenlösungen und wählt anhand des Reglers die passendste aus. Die Gewichtung betrifft Jahrgangs-Minima/-Maxima, Kohorten-, Jahrgangsgruppen- und weitere Zusammensetzungsregeln. Unverändert absolut bleiben vollständige Zuteilung soweit ein zulässiger Platz existiert, Kapazitäten, Kurszugang, Sperrungen und feste Setzungen. Die Einstellung wird lokal und in JSON-Projektsicherungen gespeichert; alte Projekte starten automatisch mit `50 %`.

### Vollständige Bestmöglich-Zuteilung (Version 9.5)

Der Optimierer bevorzugt zuerst die Lösung mit den wenigsten unzugeteilten Schülern. Danach steuert in Version 9.6 der Gewichtungsregler den Zielkonflikt zwischen Regelabweichungen und Wünschen; anschließend wird der Kursausgleich bewertet.

Jahrgangs-Minima/-Maxima, Kohorten- und Gruppenregeln werden zunächst durch Verschieben, Tauschen und eine globale Kurssuche zu erfüllen versucht. Ist das nicht vollständig möglich, bleibt die bestmögliche zulässige Zuteilung erhalten. Das Programm nennt Kurs, Ist-Wert und Zielwert sowohl im Ergebnis als auch im Hinweisfeld der betroffenen Schüler. Verbindlich bleiben Kurskapazitäten, Kurszugang, Sperrungen, feste Setzungen sowie die gesamte Mindest-/Maximalbelegung.

### Jahrgangsgruppen-Regel

Pro Durchführung kann unter **Angebote → „Jahrgänge & Gruppen …“** die aktuelle Jahrgangsgruppen-Regel aktiviert werden:

- Jahrgänge **8+9 zusammen** müssen mit einer durch 4 teilbaren Schülerzahl vertreten sein.
- Jahrgang **10 aufwärts zusammen** muss ebenfalls durch 4 teilbar sein.
- Ein optionaler weicher Ausgleich bevorzugt möglichst ähnlich große Jahrgangsgruppen.

Die Regel wird vorrangig und bestmöglich eingehalten. Ist die Viererteilbarkeit wegen Kapazitäten, festen Setzungen, Sperrungen oder anderer Vorgaben unmöglich, werden die Schüler trotzdem zugeteilt und die kleinste Abweichung konkret ausgewiesen.

Die dynamische Excel-Vorlage sowie Excel-Import/-Export enthalten dafür in `Angebote` die Spalten **`Jahrgangsgruppen-Regel 8/9 + 10+`** und **`Gruppenausgleich`** mit `Ja`/`Nein`. Das alte Blatt `Workshops`, alte Überschriften und das alte JSON-Feld `debateRule` werden beim Import weiterhin erkannt.

### Kursart und Durchführung sind getrennt

Ein Wunsch bezieht sich auf eine **Kursart**. Mehrere Gruppen derselben Kursart verwenden dieselbe Kursart-ID.

Beispiel:

- Durchführungs-ID `W10A` · Kursart-ID `DRACH` · Drachenboot · Gruppe A
- Durchführungs-ID `W10B` · Kursart-ID `DRACH` · Drachenboot · Gruppe B

In der Kursanwahl erscheint nur `DRACH · Drachenboot`. Wird ein Teilnehmer anschließend Gruppe A oder B zugeteilt, zählt beides als derselbe Erst-/Zweit-/Dritt-/Viertwunsch.

Im Angebotsbereich erzeugt der **＋-Knopf** eine weitere Durchführung desselben Angebots.

### Mindestgruppe Jahrgang + Bildungsgang

Unter **Übersicht → Mindestgruppe Jahrgang + Bildungsgang** kann global z. B. `2`, `3` oder mehr eingestellt werden.

Regel pro Durchführung:

- eine Kombination wie `Jahrgang 9 / Regional` kommt gar nicht vor, **oder**
- sie muss mindestens die eingestellte Personenzahl erreichen.

Jede Durchführung kann den globalen Wert überschreiben:

- leeres Feld = globalen Wert verwenden
- `0` = Regel für diese Durchführung ausschalten
- `2`, `3`, `4` … = eigener Wert

Wenn die Regel mit Wünschen, Kapazitäten, festen Setzungen und Sperrungen nicht vollständig erfüllt werden kann, bleibt die bestmögliche Zuteilung erhalten und wird verständlich gekennzeichnet.

## Weitere Funktionen

- vier Wünsche pro Teilnehmer
- Klassenstufen und Bildungsgänge
- Pflicht- und optionale Durchführungen
- Mindest- und Maximalbelegung
- automatische Zielbelegung und Belastungsausgleich
- feste Setzungen auf eine konkrete Durchführung
- Sperrungen für konkrete Durchführungen
- dynamische Excel-Kursanwahl-Vorlage mit den aktuell angelegten Kursarten
- Excel-Import und Excel-Export
- JSON-Sicherung und Wiederherstellung
- Kurslisten und Klassenlisten als PDF-ZIP
- lokale Speicherung im Browser
- Offline-Nutzung nach dem ersten Laden

## Excel-Kursanwahl

Unter **Datenaustausch → Vollständige Projektvorlage** wird eine Excel-Datei mit den aktuell angelegten Angeboten erzeugt.

Die vier Wunschspalten enthalten **Kursart-IDs**, keine Durchführungs-IDs. Eine feste Setzung darf dagegen eine konkrete Durchführungs-ID enthalten.

Alte Dateien bleiben kompatibel: Überschriften wie `Schulform` und `Workshop-ID` werden weiterhin erkannt.

## Datenschutz

GitHub Pages veröffentlicht nur den Programmcode. Teilnehmerdaten werden im Browser gespeichert und für die Berechnung nicht an GitHub übertragen.

**Keine echten Schülerdaten als Excel-, JSON- oder PDF-Dateien in das GitHub-Repository hochladen.**

## Auf GitHub veröffentlichen

1. Repository anlegen bzw. vorhandenes Repository öffnen.
2. Den Inhalt dieses Ordners hochladen.
3. Unter **Settings → Pages → Source** `Deploy from a branch` auswählen.
4. Als Branch `main` und als Ordner `/docs` einstellen und speichern.
5. GitHub Pages veröffentlicht den bereits gebauten Ordner `docs` direkt.

Es ist auf GitHub keine `npm`-Installation notwendig.

## Technischer Hinweis

Der Optimierer verwendet eine Flussoptimierung für Wünsche, Mindestbelegungen und Kapazitäten. Bei schwierigen Jahrgangsgrenzen folgt eine globale Neuberechnung mit unteren und oberen Schranken für sämtliche Kurse. Erst wenn keine exakte Jahrgangsverteilung existiert, wird die kleinstmögliche Abweichung als gelber Hinweis ausgewiesen.

Die Tests decken u. a. ab:

- zwei Durchführungen derselben Kursart,
- identische Wunschwertung für Gruppe A/B,
- Kohortenminimum,
- nicht erfüllbare Kohortenregeln,
- Pflicht- und optionale Durchführungen,
- erfüllbare und nicht erfüllbare Jahrgangsgruppen-Regeln,
- Rückwärtskompatibilität alter Projekte.

## Lizenz

MIT

## Berechnungsqualität

Unter **Übersicht → Einstellungen** kann zwischen drei Qualitätsstufen gewählt werden:

- **Schnell** – 1 Berechnung
- **Standard** – 6 unterschiedliche Startvarianten; empfohlen
- **Gründlich** – 24 unterschiedliche Startvarianten

Die Anwendung behält automatisch die beste Verteilung: zuerst möglichst vollständig, dann mit möglichst wenigen und kleinen Regelabweichungen. Mindest- und Maximalbelegungen der Kurse bleiben in jeder Variante verbindlich.

## Vorrangige Regeln

Als **Vorrangig** markierte Zuteilungsregeln werden vor Wunschqualität und Belastungsausgleich behandelt. Die Optimierung versucht kleine Regelgruppen aktiv zu verstärken oder vollständig umzuverteilen. Eine nicht vollständig erfüllbare Regel führt zu einer gekennzeichneten Bestmöglich-Zuteilung und nicht zum Verlust ansonsten zulässiger Angebotsplätze.

## Mehrfach-Umfrageimport
Unter **Einwahl → Umfrage-Dateien importieren** können mehrere Excel-Umfrageexporte gemeinsam eingelesen werden. Die App gleicht Angebotskennungen und Namen mit den Angeboten im aktuellen Projekt ab, zeigt unsichere Treffer zur Prüfung und erkennt mögliche Dubletten über Vorname + Nachname + Klasse. Person-IDs werden automatisch vergeben.

## Jahrgangsbelegung pro Kurs (seit Version 2.3, globale Suche ab 9.4)

In **Angebote** gibt es pro Durchführung den Knopf **„Jahrgänge & Gruppen …“**. Dort können für jeden zugelassenen Jahrgang getrennte Mindest- und Höchstziele festgelegt werden.

- Minimum leer = keine Mindestvorgabe
- Maximum leer = keine Höchstvorgabe
- Minimum `7`, Maximum leer = mindestens 7 Schüler dieses Jahrgangs müssen in diesen Kurs
- Minimum leer, Maximum `4` = höchstens 4 Schüler dieses Jahrgangs dürfen in diesen Kurs
- Minimum `2`, Maximum `5` = zwischen 2 und 5 Schüler dieses Jahrgangs

Diese Grenzen werden zuerst **vorrangig** gesucht und gelten zusätzlich zur gesamten Mindest-/Maximalbelegung, zu Sperrungen, festen Setzungen und anderen Regeln. Ist keine exakte Jahrgangsverteilung möglich, wird die Berechnung nicht abgebrochen: Das Programm liefert die Lösung mit der kleinsten Abweichung und kennzeichnet sie deutlich als Hinweis.

Die Excel-Vorlage sowie Excel-Import/-Export unterstützen dafür das Blatt **`Jahrgangsbelegung`** mit den Spalten `Durchführungs-ID | Jahrgang | Minimum | Maximum`.
