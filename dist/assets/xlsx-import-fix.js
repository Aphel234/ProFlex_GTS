(() => {
  const STORAGE_KEY = "workshop-zuteilung-github-pages-v2";
  const LEGACY_STORAGE_KEY = "workshop-zuteilung-github-pages-v1";

  const textOf = (node) => node?.textContent ?? "";
  const elementsByLocalName = (root, name) => [...root.getElementsByTagName("*")].filter((el) => el.localName === name);

  function parseXml(text, label) {
    // XLSX-Erzeuger können vor der XML-Deklaration ein UTF-8-BOM oder
    // unsichtbare Steuer-/Leerzeichen schreiben. Safari akzeptiert vor
    // <?xml ...?> keinerlei Zeichen und meldet sonst
    // "XML declaration allowed only at the start of the document".
    let clean = String(text ?? "");
    clean = clean.replace(/^[\uFEFF\u0000-\u0020]+/, "");

    const doc = new DOMParser().parseFromString(clean, "application/xml");
    const parserError = doc.querySelector("parsererror");
    if (parserError) throw new Error(`${label} konnte nicht gelesen werden: ${parserError.textContent.trim().slice(0, 240)}`);
    return doc;
  }

  function columnIndex(ref) {
    const letters = String(ref || "").match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "";
    let value = 0;
    for (const ch of letters) value = value * 26 + ch.charCodeAt(0) - 64;
    return value;
  }

  function normalizeZipPath(base, target) {
    let path = String(target || "").replace(/^\//, "");
    if (path.startsWith("xl/")) return path;
    if (path.startsWith("../")) {
      const parts = base.split("/").slice(0, -1);
      while (path.startsWith("../")) {
        parts.pop();
        path = path.slice(3);
      }
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
    if (!workbookFile || !relsFile) throw new Error("Die Excel-Datei enthält keine gültige Arbeitsmappenstruktur.");

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
    const file = zip.file(path);
    if (!file) return [];
    const doc = parseXml(await file.async("text"), path);
    const rows = [];

    for (const rowEl of elementsByLocalName(doc, "row")) {
      const rowNumber = Number(rowEl.getAttribute("r")) || rows.length + 1;
      const values = [];
      for (const cell of [...rowEl.children].filter((el) => el.localName === "c")) {
        const idx = columnIndex(cell.getAttribute("r"));
        if (!idx) continue;
        const type = cell.getAttribute("t") || "";
        const v = [...cell.children].find((el) => el.localName === "v");
        const inline = [...cell.children].find((el) => el.localName === "is");
        let value = "";
        if (type === "s") {
          value = sharedStrings[Number(textOf(v))] ?? "";
        } else if (type === "inlineStr") {
          value = inline ? elementsByLocalName(inline, "t").map(textOf).join("") : "";
        } else {
          value = textOf(v);
        }
        values[idx - 1] = value;
      }
      rows[rowNumber - 1] = values;
    }
    return rows;
  }

  function findHeader(rows, requiredAliases) {
    for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
      const normalized = (rows[i] || []).map((v) => String(v ?? "").trim().toLowerCase());
      if (requiredAliases.some((alias) => normalized.includes(alias.toLowerCase()))) return i;
    }
    return -1;
  }

  function rowsToObjects(rows, requiredAliases) {
    const headerIndex = findHeader(rows, requiredAliases);
    if (headerIndex < 0) return [];
    const headers = (rows[headerIndex] || []).map((v) => String(v ?? "").trim());
    return rows.slice(headerIndex + 1).filter(Boolean).map((values) => {
      const obj = {};
      headers.forEach((header, index) => { if (header) obj[header] = values?.[index] ?? ""; });
      return obj;
    });
  }

  function get(row, aliases) {
    const entries = Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [String(k).trim().toLowerCase(), v]));
    for (const alias of aliases) {
      const value = entries[alias.toLowerCase()];
      if (value !== undefined && value !== null) return value;
    }
    return "";
  }

  function yesNo(value, fallback = false) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (["ja", "j", "yes", "true", "1", "an", "aktiv"].includes(normalized)) return true;
    if (["nein", "n", "no", "false", "0", "aus", "inaktiv"].includes(normalized)) return false;
    return fallback;
  }

  function currentSettings() {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    let existing = {};
    try { existing = saved ? JSON.parse(saved) : {}; } catch {}
    return {
      existing,
      settings: {
        ...(existing?.settings || {}),
        projectType: document.querySelector("#projectType")?.value || existing?.settings?.projectType || "school",
        classRequired: (document.querySelector("#classRequired")?.value ?? String(existing?.settings?.classRequired ?? true)) === "true",
        expectedWishes: Math.max(1, Math.min(4, Number(document.querySelector("#expectedWishes")?.value ?? existing?.settings?.expectedWishes ?? 3) || 3)),
        allowOutside: document.querySelector("#allowOutside")?.value === "true",
        defaultMode: document.querySelector("#defaultMode")?.value || existing?.settings?.defaultMode || "Pflicht",
        balanceWeight: Number(document.querySelector("#balanceLevel")?.value ?? existing?.settings?.balanceWeight ?? 10) || 0,
        balanceThreshold: Number(document.querySelector("#balanceThreshold")?.value ?? existing?.settings?.balanceThreshold ?? 10) || 0,
        cohortMin: Number(existing?.settings?.cohortMin ?? 0) || 0,
        rules: Array.isArray(existing?.settings?.rules) ? existing.settings.rules : [],
      },
      name: document.querySelector("#eventName")?.value || existing?.name || "Neue Veranstaltung",
    };
  }

  async function parseWorkbook(file) {
    if (!window.JSZip) throw new Error("Die XLSX-Komponente konnte nicht geladen werden.");
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const sharedStrings = await loadSharedStrings(zip);
    const sheetMap = await workbookSheetMap(zip);

    const getSheetRows = async (...names) => {
      for (const name of names) {
        const path = sheetMap.get(name);
        if (path) return readSheet(zip, path, sharedStrings);
      }
      return [];
    };

    const workshopRows = await getSheetRows("Angebote", "Workshops");
    const gradeLimitRows = await getSheetRows("Jahrgangsbelegung", "Jahrgangsgrenzen");
    const participantRows = await getSheetRows("Kursanwahl", "Teilnehmende", "Personen");
    const lockRows = await getSheetRows("Sperrungen");

    const rawWorkshops = rowsToObjects(workshopRows, ["Durchführungs-ID", "Durchfuehrungs-ID", "Workshop-ID"]);
    const gradeLimitsRaw = rowsToObjects(gradeLimitRows, ["Durchführungs-ID", "Durchfuehrungs-ID", "Workshop-ID"]);
    const participantsRaw = rowsToObjects(participantRows, ["Person-ID"]);
    const locksRaw = rowsToObjects(lockRows, ["Person-ID"]);

    if (!participantsRaw.length && !rawWorkshops.length) throw new Error("Es wurden weder Angebote noch Teilnehmende erkannt.");

    const { existing, settings, name } = currentSettings();

    const workshops = rawWorkshops.map((row) => {
      const id = String(get(row, ["Durchführungs-ID", "Durchfuehrungs-ID", "Workshop-ID", "ID"])).trim();
      return {
        id,
        offerId: String(get(row, ["Angebots-ID", "Kursart-ID", "Anwahl-ID", "Kurs-ID"]) || id).trim(),
        name: String(get(row, ["Angebot", "Kursart", "Workshopname", "Workshop", "Name"])).trim(),
        session: String(get(row, ["Gruppe", "Durchführungsgruppe", "Durchfuehrungsgruppe"])).trim(),
        gradeFrom: Number(get(row, ["Klasse von", "Von"])) || 0,
        gradeTo: Number(get(row, ["Klasse bis", "Bis"])) || 0,
        schoolForm: String(get(row, ["Bildungsgang", "Schulform"]) || "Alle").trim(),
        cohortMin: (() => { const v = get(row, ["Kohortenminimum", "Kohorte min.", "Jahrgang/Bildungsgang min."]); return v === "" ? null : Number(v); })(),
        min: Number(get(row, ["Mindestbelegung", "Minimum", "Min"])) || 0,
        max: Number(get(row, ["Maximalbelegung", "Maximum", "Max"])) || 0,
        mode: String(get(row, ["Pflicht/Optional", "Durchführung", "Durchfuehrung"]) || settings.defaultMode).trim(),
        gradeLimits: {},
        debateRule: {
          enabled: yesNo(get(row, ["Vierergruppen 8/9 + 10+", "Vierergruppen", "Jugend debattiert"]), false),
          balance: yesNo(get(row, ["Gruppenausgleich", "Wettbewerbsgruppen ausgleichen", "Ausgleich Debattiergruppen"]), true),
        },
      };
    }).filter((row) => row.id);

    const nullableLimit = (value) => {
      if (value === "" || value === null || value === undefined) return null;
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
    };
    const gradeLimitMap = new Map();
    for (const row of gradeLimitsRaw) {
      const workshopId = String(get(row, ["Durchführungs-ID", "Durchfuehrungs-ID", "Workshop-ID", "ID"])).trim();
      const grade = Number(get(row, ["Jahrgang", "Klassenstufe", "Jg."]));
      const min = nullableLimit(get(row, ["Minimum", "Min", "Mindestens"]));
      const max = nullableLimit(get(row, ["Maximum", "Max", "Höchstens", "Hoechstens"]));
      if (!workshopId || !Number.isInteger(grade) || grade < 1 || grade > 20 || (min === null && max === null)) continue;
      if (!gradeLimitMap.has(workshopId)) gradeLimitMap.set(workshopId, {});
      gradeLimitMap.get(workshopId)[String(grade)] = { min, max };
    }
    workshops.forEach((workshop) => { workshop.gradeLimits = gradeLimitMap.get(workshop.id) || {}; });

    const participants = participantsRaw.length ? participantsRaw.map((row) => ({
      id: String(get(row, ["Person-ID", "ID"])).trim(),
      firstName: String(get(row, ["Vorname"])).trim(),
      lastName: String(get(row, ["Nachname"])).trim(),
      className: String(get(row, ["Klasse"])).trim(),
      schoolForm: String(get(row, ["Bildungsgang", "Schulform"]) || (() => {
        const className = String(get(row, ["Klasse"])).trim();
        if (/reg(ional)?$/i.test(className) || /r$/i.test(className)) return "Regional";
        return /g/i.test(className) ? "Gymnasial" : "Regional";
      })()).trim(),
      wishes: ["Erstwunsch", "Zweitwunsch", "Drittwunsch", "Viertwunsch"].map((key) => String(get(row, [key])).trim()),
      fixed: String(get(row, ["Feste Setzung"])).trim(),
    })).filter((row) => row.id) : (existing.participants || []);

    const locks = locksRaw.map((row) => ({
      personId: String(get(row, ["Person-ID", "Person"])).trim(),
      workshopId: String(get(row, ["Durchführungs-ID", "Durchfuehrungs-ID", "Workshop-ID", "Workshop"])).trim(),
      reason: String(get(row, ["Grund / Hinweis", "Grund", "Hinweis"])).trim(),
    })).filter((row) => row.personId || row.workshopId);

    const finalWorkshops = workshops.length ? workshops : (existing.workshops || []);
    if (!finalWorkshops.length) throw new Error("Es sind keine Angebote vorhanden. Bitte Angebote anlegen oder das Blatt ‚Angebote‘ beziehungsweise ‚Workshops‘ mit importieren.");

    return {
      name,
      settings,
      workshops: finalWorkshops,
      participants,
      locks: sheetMap.has("Sperrungen") ? locks : (existing.locks || []),
    };
  }

  function showImportError(message) {
    const dialog = document.querySelector("#messageDialog");
    const title = document.querySelector("#dialogTitle");
    const body = document.querySelector("#dialogBody");
    if (dialog && title && body) {
      title.textContent = "Excel-Import fehlgeschlagen";
      body.innerHTML = "";
      const div = document.createElement("div");
      div.className = "message error";
      div.textContent = message;
      body.appendChild(div);
      dialog.showModal();
    } else {
      alert(`Excel-Import fehlgeschlagen: ${message}`);
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    const input = document.querySelector("#excelFile");
    if (!input) return;

    input.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      try {
        const imported = await parseWorkbook(file);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
        event.target.value = "";
        location.reload();
      } catch (error) {
        event.target.value = "";
        showImportError(error?.message || String(error));
      }
    }, true);
  });
})();
