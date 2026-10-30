(() => {
  "use strict";

  const STORAGE_KEY = "workshop-zuteilung-github-pages-v2";
  const LEGACY_STORAGE_KEY = "workshop-zuteilung-github-pages-v1";
  let current = null;

  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/ß/g, "ss")
      .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u")
      .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  }

  function normalizeClass(value) {
    return normalizeText(value).replace(/\s+/g, "");
  }

  function personKey(person) {
    return `${normalizeText(person.firstName)}|${normalizeText(person.lastName)}|${normalizeClass(person.className)}`;
  }

  function nameKey(person) {
    return `${normalizeText(person.firstName)}|${normalizeText(person.lastName)}`;
  }

  function levenshtein(a, b) {
    a = normalizeText(a); b = normalizeText(b);
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      let diagonal = prev[0]; prev[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const above = prev[j];
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
        diagonal = above;
      }
    }
    return prev[b.length];
  }

  function similarity(a, b) {
    const aa = normalizeText(a), bb = normalizeText(b);
    if (!aa || !bb) return 0;
    if (aa === bb) return 1;
    return Math.max(0, 1 - levenshtein(aa, bb) / Math.max(aa.length, bb.length));
  }

  function personSimilarity(a, b) {
    const first = similarity(a.firstName, b.firstName);
    const last = similarity(a.lastName, b.lastName);
    const full = similarity(`${a.firstName} ${a.lastName}`, `${b.firstName} ${b.lastName}`);
    return Math.max(full, first * 0.38 + last * 0.62);
  }

  function loadProject() {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return { name: "Neue Veranstaltung", settings: { classRequired: true, expectedWishes: 3 }, workshops: [], participants: [] };
    try { return JSON.parse(raw); } catch { return { name: "Neue Veranstaltung", settings: { classRequired: true, expectedWishes: 3 }, workshops: [], participants: [] }; }
  }

  function showError(message) {
    const dialog = $("#messageDialog"), title = $("#dialogTitle"), body = $("#dialogBody");
    if (!dialog || !title || !body) return alert(message);
    title.textContent = "Einwahlkontrolle";
    body.innerHTML = `<div class="message error">${escapeHtml(message)}</div>`;
    dialog.showModal();
  }

  function parseXml(text, source) {
    let clean = String(text ?? "").replace(/^\uFEFF/, "");
    clean = clean.replace(/^[\u0000-\u0020]+(?=<\?xml)/, "");
    const doc = new DOMParser().parseFromString(clean, "application/xml");
    const error = doc.querySelector("parsererror");
    if (error) throw new Error(`${source} konnte nicht gelesen werden.`);
    return doc;
  }

  function localName(node) { return node?.localName || String(node?.nodeName || "").split(":").pop(); }
  function elements(root, name) { return [...root.getElementsByTagName("*")].filter((el) => localName(el) === name); }
  function textOf(node) { return node?.textContent ?? ""; }
  function colIndex(ref) {
    const letters = String(ref || "").match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "";
    let n = 0; for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64; return n;
  }
  function zipPath(base, target) {
    let path = String(target || "").replace(/^\//, "");
    if (path.startsWith("xl/")) return path;
    const parts = base.split("/").slice(0, -1);
    while (path.startsWith("../")) { parts.pop(); path = path.slice(3); }
    return [...parts, path].join("/").replace(/\/+/g, "/");
  }

  async function sharedStrings(zip) {
    const file = zip.file("xl/sharedStrings.xml"); if (!file) return [];
    const doc = parseXml(await file.async("text"), "sharedStrings.xml");
    return elements(doc, "si").map((si) => elements(si, "t").map(textOf).join(""));
  }

  async function sheetMap(zip) {
    const wb = zip.file("xl/workbook.xml"), rel = zip.file("xl/_rels/workbook.xml.rels");
    if (!wb || !rel) throw new Error("Die Datei ist keine lesbare XLSX-Arbeitsmappe.");
    const wbDoc = parseXml(await wb.async("text"), "workbook.xml");
    const relDoc = parseXml(await rel.async("text"), "workbook.xml.rels");
    const rels = new Map();
    for (const r of elements(relDoc, "Relationship")) rels.set(r.getAttribute("Id"), zipPath("xl/workbook.xml", r.getAttribute("Target")));
    const map = new Map();
    for (const s of elements(wbDoc, "sheet")) {
      const name = s.getAttribute("name") || "";
      const id = s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || s.getAttribute("r:id") || s.getAttribute("id");
      if (name && rels.get(id)) map.set(name, rels.get(id));
    }
    return map;
  }

  async function readSheet(zip, path, strings) {
    const file = zip.file(path); if (!file) return [];
    const doc = parseXml(await file.async("text"), path);
    const rows = [];
    for (const rowEl of elements(doc, "row")) {
      const rn = Number(rowEl.getAttribute("r")) || rows.length + 1;
      const values = [];
      for (const c of [...rowEl.children].filter((el) => localName(el) === "c")) {
        const idx = colIndex(c.getAttribute("r")); if (!idx) continue;
        const type = c.getAttribute("t") || "";
        const v = [...c.children].find((el) => localName(el) === "v");
        const inline = [...c.children].find((el) => localName(el) === "is");
        let value = "";
        if (type === "s") value = strings[Number(textOf(v))] ?? "";
        else if (type === "inlineStr") value = inline ? elements(inline, "t").map(textOf).join("") : "";
        else value = textOf(v);
        values[idx - 1] = value;
      }
      rows[rn - 1] = values;
    }
    return rows;
  }

  function headerScore(value, field) {
    const h = normalizeText(value);
    const compact = h.replace(/\s+/g, "");
    if (!h) return 0;

    if (field === "first") {
      if (["vorname", "vornamen", "rufname", "firstname", "givenname"].includes(compact)) return 120;
      if (h.includes("vorname") || h.includes("vornamen") || h.includes("rufname")) return 115;
      if (h.includes("first name") || h.includes("given name")) return 110;
      if (compact === "vn") return 70;
      return 0;
    }

    if (field === "last") {
      if (["nachname", "familienname", "familiennamen", "lastname", "surname"].includes(compact)) return 120;
      // FuxSchool-Exporte verwenden häufig schlicht „Name“ für den Nachnamen.
      if (compact === "name") return 112;
      if (h.includes("nachname") || h.includes("familienname") || h.includes("familien namen")) return 118;
      if (h.includes("last name") || h.includes("surname")) return 112;
      if (h.includes("schulername") || h.includes("schuelername") || h.includes("name schuler") || h.includes("name schueler")) return 100;
      if (["famname", "famname", "fn"].includes(compact)) return 72;
      return 0;
    }

    if (field === "class") {
      if (["klasse", "klassenbezeichnung", "klassenname", "schulklasse", "class"].includes(compact)) return 120;
      if (["kl", "klassekurs", "klasselerngruppe", "lerngruppe"].includes(compact)) return 108;
      if (h.includes("klasse") || h.includes("lerngruppe")) return 115;
      if (h.includes("class")) return 100;
      return 0;
    }
    return 0;
  }

  function findRosterHeader(rows, classRequired = true) {
    let best = null;
    for (let i = 0; i < Math.min(rows.length, 30); i += 1) {
      const row = rows[i] || [];
      const firstScores = row.map((v) => headerScore(v, "first"));
      const lastScores = row.map((v) => headerScore(v, "last"));
      const classScores = row.map((v) => headerScore(v, "class"));

      for (let first = 0; first < row.length; first += 1) {
        if (firstScores[first] < 60) continue;
        for (let last = 0; last < row.length; last += 1) {
          if (last === first || lastScores[last] < 60) continue;
          const classCandidates = classRequired ? row.map((_, index) => index) : [-1, ...row.map((_, index) => index)];
          for (const cls of classCandidates) {
            if (cls < 0) {
              const score = firstScores[first] + lastScores[last];
              if (!best || score > best.score) best = { row: i, first, last, cls, score, headers: { first: String(row[first] ?? "").trim(), last: String(row[last] ?? "").trim(), cls: "" } };
              continue;
            }
            if (cls === first || cls === last || classScores[cls] < 60) continue;
            const score = firstScores[first] + lastScores[last] + classScores[cls];
            if (!best || score > best.score) {
              best = {
                row: i, first, last, cls, score,
                headers: {
                  first: String(row[first] ?? "").trim(),
                  last: String(row[last] ?? "").trim(),
                  cls: String(row[cls] ?? "").trim(),
                },
              };
            }
          }
        }
      }
    }
    return best;
  }

  async function parseRosterFile(file, classRequired = true) {
    if (!window.JSZip) throw new Error("Die XLSX-Komponente konnte nicht geladen werden.");
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const strings = await sharedStrings(zip);
    const sheets = await sheetMap(zip);
    for (const [sheetName, path] of sheets.entries()) {
      const rows = await readSheet(zip, path, strings);
      const h = findRosterHeader(rows, classRequired); if (!h) continue;
      const records = [];
      for (let i = h.row + 1; i < rows.length; i += 1) {
        const row = rows[i] || [];
        const firstName = String(row[h.first] ?? "").trim();
        const lastName = String(row[h.last] ?? "").trim();
        const className = h.cls >= 0 ? String(row[h.cls] ?? "").trim() : "";
        if (!firstName && !lastName && !className) continue;
        if (!firstName || !lastName || (classRequired && !className)) continue;
        records.push({ firstName, lastName, className, sourceFile: file.name, sourceSheet: sheetName, sourceRow: i + 1 });
      }
      if (records.length) return records;
    }
    throw new Error(`${file.name}: Vorname und Nachname${classRequired ? " sowie Klasse" : ""} konnten nicht eindeutig erkannt werden. Unterstützt werden auch Überschriften wie „Name“, „Familienname“, „Vorname(n)“, „Kl.“ oder „Klassenbezeichnung“.`);
  }

  function exactDuplicateGroups(records, sourceType) {
    const groups = new Map();
    records.forEach((p, index) => {
      const key = personKey(p);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ p, index });
    });
    return [...groups.values()].filter((items) => items.length > 1).map((items) => ({
      sourceType,
      kind: "exact",
      items,
      label: `${items[0].p.firstName} ${items[0].p.lastName}`,
      className: items[0].p.className,
    }));
  }

  function nearDuplicateGroups(records, sourceType, exactGroups) {
    const exactPairs = new Set();
    for (const g of exactGroups) for (const a of g.items) for (const b of g.items) exactPairs.add([a.index,b.index].sort((x,y)=>x-y).join("|"));
    const groups = [];
    const limit = Math.min(records.length, 1000);
    for (let i = 0; i < limit; i += 1) {
      for (let j = i + 1; j < limit; j += 1) {
        if (normalizeClass(records[i].className) !== normalizeClass(records[j].className)) continue;
        if (exactPairs.has(`${i}|${j}`)) continue;
        const score = personSimilarity(records[i], records[j]);
        if (score >= 0.90) groups.push({ sourceType, kind: "near", items: [{p:records[i],index:i},{p:records[j],index:j}], label: `${records[i].firstName} ${records[i].lastName} ↔ ${records[j].firstName} ${records[j].lastName}`, className: records[i].className, score });
      }
    }
    return groups;
  }

  function uniqueByKey(records) {
    const map = new Map();
    for (const p of records) if (!map.has(personKey(p))) map.set(personKey(p), p);
    return [...map.values()];
  }

  function enrollmentIssues(person, project) {
    const issues = [...(person.enrollmentIssues || [])].filter(Boolean);
    const wishes = (person.wishes || []).map((wish) => String(wish || "").trim()).filter(Boolean);
    const positions = new Map();
    wishes.forEach((wish, index) => {
      if (!positions.has(wish)) positions.set(wish, []);
      positions.get(wish).push(index + 1);
    });
    for (const [wish, slots] of positions) if (slots.length > 1) issues.push(`Angebot ${wish} wurde als Wunsch ${slots.join(" und ")} mehrfach eingetragen.`);
    const expected = Math.max(1, Math.min(4, Number(project.settings?.expectedWishes) || 3));
    const unique = new Set(wishes);
    if (unique.size < expected) issues.push(`Nur ${unique.size} von ${expected} erwarteten unterschiedlichen Wünschen.`);
    const offers = new Set((project.workshops || []).map((offer) => offer.offerId));
    for (const wish of unique) if (!offers.has(wish)) issues.push(`Unbekanntes Angebot: ${wish}.`);
    if (project.settings?.classRequired !== false && !/^\d{1,2}/.test(String(person.className || "").trim())) issues.push("Klasse fehlt oder ist nicht auswertbar.");
    return [...new Set(issues)];
  }

  function buildComparison(rosterRecords, project) {
    const projectParticipants = project.participants || [];
    const rosterExactDupes = exactDuplicateGroups(rosterRecords, "Soll-Liste");
    const responseExactDupes = exactDuplicateGroups(projectParticipants, "Teilnehmende/Umfrage");
    const rosterNearDupes = nearDuplicateGroups(rosterRecords, "Soll-Liste", rosterExactDupes);
    const responseNearDupes = nearDuplicateGroups(projectParticipants, "Teilnehmende/Umfrage", responseExactDupes);
    const duplicateGroups = [...rosterExactDupes, ...responseExactDupes, ...rosterNearDupes, ...responseNearDupes];

    const roster = uniqueByKey(rosterRecords);
    const responses = uniqueByKey(projectParticipants);
    const used = new Set();
    const items = [];

    // 1) Exakte Treffer.
    const responseByKey = new Map(responses.map((p, index) => [personKey(p), { p, index }]));
    for (const r of roster) {
      const exact = responseByKey.get(personKey(r));
      if (exact && !used.has(exact.index)) {
        used.add(exact.index);
        items.push({ type: "matched", roster: r, response: exact.p, score: 1, note: "Eindeutiger Treffer" });
      } else {
        items.push({ type: "unresolved", roster: r, response: null, score: 0, note: "" });
      }
    }

    // 2) Fuzzy-Matching innerhalb gleicher Klasse; identischer Name mit abweichender Klasse nur zur Prüfung.
    for (const item of items.filter((x) => x.type === "unresolved")) {
      const candidates = responses.map((p, index) => ({ p, index, score: personSimilarity(item.roster, p), sameClass: normalizeClass(item.roster.className) === normalizeClass(p.className), sameName: nameKey(item.roster) === nameKey(p) }))
        .filter((c) => !used.has(c.index) && ((c.sameClass && c.score >= 0.84) || (c.sameName && c.score >= 0.98)))
        .sort((a,b) => (b.sameClass - a.sameClass) || b.score - a.score);
      const best = candidates[0], second = candidates[1];
      if (best && (!second || best.score - second.score >= 0.025 || (best.sameClass && !second.sameClass))) {
        used.add(best.index);
        item.type = "review";
        item.response = best.p;
        item.responseIndex = best.index;
        item.score = best.score;
        item.note = best.sameClass ? "Name ähnlich – bitte prüfen" : "Name gleich, Klasse abweichend – bitte prüfen";
      } else {
        item.type = "missing";
        item.note = "Keine passende Umfrageeingabe gefunden";
      }
    }

    for (const item of items) {
      if (!item.response) continue;
      item.enrollmentIssues = enrollmentIssues(item.response, project);
      if (item.type === "matched" && item.enrollmentIssues.length) {
        item.type = "invalid";
        item.note = item.enrollmentIssues.join(" ");
      }
    }
    const extras = responses.map((p, index) => ({ p, index })).filter(({index}) => !used.has(index)).map(({p,index}) => {
      const issues = enrollmentIssues(p, project);
      return { type: "extra", response: p, responseIndex: index, enrollmentIssues: issues, note: issues.length ? `Nicht in der Soll-Liste gefunden. ${issues.join(" ")}` : "Nicht in der Soll-Liste eindeutig gefunden" };
    });
    return { roster, responses, items, extras, duplicateGroups };
  }

  function allRows() {
    if (!current) return [];
    const base = [...current.items, ...current.extras];
    const duplicateRows = current.duplicateGroups.map((g, i) => ({ type: "duplicates", duplicate: g, duplicateIndex: i }));
    return [...base, ...duplicateRows];
  }

  function stats() {
    const matched = current.items.filter((x) => x.type === "matched").length;
    const review = current.items.filter((x) => x.type === "review").length;
    const invalid = current.items.filter((x) => x.type === "invalid").length;
    const missing = current.items.filter((x) => x.type === "missing").length;
    return { total: current.roster.length, matched, review, invalid, missing, extra: current.extras.length, duplicates: current.duplicateGroups.length };
  }

  function statusBadge(type) {
    if (type === "matched") return '<span class="badge good">Teilgenommen</span>';
    if (type === "invalid") return '<span class="badge bad">Fehlerhafte Einwahl</span>';
    if (type === "review") return '<span class="badge warn">Zu prüfen</span>';
    if (type === "missing") return '<span class="badge bad">Fehlt</span>';
    if (type === "extra") return '<span class="badge warn">Nur in Umfrage</span>';
    return '<span class="badge warn">Doppelte Eingabe</span>';
  }

  function personHtml(p) {
    if (!p) return "–";
    return `<strong>${escapeHtml(`${p.firstName} ${p.lastName}`)}</strong><small class="person-class">Klasse ${escapeHtml(p.className)}</small>`;
  }

  function render() {
    if (!current) return;
    const s = stats();
    $("#attendanceSummary").innerHTML = `
      <div class="stat"><strong>${s.total}</strong><span>Personen der Soll-Liste</span></div>
      <div class="stat"><strong>${s.matched}</strong><span>Teilgenommen</span></div>
      <div class="stat"><strong>${s.invalid}</strong><span>Fehlerhafte Einwahl</span></div>
      <div class="stat"><strong>${s.review}</strong><span>Zu prüfen</span></div>
      <div class="stat"><strong>${s.missing}</strong><span>Fehlen</span></div>
      <div class="stat"><strong>${s.duplicates}</strong><span>Dublettengruppen</span></div>`;

    const issues = [];
    if (s.review) issues.push(`${s.review} Namenszuordnung(en) müssen geprüft werden.`);
    if (s.invalid) issues.push(`${s.invalid} Einwahl(en) enthalten fehlende, doppelte oder unbekannte Wünsche.`);
    if (s.duplicates) issues.push(`${s.duplicates} doppelte oder sehr ähnliche Eingabe(n) wurden erkannt.`);
    if (!s.missing && !s.review && !s.invalid) issues.push("Alle Personen der Soll-Liste konnten eindeutig zugeordnet werden und haben eine plausible Einwahl.");
    $("#attendanceIssues").innerHTML = issues.map((x) => `<div class="message ${x.includes("müssen") || x.includes("doppelte") ? "warning" : ""}">${escapeHtml(x)}</div>`).join("");

    const filter = $("#attendanceFilter").value;
    let rows = allRows();
    if (filter !== "all") rows = rows.filter((r) => r.type === filter);

    $("#attendanceTable").innerHTML = `<thead><tr><th>Status</th><th>Soll-Liste</th><th>Umfrage/Teilnehmende</th><th>Hinweis</th><th>Aktion</th></tr></thead><tbody>${rows.map((row) => {
      if (row.type === "duplicates") {
        const g = row.duplicate;
        const persons = g.items.map((x) => personHtml(x.p)).join('<span class="duplicate-separator">↔</span>');
        const detail = g.kind === "exact" ? `Exakt doppelt in ${g.sourceType}` : `Sehr ähnlich in ${g.sourceType} (${Math.round((g.score || 0) * 100)} %)`;
        return `<tr><td>${statusBadge(row.type)}</td><td colspan="2"><div class="duplicate-people">${persons}</div></td><td>${escapeHtml(detail)}</td><td>Bitte prüfen</td></tr>`;
      }
      const action = row.type === "review" ? `<div class="review-actions"><button type="button" class="button compact-button" data-attendance-confirm>Gleiche Person</button><button type="button" class="button compact-button" data-attendance-reject>Nicht identisch</button></div>` : "";
      const score = row.type === "review" ? ` · ${Math.round(row.score * 100)} % Ähnlichkeit` : "";
      const id = current.items.indexOf(row);
      return `<tr data-attendance-index="${id}"><td>${statusBadge(row.type)}</td><td>${personHtml(row.roster)}</td><td>${personHtml(row.response)}</td><td>${escapeHtml(row.note)}${score}</td><td>${action}</td></tr>`;
    }).join("") || '<tr><td colspan="5" class="muted">Keine Einträge in dieser Ansicht.</td></tr>'}</tbody>`;
    $("#attendanceExportMissingBtn").disabled = s.missing === 0;
  }

  function rejectReview(item) {
    if (!item || item.type !== "review") return;
    const response = item.response;
    item.type = "missing"; item.response = null; item.note = "Als nicht identisch markiert";
    if (response) current.extras.push({ type: "extra", response, note: "Bei Namensprüfung als andere Person markiert" });
    render();
  }

  function confirmReview(item) {
    if (!item || item.type !== "review") return;
    item.type = "matched"; item.note = "Manuell als gleiche Person bestätigt"; item.score = 1;
    render();
  }

  function xmlEscape(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }
  function colName(n) {
    let s = ""; while (n > 0) { n -= 1; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); } return s;
  }
  async function simpleXlsx(headers, rows, sheetName = "Kontrollliste") {
    const zip = new JSZip();
    const all = [headers, ...rows];
    const sheetRows = all.map((row, ri) => `<row r="${ri+1}">${row.map((value, ci) => `<c r="${colName(ci+1)}${ri+1}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`).join("")}</row>`).join("");
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
    zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`);
    zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`);
    return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  async function exportMissing() {
    if (!current) return;
    const missing = current.items.filter((x) => x.type === "missing").map((x) => x.roster);
    if (!missing.length) return;
    const blob = await simpleXlsx(["Vorname", "Nachname", "Klasse"], missing.map((p) => [p.firstName, p.lastName, p.className]), "Fehlende Personen");
    downloadBlob(blob, "Fehlende_Personen_Einwahl.xlsx");
  }

  function statusText(type) {
    return ({ matched: "Teilgenommen", invalid: "Teilgenommen – fehlerhafte Einwahl", review: "Zu prüfen", missing: "Keine Einwahl", extra: "Nur in der Umfrage", duplicates: "Doppelte Eingabe" })[type] || type;
  }

  async function exportAll() {
    if (!current) return;
    const rows = [...current.items, ...current.extras].map((item) => {
      const person = item.roster || item.response || {};
      return [person.lastName || "", person.firstName || "", person.className || "", statusText(item.type), item.note || ""];
    });
    for (const group of current.duplicateGroups) {
      const detail = group.kind === "exact"
        ? `Exakt doppelt in ${group.sourceType}`
        : `Sehr ähnlich in ${group.sourceType} (${Math.round((group.score || 0) * 100)} %)`;
      for (const item of group.items) {
        const person = item.p || {};
        rows.push([person.lastName || "", person.firstName || "", person.className || "", statusText("duplicates"), detail]);
      }
    }
    const blob = await simpleXlsx(["Nachname", "Vorname", "Klasse", "Einwahlstatus", "Hinweis"], rows, "Einwahlkontrolle");
    downloadBlob(blob, "Kontrollliste_Einwahl.xlsx");
  }

  async function importFiles(files) {
    const project = loadProject();
    const all = [];
    for (const file of files) all.push(...await parseRosterFile(file, project.settings?.classRequired !== false));
    if (!all.length) throw new Error("In den Soll-Listen wurden keine Personen gefunden.");
    project.participants = (project.participants || []).map((p) => ({
      ...p,
      firstName: String(p.firstName || "").trim(), lastName: String(p.lastName || "").trim(), className: String(p.className || "").trim(), id: p.id || "",
    })).filter((p) => p.firstName || p.lastName);
    current = buildComparison(all, project);
    $("#attendanceFilter").value = current.items.some((x) => x.type === "review") ? "review" : current.items.some((x) => x.type === "missing") ? "missing" : current.duplicateGroups.length ? "duplicates" : "matched";
    render();
    $("#attendanceDialog").showModal();
  }

  function bind() {
    const button = $("#attendanceCheckBtn"), input = $("#attendanceFiles");
    if (!button || !input) return;
    button.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const files = [...(input.files || [])]; input.value = ""; if (!files.length) return;
      button.disabled = true; button.textContent = "Klassenlisten werden geprüft …";
      try { await importFiles(files); } catch (error) { showError(error?.message || String(error)); }
      finally { button.disabled = false; button.textContent = "Einwahlteilnahme prüfen"; }
    });
    $("#attendanceCloseBtn")?.addEventListener("click", () => $("#attendanceDialog")?.close());
    $("#attendanceFilter")?.addEventListener("change", render);
    $("#attendanceExportMissingBtn")?.addEventListener("click", () => exportMissing().catch((e) => showError(e?.message || String(e))));
    $("#attendanceExportAllBtn")?.addEventListener("click", () => exportAll().catch((e) => showError(e?.message || String(e))));
    $("#attendanceTable")?.addEventListener("click", (event) => {
      const tr = event.target.closest("tr[data-attendance-index]"); if (!tr || !current) return;
      const item = current.items[Number(tr.dataset.attendanceIndex)];
      if (event.target.closest("[data-attendance-confirm]")) confirmReview(item);
      if (event.target.closest("[data-attendance-reject]")) rejectReview(item);
    });
  }

  window.addEventListener("DOMContentLoaded", bind);
})();
