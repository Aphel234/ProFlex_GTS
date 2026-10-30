(() => {
  "use strict";

  const STORAGE_KEY = "workshop-zuteilung-github-pages-v2";
  const LEGACY_STORAGE_KEY = "workshop-zuteilung-github-pages-v1";
  const MAPPING_KEY = "workshop-zuteilung-survey-mappings-v1";
  const MAX_PARTICIPANTS = 500;
  const MAX_WORKSHOPS = 30;
  let pending = null;

  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function loadProject() {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    const empty = { name: "Neue Veranstaltung", settings: { defaultMode: "Pflicht", classRequired: true, expectedWishes: 3 }, workshops: [], participants: [], locks: [] };
    if (!raw) return empty;
    try {
      const project = JSON.parse(raw);
      project.settings ||= {};
      if (project.settings.classRequired === undefined) project.settings.classRequired = true;
      project.settings.expectedWishes = Math.max(1, Math.min(4, Number(project.settings.expectedWishes) || 3));
      return project;
    } catch { return empty; }
  }

  function loadMappings() {
    try { return JSON.parse(localStorage.getItem(MAPPING_KEY) || "{}"); } catch { return {}; }
  }

  function saveMappings(mappings) {
    localStorage.setItem(MAPPING_KEY, JSON.stringify(mappings));
  }

  function toast(message) {
    const el = $("#toast");
    if (!el) return alert(message);
    el.textContent = message;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3000);
  }

  function showError(message) {
    const title = $("#dialogTitle");
    const body = $("#dialogBody");
    const dialog = $("#messageDialog");
    if (!title || !body || !dialog) return alert(message);
    title.textContent = "Umfrage-Import fehlgeschlagen";
    body.innerHTML = `<div class="message error">${escapeHtml(message)}</div>`;
    dialog.showModal();
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/ß/g, "ss")
      .replace(/&/g, " und ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim().replace(/\s+/g, " ");
  }

  function normalizeCode(value) {
    return normalizeText(value).replace(/\s+/g, "");
  }

  function extractSurveyCode(label) {
    const text = String(label || "").trim();
    const beforeColon = text.includes(":") ? text.split(":", 1)[0].trim() : "";
    if (/^[A-Za-zÄÖÜäöüß]+\s*[-_.]?\s*\d+[A-Za-z]?$/u.test(beforeColon)) return beforeColon;
    const match = text.match(/^([A-Za-zÄÖÜäöüß]+\s*[-_.]?\s*\d+[A-Za-z]?)\s*:/u);
    return match?.[1]?.trim() || "";
  }

  function cleanSurveyName(label) {
    let text = String(label || "").trim();
    if (text.includes(":")) text = text.slice(text.indexOf(":") + 1).trim();
    text = text.replace(/\s*\([^)]*\)\s*$/u, "").trim();
    return text || String(label || "").trim();
  }

  function levenshtein(a, b) {
    a = normalizeText(a); b = normalizeText(b);
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      let diagonal = previous[0];
      previous[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const above = previous[j];
        previous[j] = Math.min(
          previous[j] + 1,
          previous[j - 1] + 1,
          diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
        diagonal = above;
      }
    }
    return previous[b.length];
  }

  function similarity(a, b) {
    const aa = normalizeText(a); const bb = normalizeText(b);
    if (!aa || !bb) return 0;
    if (aa === bb) return 1;
    const charScore = 1 - levenshtein(aa, bb) / Math.max(aa.length, bb.length);
    const ta = new Set(aa.split(" ")); const tb = new Set(bb.split(" "));
    const overlap = [...ta].filter((token) => tb.has(token)).length;
    const tokenScore = overlap / Math.max(ta.size, tb.size, 1);
    return Math.max(charScore, (charScore * 0.7) + (tokenScore * 0.3));
  }

  function parseClass(raw) {
    const original = String(raw || "").trim();
    let compact = original.replace(/\s+/g, "");
    let schoolForm = "";
    let className = compact || original;
    if (/gym(nasial)?$/i.test(compact)) {
      schoolForm = "Gymnasial";
      className = compact.replace(/gym(nasial)?$/i, "") || original;
    } else if (/reg(ional)?$/i.test(compact)) {
      schoolForm = "Regional";
      className = compact.replace(/reg(ional)?$/i, "") || original;
    } else if (/g$/i.test(compact)) {
      schoolForm = "Gymnasial";
      className = compact; // G bleibt Bestandteil der Klassenbezeichnung, z. B. 8aG
    } else if (/r$/i.test(compact)) {
      schoolForm = "Regional";
      className = compact; // R bleibt Bestandteil der Klassenbezeichnung, z. B. 8aR
    } else if (/g/i.test(compact)) {
      schoolForm = "Gymnasial";
    } else if (compact) {
      schoolForm = "Regional";
    }
    return { className, schoolForm };
  }

  function splitCombinedName(raw) {
    const value = String(raw || "").trim();
    if (!value) return { firstName: "", lastName: "", uncertain: false };
    if (value.includes(",")) {
      const [lastName, ...rest] = value.split(",");
      return { firstName: rest.join(",").trim(), lastName: lastName.trim(), uncertain: false };
    }
    const parts = value.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return { firstName: "", lastName: parts[0], uncertain: true };
    return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1), uncertain: true };
  }

  function personKey(person) {
    return [person.firstName, person.lastName, person.className].map(normalizeText).join("|");
  }

  function nextId(prefix, existing, width = 3) {
    for (let i = 1; i <= 9999; i += 1) {
      const id = `${prefix}${String(i).padStart(width, "0")}`;
      if (!existing.has(id)) { existing.add(id); return id; }
    }
    return "";
  }

  function localName(node) { return node?.localName || String(node?.nodeName || "").split(":").pop(); }
  function elementsByLocalName(root, name) { return [...root.getElementsByTagName("*")].filter((el) => localName(el) === name); }
  function textOf(node) { return node?.textContent ?? ""; }
  function parseXml(text, source) {
    // Manche Umfrage-Exporte schreiben ein UTF-8-BOM vor die XML-Deklaration.
    // Safari/DOMParser wertet das als Zeichen vor <?xml ...?> und bricht ab.
    let clean = String(text ?? "").replace(/^\uFEFF/, "");
    clean = clean.replace(/^[\u0000-\u0020]+(?=<\?xml)/, "");
    const doc = new DOMParser().parseFromString(clean, "application/xml");
    const error = doc.querySelector("parsererror");
    if (error) throw new Error(`Ungültige Excel-Struktur in ${source}.`);
    return doc;
  }
  function columnIndex(cellRef) {
    const letters = String(cellRef || "").match(/[A-Z]+/i)?.[0]?.toUpperCase() || "";
    let index = 0;
    for (const ch of letters) index = index * 26 + ch.charCodeAt(0) - 64;
    return index;
  }
  function normalizeZipPath(base, target) {
    let path = String(target || "").replace(/^\//, "");
    if (path.startsWith("xl/")) return path;
    if (path.startsWith("../")) {
      const parts = base.split("/").slice(0, -1);
      while (path.startsWith("../")) { parts.pop(); path = path.slice(3); }
      return [...parts, path].join("/");
    }
    const dir = base.split("/").slice(0, -1).join("/");
    return `${dir}/${path}`.replace(/\/+/g, "/");
  }
  async function loadSharedStrings(zip) {
    const file = zip.file("xl/sharedStrings.xml");
    if (!file) return [];
    const doc = parseXml(await file.async("text"), "sharedStrings.xml");
    return elementsByLocalName(doc, "si").map((si) => elementsByLocalName(si, "t").map(textOf).join(""));
  }
  async function workbookSheetMap(zip) {
    const workbookFile = zip.file("xl/workbook.xml");
    const relsFile = zip.file("xl/_rels/workbook.xml.rels");
    if (!workbookFile || !relsFile) throw new Error("Die Datei ist keine lesbare XLSX-Arbeitsmappe.");
    const workbookDoc = parseXml(await workbookFile.async("text"), "workbook.xml");
    const relsDoc = parseXml(await relsFile.async("text"), "workbook.xml.rels");
    const rels = new Map();
    for (const rel of elementsByLocalName(relsDoc, "Relationship")) {
      rels.set(rel.getAttribute("Id"), normalizeZipPath("xl/workbook.xml", rel.getAttribute("Target")));
    }
    const sheets = new Map();
    for (const sheet of elementsByLocalName(workbookDoc, "sheet")) {
      const name = sheet.getAttribute("name") || "";
      const relId = sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")
        || sheet.getAttribute("r:id") || sheet.getAttribute("id");
      const target = rels.get(relId);
      if (name && target) sheets.set(name, target);
    }
    return sheets;
  }
  async function readSheet(zip, path, sharedStrings) {
    const file = zip.file(path); if (!file) return [];
    const doc = parseXml(await file.async("text"), path);
    const rows = [];
    for (const rowEl of elementsByLocalName(doc, "row")) {
      const rowNumber = Number(rowEl.getAttribute("r")) || rows.length + 1;
      const values = [];
      for (const cell of [...rowEl.children].filter((el) => localName(el) === "c")) {
        const idx = columnIndex(cell.getAttribute("r")); if (!idx) continue;
        const type = cell.getAttribute("t") || "";
        const v = [...cell.children].find((el) => localName(el) === "v");
        const inline = [...cell.children].find((el) => localName(el) === "is");
        let value = "";
        if (type === "s") value = sharedStrings[Number(textOf(v))] ?? "";
        else if (type === "inlineStr") value = inline ? elementsByLocalName(inline, "t").map(textOf).join("") : "";
        else value = textOf(v);
        values[idx - 1] = value;
      }
      rows[rowNumber - 1] = values;
    }
    return rows;
  }

  function wishSlotFromHeader(value) {
    const header = normalizeText(value);
    if (!header) return 0;
    if (/erstwunsch|wunsch 1|1 wunsch/.test(header)) return 1;
    if (/zweitwunsch|wunsch 2|2 wunsch/.test(header)) return 2;
    if (/drittwunsch|wunsch 3|3 wunsch/.test(header)) return 3;
    if (/viertwunsch|wunsch 4|4 wunsch/.test(header)) return 4;
    return 0;
  }

  function headerIndex(rows, classRequired = true) {
    for (let i = 0; i < Math.min(20, rows.length); i += 1) {
      const normalized = (rows[i] || []).map(normalizeText);
      const hasFirst = normalized.some((h) => h === "vorname" || h.includes("q1 vorname"));
      const hasLast = normalized.some((h) => h === "nachname" || h.includes("q2 nachname"));
      const hasCombinedName = normalized.some((h) => ["name", "teilnehmer", "teilnehmende", "schulername", "schuelername"].includes(h));
      const hasClass = normalized.some((h) => h === "klasse" || h.includes("klasse"));
      const wishCount = (rows[i] || []).filter((h) => wishSlotFromHeader(h)).length;
      if ((hasCombinedName || (hasFirst && hasLast)) && (!classRequired || hasClass) && wishCount >= 1) return i;
    }
    return -1;
  }

  function headerColumn(headers, aliases) {
    const normalized = headers.map(normalizeText);
    for (const alias of aliases) {
      const exact = normalized.indexOf(normalizeText(alias));
      if (exact >= 0) return exact;
    }
    for (let i = 0; i < normalized.length; i += 1) {
      if (aliases.some((alias) => normalized[i].includes(normalizeText(alias)))) return i;
    }
    return -1;
  }

  async function parseSurveyFile(file, project) {
    if (!window.JSZip) throw new Error("Die XLSX-Komponente konnte nicht geladen werden.");
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const sharedStrings = await loadSharedStrings(zip);
    const sheets = await workbookSheetMap(zip);
    let path = sheets.get("Antworten");
    if (!path) {
      for (const [name, candidate] of sheets.entries()) {
        if (normalizeText(name).includes("antwort")) { path = candidate; break; }
      }
    }
    if (!path) throw new Error(`${file.name}: Das Blatt „Antworten“ wurde nicht gefunden.`);
    const rows = await readSheet(zip, path, sharedStrings);
    const classRequired = project?.settings?.classRequired !== false;
    const hi = headerIndex(rows, classRequired);
    if (hi < 0) throw new Error(`${file.name}: Name sowie mindestens eine Wunschspalte${classRequired ? " und die Klasse" : ""} wurden nicht erkannt.`);
    const headers = rows[hi] || [];
    const wishColumns = [1,2,3,4].map((slot) => headers.findIndex((header) => wishSlotFromHeader(header) === slot));
    const cols = {
      firstName: headerColumn(headers, ["Q1: Vorname", "Vorname"]),
      lastName: headerColumn(headers, ["Q2: Nachname", "Nachname"]),
      combinedName: headerColumn(headers, ["Name", "Schülername", "Schuelername", "Teilnehmer", "Teilnehmende"]),
      className: headerColumn(headers, ["Q1: Klasse", "Q2: Klasse", "Q3: Klasse", "Klasse", "Klassenbezeichnung"]),
      wishes: wishColumns,
    };
    if ((cols.firstName < 0 || cols.lastName < 0) && cols.combinedName < 0) throw new Error(`${file.name}: Vorname/Nachname oder eine kombinierte Spalte „Name“ wurde nicht erkannt.`);
    if (classRequired && cols.className < 0) throw new Error(`${file.name}: Die Klassenspalte wurde nicht erkannt.`);
    const detectedWishCount = cols.wishes.filter((index) => index >= 0).length;
    if (!detectedWishCount) throw new Error(`${file.name}: Es wurde keine Wunschspalte erkannt.`);
    const participants = [];
    for (let i = hi + 1; i < rows.length; i += 1) {
      const row = rows[i] || [];
      const combined = cols.combinedName >= 0 ? splitCombinedName(row[cols.combinedName]) : null;
      const firstName = cols.firstName >= 0 ? String(row[cols.firstName] ?? "").trim() : combined?.firstName || "";
      const lastName = cols.lastName >= 0 ? String(row[cols.lastName] ?? "").trim() : combined?.lastName || "";
      const rawClass = cols.className >= 0 ? String(row[cols.className] ?? "").trim() : "";
      if (!firstName && !lastName && !rawClass) continue;
      const parsedClass = parseClass(rawClass);
      participants.push({
        sourceFile: file.name,
        sourceRow: i + 1,
        firstName,
        lastName,
        rawClass,
        className: parsedClass.className,
        schoolForm: parsedClass.schoolForm,
        rawWishes: cols.wishes.map((col) => col >= 0 ? String(row[col] ?? "").trim() : ""),
        detectedWishCount,
        enrollmentIssues: combined?.uncertain ? ["Der kombinierte Name wurde ohne Komma automatisch aufgeteilt und sollte geprüft werden."] : [],
      });
    }
    return participants;
  }

  function courseTypes(project) {
    const map = new Map();
    for (const w of project.workshops || []) {
      const id = String(w.offerId || w.id || "").trim();
      if (id && !map.has(id)) map.set(id, { id, name: String(w.name || id).trim() });
    }
    return [...map.values()];
  }

  function mappingKey(label) {
    const code = extractSurveyCode(label);
    return code ? `code:${normalizeCode(code)}` : `name:${normalizeText(cleanSurveyName(label))}`;
  }

  function suggestMapping(label, courses, saved) {
    const code = extractSurveyCode(label);
    const name = cleanSurveyName(label);
    const key = mappingKey(label);
    const savedEntry = saved[key];
    const savedOfferId = typeof savedEntry === "string" ? savedEntry : savedEntry?.offerId;
    const savedTargetName = typeof savedEntry === "object" ? savedEntry?.targetName : "";
    const savedCourse = courses.find((c) => c.id === savedOfferId);
    if (savedCourse && (!savedTargetName || normalizeText(savedCourse.name) === normalizeText(savedTargetName))) {
      return { offerId: savedCourse.id, status: "saved", score: 1, confirm: false };
    }
    if (code) {
      const exactCode = courses.find((c) => normalizeCode(c.id) === normalizeCode(code));
      if (exactCode) return { offerId: exactCode.id, status: "code", score: 1, confirm: false };
    }
    const exactName = courses.find((c) => normalizeText(c.name) === normalizeText(name));
    if (exactName) return { offerId: exactName.id, status: "name", score: 1, confirm: false };
    const ranked = courses.map((c) => ({ ...c, score: similarity(name, c.name) })).sort((a,b) => b.score - a.score);
    const best = ranked[0]; const second = ranked[1];
    if (best && best.score >= 0.84 && (!second || best.score - second.score >= 0.06)) {
      return { offerId: best.id, status: "fuzzy", score: best.score, confirm: true };
    }
    return { offerId: "", status: "unmatched", score: best?.score || 0, confirm: true };
  }

  function prepareImport(project, filesData) {
    const courses = courseTypes(project);
    const saved = loadMappings();
    const rawParticipants = filesData.flat();

    // Gleichartige Umfrage-Bezeichnungen werden zuerst zusammengeführt.
    // Wenn eine stabile Kennung wie „Pro 6“ vorhanden ist, ist sie der Primärschlüssel.
    // Dadurch bleiben auch Tippfehler im Namen innerhalb derselben Pro-Kennung ein Kurs.
    const grouped = new Map();
    for (const label of rawParticipants.flatMap((p) => p.rawWishes).filter(Boolean)) {
      const code = extractSurveyCode(label);
      const key = code ? `code:${normalizeCode(code)}` : `name:${normalizeText(cleanSurveyName(label))}`;
      if (!grouped.has(key)) grouped.set(key, { key, labels: [], code, name: cleanSurveyName(label) });
      const group = grouped.get(key);
      if (!group.labels.includes(label)) group.labels.push(label);
      if (!group.code && code) group.code = code;
    }

    const mappings = [...grouped.values()].map((group) => {
      const preferredLabel = group.labels[0];
      const suggestion = suggestMapping(preferredLabel, courses, saved);
      let mapping = {
        label: preferredLabel,
        labels: group.labels,
        name: group.name,
        code: group.code,
        ...suggestion,
      };

      // Ohne vorhandene Projekt-Kursarten darf die Umfrage selbst das Kursangebot liefern.
      // Eine stabile Pro-/Kurskennung ist dabei eindeutig genug für automatische Neuanlage.
      if (!courses.length) {
        mapping.offerId = "__new__";
        mapping.status = group.code ? "detected-code" : "detected-new";
        mapping.confirm = !group.code;
      } else if (!mapping.offerId) {
        // Gibt es schon ein Projekt, werden unbekannte Angebote nicht stillschweigend
        // hineingemischt: sie werden als neue Kursart vorgeschlagen und bestätigt.
        mapping.offerId = "__new__";
        mapping.status = "detected-new";
        mapping.confirm = true;
      }
      return mapping;
    });

    const existingByKey = new Map((project.participants || []).map((p) => [personKey(p), p]));
    const seenBatch = new Map();
    const participants = rawParticipants.map((p, index) => {
      const key = personKey(p);
      const existing = existingByKey.get(key) || null;
      const priorBatch = seenBatch.get(key);
      if (priorBatch === undefined) seenBatch.set(key, index);
      return {
        ...p, key,
        duplicateType: existing ? "existing" : priorBatch !== undefined ? "batch" : "",
        existingId: existing?.id || "",
        priorBatchIndex: priorBatch ?? -1,
        duplicateAction: existing || priorBatch !== undefined ? "skip" : "add",
      };
    });
    return {
      project, courses, mappings, participants,
      fileCount: new Set(rawParticipants.map((p) => p.sourceFile)).size,
      detectedWishCounts: [...new Set(rawParticipants.map((p) => p.detectedWishCount).filter(Boolean))].sort((a, b) => a - b),
    };
  }

  function mappingStatus(mapping) {
    if (mapping.status === "code") return ["Eindeutige ID", "good"];
    if (mapping.status === "name") return ["Exakter Name", "good"];
    if (mapping.status === "saved") return ["Gespeicherte Zuordnung", "good"];
    if (mapping.status === "detected-code" && !mapping.confirm) return ["Aus Umfrage erkannt", "good"];
    if (mapping.status === "detected-new" && mapping.confirm) return ["Neues Angebot – prüfen", "warn"];
    if (mapping.status === "fuzzy" && mapping.confirm) return ["Ähnlich – bitte bestätigen", "warn"];
    if (mapping.offerId === "__new__" && !mapping.confirm) return ["Neues Angebot", "good"];
    if (mapping.offerId && !mapping.confirm) return ["Bestätigt", "good"];
    return ["Zuordnung erforderlich", "bad"];
  }

  function renderReview() {
    if (!pending) return;
    const body = $("#surveyImportBody");
    const unresolved = pending.mappings.filter((m) => m.confirm || !m.offerId).length;
    const dupes = pending.participants.filter((p) => p.duplicateType).length;
    const classRequired = pending.project.settings?.classRequired !== false;
    const unknownForms = classRequired ? pending.participants.filter((p) => !p.schoolForm).length : 0;
    const wouldAdd = pending.participants.filter((p) => p.duplicateAction === "add" && !p.duplicateType).length
      + pending.participants.filter((p) => p.duplicateType && p.duplicateAction === "add").length;
    const replacing = pending.participants.filter((p) => p.duplicateAction === "replace").length;
    const finalCount = pending.project.participants.length + wouldAdd;

    $("#surveyImportSummary").innerHTML = `
      <div class="stat"><strong>${pending.fileCount}</strong><span>Dateien</span></div>
      <div class="stat"><strong>${pending.participants.length}</strong><span>Antworten erkannt</span></div>
      <div class="stat"><strong>${pending.detectedWishCounts.join("/") || "–"}</strong><span>Wunschspalten erkannt</span></div>
      <div class="stat"><strong>${pending.mappings.length - unresolved}/${pending.mappings.length}</strong><span>Kursangebote geklärt</span></div>
      <div class="stat"><strong>${dupes}</strong><span>mögliche Dubletten</span></div>`;

    const options = pending.courses.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.id)} · ${escapeHtml(c.name)}</option>`).join("");
    $("#surveyMappingTable").innerHTML = `<thead><tr><th>Aus Umfrage</th><th>Angebots-Zuordnung</th><th>Status</th><th></th></tr></thead><tbody>${pending.mappings.map((m, i) => {
      const [label, cls] = mappingStatus(m);
      const variants = (m.labels || [m.label]);
      return `<tr data-map-index="${i}"><td><strong>${escapeHtml(m.name)}</strong>${m.code ? `<small class="mapping-code">${escapeHtml(m.code)}</small>` : ""}<small>${escapeHtml(variants.join(" · "))}</small></td>
        <td><select data-map-select><option value="">Bitte zuordnen …</option>${options}<option value="__new__">＋ Als neues Angebot übernehmen</option></select></td>
        <td><span class="badge ${cls}">${escapeHtml(label)}</span>${m.status === "fuzzy" ? `<small>${Math.round(m.score * 100)} % Namensähnlichkeit</small>` : ""}</td>
        <td>${m.confirm && m.offerId ? `<button type="button" class="button compact-button" data-map-confirm>Bestätigen</button>` : ""}</td></tr>`;
    }).join("")}</tbody>`;
    pending.mappings.forEach((m, i) => {
      const select = $(`#surveyMappingTable tr[data-map-index="${i}"] [data-map-select]`);
      if (select) select.value = m.offerId;
    });

    const duplicateRows = pending.participants.map((p, i) => ({ p, i })).filter(({p}) => p.duplicateType);
    $("#surveyDuplicateSection").hidden = duplicateRows.length === 0;
    $("#surveyDuplicateTable").innerHTML = `<thead><tr><th>Person</th><th>Quelle</th><th>Treffer</th><th>Aktion</th></tr></thead><tbody>${duplicateRows.map(({p,i}) => `<tr data-person-index="${i}">
      <td><strong>${escapeHtml(`${p.firstName} ${p.lastName}`)}</strong><small>${escapeHtml(p.className)} · ${escapeHtml(p.schoolForm || "Bildungsgang unbekannt")}</small></td>
      <td>${escapeHtml(p.sourceFile)} · Zeile ${p.sourceRow}</td>
      <td>${p.duplicateType === "existing" ? `bereits im Projekt${p.existingId ? ` (${escapeHtml(p.existingId)})` : ""}` : "bereits in einer ausgewählten Umfragedatei"}</td>
      <td><select data-duplicate-action>
        <option value="skip"${p.duplicateAction === "skip" ? " selected" : ""}>Überspringen</option>
        ${p.duplicateType === "existing" ? `<option value="replace"${p.duplicateAction === "replace" ? " selected" : ""}>Vorhandene Wünsche ersetzen</option>` : ""}
        <option value="add"${p.duplicateAction === "add" ? " selected" : ""}>Trotzdem zusätzlich übernehmen</option>
      </select></td></tr>`).join("")}</tbody>`;

    const issues = [];
    if (unresolved) issues.push(`${unresolved} Angebots-Zuordnung(en) müssen noch bestätigt werden.`);
    if (unknownForms) issues.push(`${unknownForms} Person(en) ohne auswertbare Klasse. Klassen ohne G/g werden automatisch dem regionalen Bildungsgang zugeordnet.`);
    if (finalCount > MAX_PARTICIPANTS) issues.push(`Mit dieser Auswahl wären ${finalCount} Teilnehmer im Projekt; erlaubt sind höchstens ${MAX_PARTICIPANTS}.`);
    $("#surveyImportIssues").innerHTML = issues.length ? issues.map((x) => `<div class="message ${x.includes("höchstens") || x.includes("ohne erkennbaren") ? "error" : "warning"}">${escapeHtml(x)}</div>`).join("") : `<div class="message">Bereit zur Übernahme. ${wouldAdd} neue Person(en), ${replacing} Ersetzung(en).</div>`;
    $("#surveyApplyBtn").disabled = unresolved > 0 || finalCount > MAX_PARTICIPANTS;
  }

  function createNewCourse(project, mapping, existingWorkshopIds, existingOfferIds) {
    if ((project.workshops || []).length >= MAX_WORKSHOPS) throw new Error(`Es können höchstens ${MAX_WORKSHOPS} Durchführungen angelegt werden.`);
    const id = nextId("W", existingWorkshopIds, 2);
    let offerId = String(mapping.code || "").trim();
    if (!offerId || existingOfferIds.has(offerId)) offerId = nextId("K", existingOfferIds, 2);
    else existingOfferIds.add(offerId);
    project.workshops.push({
      id, offerId, name: mapping.name || mapping.label || "Neues Angebot", session: "",
      gradeFrom: 7, gradeTo: 12, schoolForm: "Alle", cohortMin: null,
      min: 0, max: 20, mode: project.settings?.defaultMode || "Pflicht",
    });
    mapping.offerId = offerId;
    return offerId;
  }

  function applyImport() {
    if (!pending) return;
    if (pending.mappings.some((m) => m.confirm || !m.offerId)) return showError("Bitte zuerst alle unklaren Angebots-Zuordnungen bestätigen.");
    const project = JSON.parse(JSON.stringify(pending.project));
    project.workshops ||= []; project.participants ||= []; project.locks ||= [];
    const existingWorkshopIds = new Set(project.workshops.map((w) => w.id));
    const existingOfferIds = new Set(project.workshops.map((w) => w.offerId));
    for (const mapping of pending.mappings) {
      if (mapping.offerId === "__new__") createNewCourse(project, mapping, existingWorkshopIds, existingOfferIds);
    }
    const mapByLabel = new Map();
    for (const m of pending.mappings) for (const label of (m.labels || [m.label])) mapByLabel.set(label, m.offerId);
    const usedIds = new Set(project.participants.map((p) => p.id));
    const projectByKey = new Map(project.participants.map((p, index) => [personKey(p), { p, index }]));
    let added = 0; let replaced = 0; let skipped = 0;

    for (const source of pending.participants) {
      if (source.duplicateAction === "skip") { skipped += 1; continue; }
      const mappedWishes = source.rawWishes.map((label) => label ? (mapByLabel.get(label) || "") : "");
      const positions = new Map();
      mappedWishes.forEach((wish, index) => {
        if (!wish) return;
        if (!positions.has(wish)) positions.set(wish, []);
        positions.get(wish).push(index + 1);
      });
      const enrollmentIssues = [...(source.enrollmentIssues || [])];
      for (const [wish, slots] of positions) {
        if (slots.length < 2) continue;
        const target = project.workshops.find((course) => course.offerId === wish);
        enrollmentIssues.push(`„${target?.name || wish}“ wurde als Wunsch ${slots.join(" und ")} mehrfach eingetragen; nur der erste Eintrag wird gewertet.`);
      }
      const seenWishes = new Set();
      const wishes = mappedWishes.map((wish) => {
        if (!wish || seenWishes.has(wish)) return "";
        seenWishes.add(wish);
        return wish;
      });
      const incoming = {
        id: "",
        firstName: source.firstName,
        lastName: source.lastName,
        className: source.className,
        schoolForm: source.schoolForm,
        wishes,
        fixed: "",
        enrollmentIssues: [...new Set(enrollmentIssues)],
        sourceFile: source.sourceFile,
        sourceRow: source.sourceRow,
      };
      const existing = projectByKey.get(source.key);
      if (source.duplicateAction === "replace" && existing) {
        incoming.id = existing.p.id;
        incoming.fixed = existing.p.fixed || "";
        project.participants[existing.index] = incoming;
        projectByKey.set(source.key, { p: incoming, index: existing.index });
        replaced += 1;
      } else {
        incoming.id = nextId("P", usedIds, 3);
        if (!incoming.id) throw new Error("Es konnte keine freie Person-ID erzeugt werden.");
        project.participants.push(incoming);
        if (!projectByKey.has(source.key)) projectByKey.set(source.key, { p: incoming, index: project.participants.length - 1 });
        added += 1;
      }
    }
    if (project.participants.length > MAX_PARTICIPANTS) throw new Error(`Nach dem Import wären ${project.participants.length} Teilnehmer vorhanden; erlaubt sind höchstens ${MAX_PARTICIPANTS}.`);

    const saved = loadMappings();
    for (const m of pending.mappings) {
      const target = project.workshops.find((w) => w.offerId === m.offerId);
      const entry = { offerId: m.offerId, targetName: target?.name || "" };
      saved[mappingKey(m.label)] = entry;
      if (m.code) saved[`code:${normalizeCode(m.code)}`] = entry;
      if (m.name) saved[`name:${normalizeText(m.name)}`] = entry;
    }
    saveMappings(saved);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    $("#surveyImportDialog")?.close();
    pending = null;
    toast(`${added} Teilnehmer übernommen, ${replaced} ersetzt, ${skipped} übersprungen.`);
    setTimeout(() => location.reload(), 550);
  }

  async function openFiles(files) {
    const project = loadProject();
    const arrays = [];
    for (const file of files) arrays.push(await parseSurveyFile(file, project));
    if (!arrays.flat().length) throw new Error("In den ausgewählten Dateien wurden keine Antworten gefunden.");
    pending = prepareImport(project, arrays);
    renderReview();
    $("#surveyImportDialog").showModal();
  }

  function bind() {
    const button = $("#surveyImportBtn"); const input = $("#surveyFiles");
    if (!button || !input) return;
    button.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const files = [...(input.files || [])]; input.value = "";
      if (!files.length) return;
      button.disabled = true; button.textContent = "Umfragen werden gelesen …";
      try { await openFiles(files); } catch (error) { showError(error?.message || String(error)); }
      finally { button.disabled = false; button.textContent = "Umfrage-Dateien importieren"; }
    });

    $("#surveyMappingTable")?.addEventListener("change", (event) => {
      const select = event.target.closest("[data-map-select]"); if (!select || !pending) return;
      const index = Number(select.closest("tr")?.dataset.mapIndex); const mapping = pending.mappings[index]; if (!mapping) return;
      mapping.offerId = select.value;
      mapping.confirm = !select.value;
      mapping.status = select.value === "__new__" ? "new" : select.value ? "manual" : "unmatched";
      if (select.value) mapping.confirm = false;
      renderReview();
    });
    $("#surveyMappingTable")?.addEventListener("click", (event) => {
      const buttonEl = event.target.closest("[data-map-confirm]"); if (!buttonEl || !pending) return;
      const index = Number(buttonEl.closest("tr")?.dataset.mapIndex); const mapping = pending.mappings[index]; if (!mapping?.offerId) return;
      mapping.confirm = false; mapping.status = "manual"; renderReview();
    });
    $("#surveyDuplicateTable")?.addEventListener("change", (event) => {
      const select = event.target.closest("[data-duplicate-action]"); if (!select || !pending) return;
      const index = Number(select.closest("tr")?.dataset.personIndex); if (!pending.participants[index]) return;
      pending.participants[index].duplicateAction = select.value; renderReview();
    });
    $("#surveyApplyBtn")?.addEventListener("click", () => { try { applyImport(); } catch (error) { showError(error?.message || String(error)); } });
  }

  window.__proflexSurveyImportTest = { wishSlotFromHeader, headerIndex, splitCombinedName, parseClass };
  window.addEventListener("DOMContentLoaded", bind);
})();
