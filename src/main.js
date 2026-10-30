import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";
import { createSampleData } from "./sample-data.js";
import { normalizeEvent, optimizeEvent, unassignedDiagnosis, validateEvent } from "./optimizer.js";
import { assignmentDifference, buildBottleneckRecommendations, buildDemandStats } from "./planning.js";
import { buildFuxExportData, createFuxWorkbook, defaultFuxCourseConfig } from "./fux-export.js";
import { buildEnrollmentCheck, inferSchoolForm } from "./enrollment.js";

const STORAGE_KEY = "workshop-zuteilung-github-pages-v2";
const LEGACY_STORAGE_KEY = "workshop-zuteilung-github-pages-v1";
let state = loadState();
let result = null;
let saveTimer = null;
let toastTimer = null;
let selectedCourseId = "";
let courseDetailTab = "assigned";
let editingGradeLimitsWorkshopIndex = -1;
let gradeLimitsDraft = {};
let planningInsights = null;
let comparisonResults = [];
let reviewIndex = 0;
let fuxExportDraft = null;
const resultUndoStack = [];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function createEmptyProject() {
  return normalizeEvent({
    name: "Neue Veranstaltung",
    settings: {
      projectType: "school",
      classRequired: true,
      expectedWishes: 3,
      allowOutside: false,
      defaultMode: "Pflicht",
      balanceWeight: 10,
      balanceThreshold: 10,
      cohortMin: 0,
      qualityMode: "standard",
      gradePreferenceWeight: 50,
      rules: [],
    },
    workshops: [],
    participants: [],
    locks: [],
    fuxExport: { courses: {}, assignmentOverrides: {} },
    auditLog: [],
  });
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    return saved ? normalizeEvent(JSON.parse(saved)) : createEmptyProject();
  } catch {
    return createEmptyProject();
  }
}

function scheduleSave() {
  $("#saveState").textContent = "speichert …";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $("#saveState").textContent = "lokal gespeichert";
  }, 250);
}

function invalidateResult() {
  result = null;
  planningInsights = null;
  comparisonResults = [];
  reviewIndex = 0;
  renderResults();
  renderPlanning();
}

function commit({ invalidate = true } = {}) {
  state = normalizeEvent(state);
  scheduleSave();
  if (invalidate) invalidateResult();
  renderDashboard();
  renderEnrollmentCheck();
}

function deleteCurrentProject() {
  const projectName = String(state.name || "Aktuelles Projekt").trim();
  const confirmed = confirm(
    `Projekt „${projectName}“ wirklich leeren?\n\n` +
    "Alle lokal gespeicherten Angebote, Teilnehmenden, Sperrungen, Regeln und Ergebnisse dieses Projekts werden entfernt. Dieser Schritt kann nicht rückgängig gemacht werden. Falls nötig, lade vorher unter „Datenaustausch“ eine JSON-Sicherung herunter."
  );
  if (!confirmed) return;

  clearTimeout(saveTimer);
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);

  state = createEmptyProject();
  result = null;
  selectedCourseId = "";
  courseDetailTab = "assigned";
  resultUndoStack.length = 0;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  const detailDialog = $("#courseDetailDialog");
  if (detailDialog?.open) detailDialog.close();
  activateTab("dashboard");
  renderAll();
  $("#saveState").textContent = "lokal gespeichert";
  toast("Projekt geleert. Die Anwendung ist jetzt ohne Beispieldaten bereit.");
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function option(value, selected, label = value) {
  return `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function showDialog(title, messages, type = "error") {
  $("#dialogTitle").textContent = title;
  const list = Array.isArray(messages) ? messages : [messages];
  $("#dialogBody").innerHTML = list.map((message) => `<div class="message ${type}">${escapeHtml(message)}</div>`).join("");
  $("#messageDialog").showModal();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function safeFilename(value) {
  return String(value || "datei").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
}

function courseTypes() {
  const map = new Map();
  for (const workshop of state.workshops) {
    if (workshop.offerId && !map.has(workshop.offerId)) map.set(workshop.offerId, workshop.name);
  }
  return [...map.entries()].map(([id, name]) => ({ id, name }));
}

function workshopLabel(workshop) {
  if (!workshop) return "";
  return `${workshop.name}${workshop.session ? ` – Gruppe ${workshop.session}` : ""}`;
}

function gradeNumberFromClass(className) {
  const match = String(className || "").trim().match(/^(\d{1,2})/);
  return match ? Number(match[1]) : NaN;
}

function normalizeNullableLimit(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(500, Math.trunc(number))) : null;
}

function gradePreferenceWeightLabel(value) {
  const weight = Math.max(0, Math.min(100, Number(value) || 0));
  if (weight === 0) return "Nur Wünsche";
  if (weight < 40) return "Wünsche stärker";
  if (weight <= 60) return "Ausgewogen";
  if (weight < 100) return "Jahrgangsverteilung stärker";
  return "Jahrgangsverteilung maximal";
}

function updateGradePreferenceWeightOutput(value) {
  const output = $("#gradePreferenceWeightOutput");
  if (output) output.textContent = `${Number(value) || 0} % · ${gradePreferenceWeightLabel(value)}`;
}

function gradeLimitEntriesForWorkshop(workshop) {
  return Object.entries(workshop?.gradeLimits || {})
    .map(([grade, limit]) => ({ grade: Number(grade), min: normalizeNullableLimit(limit?.min), max: normalizeNullableLimit(limit?.max) }))
    .filter((item) => Number.isInteger(item.grade) && (item.min !== null || item.max !== null))
    .sort((a, b) => a.grade - b.grade);
}

function gradeLimitSummary(workshop) {
  const entries = gradeLimitEntriesForWorkshop(workshop);
  const parts = entries.map((item) => {
    if (item.min !== null && item.max !== null) return `Jg. ${item.grade}: ${item.min}–${item.max}`;
    if (item.min !== null) return `Jg. ${item.grade}: ≥ ${item.min}`;
    return `Jg. ${item.grade}: ≤ ${item.max}`;
  });
  if (workshop?.gradeGroupRule?.enabled) {
    parts.push(`Jahrgangsgruppen 8/9 + 10+ · Größe 4${workshop.gradeGroupRule.balance ? " · Ausgleich weich" : ""}`);
  }
  return parts.join(" · ") || "keine Vorgabe";
}

function gradeGroupSummaryForPeople(workshop, people) {
  if (!workshop?.gradeGroupRule?.enabled) return [];
  const counts = { sekI: 0, sekII: 0 };
  for (const person of people || []) {
    const grade = gradeNumberFromClass(person.className);
    if (grade >= 8 && grade <= 9) counts.sekI += 1;
    if (grade >= 10) counts.sekII += 1;
  }
  return [
    { key: "sekI", label: "Sek I (Jg. 8–9)", count: counts.sekI, remainder: counts.sekI % 4 },
    { key: "sekII", label: "Sek II (Jg. 10+)", count: counts.sekII, remainder: counts.sekII % 4 },
  ];
}

function parseYesNo(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["ja", "j", "yes", "true", "1", "an", "aktiv"].includes(normalized)) return true;
  if (["nein", "n", "no", "false", "0", "aus", "inaktiv"].includes(normalized)) return false;
  return fallback;
}

function openGradeLimitsDialog(index) {
  const workshop = state.workshops[index];
  if (!workshop) return;
  editingGradeLimitsWorkshopIndex = index;
  gradeLimitsDraft = JSON.parse(JSON.stringify(workshop.gradeLimits || {}));
  $("#gradeLimitsTitle").textContent = `Jahrgangs- und Gruppenregeln: ${workshopLabel(workshop)}`;
  $("#gradeLimitsSubtitle").textContent = `Diese Zusammensetzungsregeln werden bestmöglich erfüllt. Die gesamte Kursgröße bleibt verbindlich zwischen ${workshop.min} und ${workshop.max}.`;
  renderGradeLimitsDialog();
  $("#debateRuleEnabled").checked = workshop.gradeGroupRule?.enabled === true;
  $("#debateBalanceEnabled").checked = workshop.gradeGroupRule?.balance !== false;
  $("#debateBalanceEnabled").disabled = !$("#debateRuleEnabled").checked;
  $("#gradeLimitsDialog").showModal();
}

function renderGradeLimitsDialog() {
  const workshop = state.workshops[editingGradeLimitsWorkshopIndex];
  if (!workshop) return;
  const from = Math.max(1, Math.min(20, Number(workshop.gradeFrom) || 1));
  const to = Math.max(from, Math.min(20, Number(workshop.gradeTo) || from));
  const rows = [];
  for (let grade = from; grade <= to; grade += 1) {
    const limit = gradeLimitsDraft[String(grade)] || {};
    rows.push(`<tr><td><strong>Jahrgang ${grade}</strong></td><td><input type="number" min="0" max="500" step="1" data-grade="${grade}" data-grade-limit="min" value="${limit.min ?? ""}" placeholder="–"></td><td><input type="number" min="0" max="500" step="1" data-grade="${grade}" data-grade-limit="max" value="${limit.max ?? ""}" placeholder="–"></td></tr>`);
  }
  $("#gradeLimitsTable").innerHTML = `<thead><tr><th>Jahrgang</th><th>Minimum (Ziel)</th><th>Maximum (Ziel)</th></tr></thead><tbody>${rows.join("")}</tbody>`;
}

function saveGradeLimitsDialog() {
  const workshop = state.workshops[editingGradeLimitsWorkshopIndex];
  if (!workshop) return;
  const next = {};
  const rows = [...$("#gradeLimitsTable").querySelectorAll("tbody tr")];
  for (const row of rows) {
    const minInput = row.querySelector('[data-grade-limit="min"]');
    const maxInput = row.querySelector('[data-grade-limit="max"]');
    const grade = Number(minInput?.dataset.grade || maxInput?.dataset.grade);
    const min = normalizeNullableLimit(minInput?.value);
    const max = normalizeNullableLimit(maxInput?.value);
    if (min !== null && max !== null && min > max) {
      return showDialog("Jahrgangsbelegung prüfen", `Jahrgang ${grade}: Minimum ${min} darf nicht größer als Maximum ${max} sein.`, "warning");
    }
    if (min !== null && min > workshop.max) {
      return showDialog("Jahrgangsbelegung prüfen", `Jahrgang ${grade}: Minimum ${min} ist größer als die gesamte Maximalbelegung ${workshop.max}.`, "warning");
    }
    if (min !== null || max !== null) next[String(grade)] = { min, max };
  }
  workshop.gradeLimits = next;
  workshop.gradeGroupRule = {
    enabled: $("#debateRuleEnabled").checked,
    balance: $("#debateBalanceEnabled").checked,
  };
  commit();
  renderWorkshops();
  $("#gradeLimitsDialog").close();
  toast("Jahrgangs- und Gruppenregeln gespeichert.");
}

function nextSessionLabel(offerId) {
  const used = new Set(state.workshops.filter((w) => w.offerId === offerId).map((w) => String(w.session || "").toUpperCase()));
  for (let code = 65; code <= 90; code += 1) {
    const label = String.fromCharCode(code);
    if (!used.has(label)) return label;
  }
  return String(used.size + 1);
}

function renderDashboard() {
  $("#eventName").value = state.name;
  $("#projectType").value = state.settings.projectType || "school";
  $("#classRequired").value = String(state.settings.classRequired !== false);
  $("#expectedWishes").value = String(state.settings.expectedWishes || 3);
  $("#allowOutside").value = String(state.settings.allowOutside);
  $("#defaultMode").value = state.settings.defaultMode;
  const levels = [0, 10, 50, 100];
  const nearest = levels.reduce((best, value) => Math.abs(value - state.settings.balanceWeight) < Math.abs(best - state.settings.balanceWeight) ? value : best, 0);
  $("#balanceLevel").value = String(nearest);
  $("#balanceThreshold").value = state.settings.balanceThreshold ?? 10;
  $("#qualityMode").value = state.settings.qualityMode ?? "standard";
  $("#gradePreferenceWeight").value = state.settings.gradePreferenceWeight ?? 50;
  updateGradePreferenceWeightOutput(state.settings.gradePreferenceWeight ?? 50);

  const validation = validateEvent(state);
  const cards = [
    [state.participants.length, "Teilnehmende"],
    [courseTypes().length, "Angebote"],
    [state.workshops.length, "Durchführungen"],
    [state.workshops.filter((w) => w.mode === "Pflicht").length, "Pflichtangebote"],
    [(state.settings.rules || []).filter((r) => r.enabled).length + state.workshops.filter((w) => w.gradeGroupRule?.enabled).length, "Aktive Regeln"],
    [state.participants.filter((p) => p.fixed).length, "Feste Setzungen"],
  ];
  $("#stats").innerHTML = cards.map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");

  const messages = [];
  const isEmptyProject = !state.workshops.length && !state.participants.length;
  if (isEmptyProject) {
    messages.push(`<div class="message">Das Projekt ist leer. Beginne mit „Angebote“ oder importiere unter „Datenaustausch“ eine Vorlage.</div>`);
  } else {
    validation.errors.forEach((message) => messages.push(`<div class="message error">${escapeHtml(message)}</div>`));
    validation.warnings.slice(0, 12).forEach((message) => messages.push(`<div class="message warning">${escapeHtml(message)}</div>`));
  }
  if (!messages.length) messages.push(`<div class="message">Eingaben sind grundsätzlich plausibel.</div>`);
  if (validation.warnings.length > 12) messages.push(`<div class="message warning">Weitere ${validation.warnings.length - 12} Warnungen werden beim Berechnen angezeigt.</div>`);
  $("#validationSummary").innerHTML = messages.join("");
  renderRules();
}

function renderEnrollmentCheck() {
  const check = buildEnrollmentCheck(state);
  const target = $("#enrollmentStats");
  const table = $("#enrollmentIssuesTable");
  if (!target || !table) return;
  target.innerHTML = [
    [state.participants.length, "Importierte Personen"],
    [check.valid, "Einwahl plausibel"],
    [check.review, "Zu prüfen"],
    [check.duplicateWishes, "Mehrfachwünsche"],
    [check.missingClass, "Klasse fehlt"],
  ].map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");

  const rows = check.rows.filter((row) => row.issues.length);
  table.innerHTML = `<thead><tr><th>Status</th><th>Person</th><th>Klasse</th><th>Prüfhinweis</th></tr></thead><tbody>${rows.map((row) => `
    <tr><td><span class="badge warn">Zu prüfen</span></td>
      <td><strong>${escapeHtml(`${row.firstName} ${row.lastName}`.trim() || row.personId)}</strong><small>${escapeHtml(row.personId)}</small></td>
      <td>${escapeHtml(row.className || "–")}</td>
      <td>${row.issues.map((issue) => `<div>${escapeHtml(issue)}</div>`).join("")}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Alle vorhandenen Einwahlen sind plausibel.</td></tr>`}</tbody>`;
}

function ruleTypeName(type) {
  return ({
    class: "Pro Klasse",
    grade: "Pro Jahrgang",
    gradeForm: "Jahrgang + Bildungsgang",
    gradeAnyForm: "Jahrgang: mindestens ein Bildungsgang",
  })[type] || type;
}

function renderRules() {
  const rules = state.settings.rules || [];
  $("#rulesTable").innerHTML = `
    <thead><tr><th>Aktiv</th><th>Regel</th><th>Mindestens</th><th>Verbindlichkeit</th><th></th></tr></thead>
    <tbody>${rules.map((rule, index) => `<tr data-index="${index}">
      <td><input type="checkbox" data-rule-field="enabled" ${rule.enabled ? "checked" : ""}></td>
      <td><select data-rule-field="type">
        ${["class","grade","gradeForm","gradeAnyForm"].map((type) => option(type, rule.type, ruleTypeName(type))).join("")}
      </select></td>
      <td><input type="number" min="2" max="20" step="1" data-rule-field="min" value="${rule.min}"></td>
      <td><select data-rule-field="mode">${option("preferred", rule.mode, "Bevorzugt")}${option("hard", rule.mode, "Vorrangig")}</select></td>
      <td><button class="icon-button" data-action="delete-rule" title="Regel löschen">×</button></td>
    </tr>`).join("") || `<tr><td colspan="5" class="muted">Keine zusätzliche Regel. Das ist völlig in Ordnung.</td></tr>`}</tbody>`;
}

function addRule() {
  state.settings.rules = state.settings.rules || [];
  state.settings.rules.push({ id: `R${Date.now()}`, type: "gradeForm", min: 2, mode: "preferred", enabled: true });
  commit();
  renderRules();
  $("#rulesDetails").open = true;
}

function handleRuleChange(event) {
  const control = event.target.closest("[data-rule-field]");
  if (!control) return;
  const row = control.closest("tr");
  const rule = state.settings.rules?.[Number(row?.dataset.index)];
  if (!rule) return;
  const field = control.dataset.ruleField;
  if (field === "enabled") rule.enabled = control.checked;
  else if (field === "min") rule.min = Math.max(2, Number(control.value) || 2);
  else rule[field] = control.value;
  commit();
}

function handleRuleClick(event) {
  const button = event.target.closest('[data-action="delete-rule"]');
  if (!button) return;
  const index = Number(button.closest("tr")?.dataset.index);
  state.settings.rules.splice(index, 1);
  commit();
  renderRules();
}

function renderWorkshops() {
  const rows = state.workshops.map((w, index) => `
    <tr data-index="${index}">
      <td class="row-number">${index + 1}</td>
      <td><input data-entity="workshop" data-field="id" value="${escapeHtml(w.id)}" title="Eindeutige ID dieser Durchführung"></td>
      <td><input data-entity="workshop" data-field="offerId" value="${escapeHtml(w.offerId)}" title="Gleiche Angebots-ID = ein gemeinsamer Wunsch"></td>
      <td><input data-entity="workshop" data-field="name" value="${escapeHtml(w.name)}"></td>
      <td><input data-entity="workshop" data-field="session" value="${escapeHtml(w.session)}" placeholder="A"></td>
      <td><input type="number" min="1" max="20" data-entity="workshop" data-field="gradeFrom" value="${w.gradeFrom}"></td>
      <td><input type="number" min="1" max="20" data-entity="workshop" data-field="gradeTo" value="${w.gradeTo}"></td>
      <td><select data-entity="workshop" data-field="schoolForm">${["Alle", "Regional", "Gymnasial"].map((v) => option(v, w.schoolForm)).join("")}</select></td>
      <td><input type="number" min="0" max="20" data-entity="workshop" data-field="cohortMin" value="${w.cohortMin ?? ""}" placeholder="global" title="leer = global, 0 = aus"></td>
      <td><input type="number" min="0" max="500" data-entity="workshop" data-field="min" value="${w.min}"></td>
      <td><input type="number" min="1" max="500" data-entity="workshop" data-field="max" value="${w.max}"></td>
      <td class="grade-limit-cell"><button class="button compact-button grade-limit-button" type="button" data-action="edit-grade-limits" title="Jahrgangsgrenzen und Jahrgangsgruppen-Regel festlegen">Jahrgänge & Gruppen …</button><small>${escapeHtml(gradeLimitSummary(w))}</small></td>
      <td><select data-entity="workshop" data-field="mode">${["Pflicht", "Optional"].map((v) => option(v, w.mode)).join("")}</select></td>
      <td class="row-actions"><button class="icon-button" data-action="duplicate-workshop" title="Weitere Durchführung desselben Angebots">＋</button><button class="icon-button" data-action="delete-workshop" title="Löschen">×</button></td>
    </tr>`).join("");
  $("#workshopsTable").innerHTML = `
    <thead><tr><th>#</th><th>Durchführungs-ID</th><th>Angebots-ID</th><th>Angebot</th><th>Gruppe</th><th>Klasse von</th><th>Klasse bis</th><th>Bildungsgang</th><th>Kohorte min. (bestmöglich)</th><th>Mindestziel</th><th>Maximum</th><th>Jahrgangs- & Gruppenregeln</th><th>Pflicht/Optional</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="14">Keine Angebote eingetragen.</td></tr>`}</tbody>`;
}

function renderParticipants() {
  const query = $("#participantSearch").value.trim().toLowerCase();
  const wishOptions = [`<option value="">–</option>`, ...courseTypes().map((course) => `<option value="${escapeHtml(course.id)}">${escapeHtml(course.id)} · ${escapeHtml(course.name)}</option>`)].join("");
  const fixedOptions = [`<option value="">–</option>`, ...state.workshops.map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.id)} · ${escapeHtml(workshopLabel(w))}</option>`)].join("");
  const visible = state.participants.map((p, index) => ({ p, index })).filter(({ p }) => {
    if (!query) return true;
    return [p.id, p.firstName, p.lastName, p.className, p.schoolForm].join(" ").toLowerCase().includes(query);
  });
  const wishCount = Math.max(1, Math.min(4, Number(state.settings.expectedWishes) || 3));

  const rows = visible.map(({ p, index }) => {
    const wishSelect = (slot) => `<select data-entity="participant" data-field="wish${slot}">${wishOptions.replace(`value="${escapeHtml(p.wishes[slot])}"`, `value="${escapeHtml(p.wishes[slot])}" selected`)}</select>`;
    const fixedSelect = `<select data-entity="participant" data-field="fixed">${fixedOptions.replace(`value="${escapeHtml(p.fixed)}"`, `value="${escapeHtml(p.fixed)}" selected`)}</select>`;
    const wishCells = Array.from({ length: wishCount }, (_, slot) => `<td>${wishSelect(slot)}</td>`).join("");
    return `<tr data-index="${index}">
      <td class="row-number">${index + 1}</td>
      <td><input data-entity="participant" data-field="id" value="${escapeHtml(p.id)}"></td>
      <td><input data-entity="participant" data-field="firstName" value="${escapeHtml(p.firstName)}"></td>
      <td><input data-entity="participant" data-field="lastName" value="${escapeHtml(p.lastName)}"></td>
      <td><input data-entity="participant" data-field="className" value="${escapeHtml(p.className)}"></td>
      <td><select data-entity="participant" data-field="schoolForm">${["Regional", "Gymnasial"].map((v) => option(v, p.schoolForm)).join("")}</select></td>
      ${wishCells}
      <td>${fixedSelect}</td>
      <td><button class="icon-button" data-action="delete-participant" title="Löschen">×</button></td>
    </tr>`;
  }).join("");
  const wishHeaders = Array.from({ length: wishCount }, (_, index) => `<th>${index + 1}. Wunsch</th>`).join("");

  $("#participantsTable").innerHTML = `
    <thead><tr><th>#</th><th>Person-ID</th><th>Vorname</th><th>Nachname</th><th>Klasse</th><th>Bildungsgang</th>${wishHeaders}<th>Feste Setzung (Durchführung)</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="${8 + wishCount}">Keine passenden Teilnehmenden.</td></tr>`}</tbody>`;
}

function renderLocks() {
  const personOptions = [`<option value="">–</option>`, ...state.participants.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.id)} · ${escapeHtml(p.lastName)}, ${escapeHtml(p.firstName)}</option>`)].join("");
  const workshopOptions = [`<option value="">–</option>`, ...state.workshops.map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.id)} · ${escapeHtml(workshopLabel(w))}</option>`)].join("");
  const rows = state.locks.map((lock, index) => `
    <tr data-index="${index}">
      <td class="row-number">${index + 1}</td>
      <td><select data-entity="lock" data-field="personId">${personOptions.replace(`value="${escapeHtml(lock.personId)}"`, `value="${escapeHtml(lock.personId)}" selected`)}</select></td>
      <td><select data-entity="lock" data-field="workshopId">${workshopOptions.replace(`value="${escapeHtml(lock.workshopId)}"`, `value="${escapeHtml(lock.workshopId)}" selected`)}</select></td>
      <td><input data-entity="lock" data-field="reason" value="${escapeHtml(lock.reason)}"></td>
      <td><button class="icon-button" data-action="delete-lock" title="Löschen">×</button></td>
    </tr>`).join("");
  $("#locksTable").innerHTML = `
    <thead><tr><th>#</th><th>Person</th><th>Angebot</th><th>Grund</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5">Keine Sperrungen eingetragen.</td></tr>`}</tbody>`;
}

function statCards(stats) {
  const totalChoices = Math.max(1, (stats.first || 0) + (stats.second || 0) + (stats.third || 0) + (stats.fourth || 0) + (stats.outside || 0));
  const pct = (value) => `${Math.round(100 * (value || 0) / totalChoices)} %`;
  const items = [
    [`${stats.first} (${pct(stats.first)})`, "Erstwünsche"],
    [`${stats.second} (${pct(stats.second)})`, "Zweitwünsche"],
    [`${stats.third} (${pct(stats.third)})`, "Drittwünsche"],
    [`${stats.fourth} (${pct(stats.fourth)})`, "Viertwünsche"],
    [stats.maxThirdPerCourse ?? 0, "Max. Drittwünsche / Kurs"],
    [stats.maxFourthPerCourse ?? 0, "Max. Viertwünsche / Kurs"],
    [stats.unassigned, "Ohne Zuteilung"],
    [stats.capacityDeviation ?? 0, "Plätze über Maximum"],
    [stats.largeCourseSpread ?? "–", "Spannweite große Kurse"],
    [stats.ruleViolationCount ?? 0, "Regelabweichungen"],
    [`${stats.gradePreferenceWeight ?? 50} %`, "Gewicht Jahrgangsverteilung"],
    [stats.gradeGroupImbalance ?? 0, "Differenz Jahrgangsgruppen"],
    [stats.meanDeviation.toFixed(2), "Ø Zielabweichung"],
    [result?.quality ? `${result.quality.successfulRuns}/${result.quality.runsTried}` : "–", "Qualitätsläufe"],
  ];
  return items.map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function recordAudit(action, personId, courseId, message) {
  state.auditLog = Array.isArray(state.auditLog) ? state.auditLog : [];
  state.auditLog.push({
    id: `A${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    action,
    personId: personId || "",
    courseId: courseId || "",
    message,
  });
  state.auditLog = state.auditLog.slice(-100);
  scheduleSave();
  renderAuditLog();
}

function renderAuditLog() {
  const target = $("#auditLog");
  if (!target) return;
  const entries = [...(state.auditLog || [])].reverse();
  target.innerHTML = entries.length
    ? entries.map((entry) => {
      const date = entry.timestamp ? new Date(entry.timestamp) : null;
      const time = date && !Number.isNaN(date.getTime())
        ? date.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })
        : "Zeit unbekannt";
      return `<div class="audit-entry"><time datetime="${escapeHtml(entry.timestamp)}">${escapeHtml(time)}</time><div><strong>${escapeHtml(entry.action)}</strong><br>${escapeHtml(entry.message)}</div></div>`;
    }).join("")
    : `<div class="empty-state">Noch keine manuelle Änderung protokolliert.</div>`;
}

function recommendationState(recommendation, { preview = false } = {}) {
  const next = JSON.parse(JSON.stringify(state));
  const courses = next.workshops.filter((course) => course.offerId === recommendation.offerId);
  if (recommendation.type === "capacity" && courses.length) {
    const target = courses.sort((a, b) => b.max - a.max || a.id.localeCompare(b.id, "de"))[0];
    target.max += recommendation.delta;
  }
  if (recommendation.type === "minimum" && courses.length) {
    const current = courses.reduce((sum, course) => sum + course.min, 0);
    const targetTotal = Math.max(0, Math.min(current, recommendation.suggestedMinimum));
    let remaining = targetTotal;
    courses.forEach((course, index) => {
      const share = index === courses.length - 1
        ? remaining
        : Math.min(remaining, Math.floor(targetTotal * (course.min / Math.max(1, current))));
      course.min = Math.min(course.max, share);
      remaining -= course.min;
    });
  }
  if (preview) next.settings.qualityMode = "fast";
  return normalizeEvent(next);
}

function refreshPlanningAnalysis({ simulate = true } = {}) {
  const demand = buildDemandStats(state, result);
  const recommendations = buildBottleneckRecommendations(state, result, demand);
  if (simulate && result?.ok) {
    recommendations.filter((item) => ["capacity", "minimum"].includes(item.type)).slice(0, 6).forEach((item) => {
      const preview = optimizeEvent(recommendationState(item, { preview: true }));
      if (!preview.ok) return;
      item.impact = {
        unassigned: (result.stats.unassigned || 0) - (preview.stats.unassigned || 0),
        first: (preview.stats.first || 0) - (result.stats.first || 0),
        rules: (result.stats.ruleViolationCount || 0) - (preview.stats.ruleViolationCount || 0),
      };
    });
  }
  planningInsights = { demand, recommendations };
  renderPlanning();
}

function demandStatusBadge(item) {
  const cls = item.status === "over" ? "bad" : item.status === "under" ? "warn" : item.status === "tight" ? "good" : "warn";
  return `<span class="badge ${cls}">${escapeHtml(item.statusLabel)}</span>`;
}

function impactText(impact) {
  if (!impact) return "";
  const parts = [];
  if (impact.unassigned) parts.push(`${impact.unassigned > 0 ? impact.unassigned + " weniger" : Math.abs(impact.unassigned) + " mehr"} unzugeteilt`);
  if (impact.first) parts.push(`${impact.first > 0 ? "+" : ""}${impact.first} Erstwünsche`);
  if (impact.rules) parts.push(`${impact.rules > 0 ? impact.rules + " weniger" : Math.abs(impact.rules) + " mehr"} Regelabweichungen`);
  return parts.length ? `Wirkungsvorschau: ${parts.join(" · ")}` : "Wirkungsvorschau: Ergebnis voraussichtlich unverändert";
}

function renderPlanning() {
  const demand = [...(planningInsights?.demand || buildDemandStats(state, result))];
  const recommendations = planningInsights?.recommendations || buildBottleneckRecommendations(state, result, demand);
  const sort = $("#demandSort")?.value || "popularity";
  demand.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "de");
    if (sort === "pressure") return b.pressure - a.pressure || b.totalDemand - a.totalDemand;
    return b.weightedPopularity - a.weightedPopularity || a.name.localeCompare(b.name, "de");
  });
  const totalWishes = demand.reduce((sum, item) => sum + item.totalDemand, 0);
  const over = demand.filter((item) => item.status === "over").length;
  const under = demand.filter((item) => item.status === "under").length;
  const critical = demand.reduce((sum, item) => sum + item.criticalDemand, 0);
  $("#planningStats").innerHTML = [
    [totalWishes, "Eingetragene Wünsche"], [over, "Überfragte Angebote"], [under, "Mindestgröße gefährdet"], [critical, "Nur ein zulässiger Wunsch"],
  ].map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
  $("#demandTable").innerHTML = `<thead><tr><th>Angebot</th><th>1. Wunsch</th><th>2.</th><th>3.</th><th>4.</th><th>Gesamt</th><th>Zulässig</th><th>Kritisch</th><th>Kapazität</th><th>Zugeordnet</th><th>Auslastung</th><th>Status</th></tr></thead><tbody>${demand.map((item) => `<tr>
    <td><strong>${escapeHtml(item.name)}</strong><br><small class="muted">${item.sessions.length} Durchführung(en)</small></td>
    ${item.rankCounts.map((value) => `<td>${value}</td>`).join("")}<td><strong>${item.totalDemand}</strong></td><td>${item.eligibleDemand}</td><td>${item.criticalDemand}</td><td>${item.capacity}</td><td>${item.assigned}</td>
    <td><span class="demand-pressure"><meter min="0" max="1.5" value="${Number.isFinite(item.pressure) ? Math.min(1.5, item.pressure) : 1.5}"></meter>${Number.isFinite(item.pressure) ? Math.round(item.pressure * 100) + " %" : "∞"}</span></td><td>${demandStatusBadge(item)}</td>
  </tr>`).join("") || `<tr><td colspan="12" class="muted">Noch keine Angebote vorhanden.</td></tr>`}</tbody>`;
  $("#bottleneckList").innerHTML = recommendations.length
    ? recommendations.map((item) => `<div class="insight-card ${item.type === "global" ? "global" : ""}"><div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.message)}</p>${item.impact ? `<p class="impact-preview">${escapeHtml(impactText(item.impact))}</p>` : ""}</div>${item.actionLabel ? `<button class="button" type="button" data-action="apply-recommendation" data-recommendation-id="${escapeHtml(item.id)}">${escapeHtml(item.actionLabel)}</button>` : ""}</div>`).join("")
    : `<div class="message success">Keine unmittelbaren Kapazitäts- oder Mindestgrößenengpässe erkannt.</div>`;
  renderComparison();
}

async function runSolutionComparison() {
  const profiles = [
    { id: "wishes", label: "Wunschorientiert", description: "Wünsche entscheiden, Verteilung und Ausgleich greifen nur bei Gleichstand.", weight: 0, balance: 0 },
    { id: "balanced", label: "Ausgewogen", description: "Wünsche, Jahrgangsverteilung und Kursgrößen werden gemeinsam betrachtet.", weight: 50, balance: 50 },
    { id: "rules", label: "Verteilungsorientiert", description: "Jahrgangsregeln und gleichmäßige große Kurse erhalten deutlich mehr Gewicht.", weight: 100, balance: 100 },
  ];
  const button = $("#compareSolutionsBtn");
  const notice = $("#comparisonNotice");
  const cards = $("#comparisonCards");
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "Vergleich läuft …";
  comparisonResults = [];
  try {
    for (let index = 0; index < profiles.length; index += 1) {
      const profile = profiles[index];
      notice.className = "message";
      notice.textContent = `Berechne Lösung ${index + 1} von ${profiles.length}: ${profile.label} …`;
      cards.innerHTML = `<div class="comparison-progress"><strong>${index + 1} / ${profiles.length}</strong><span>${escapeHtml(profile.label)} wird berechnet. Bei vielen Schülern kann dieser Schritt einen Moment dauern.</span><progress max="3" value="${index + 1}"></progress></div>`;
      await new Promise((resolve) => setTimeout(resolve, 40));
      const input = JSON.parse(JSON.stringify(state));
      input.settings.gradePreferenceWeight = profile.weight;
      input.settings.balanceWeight = profile.balance;
      // Der Vergleich verwendet immer sechs Varianten. Dadurch bleibt er
      // aussagekräftig, ohne bei der gründlichen 24er-Stufe 72 Läufe zu starten.
      input.settings.qualityMode = "standard";
      const calculated = optimizeEvent(input);
      comparisonResults.push({ ...profile, result: calculated });
    }
    renderComparison();
  } catch (error) {
    comparisonResults = [];
    notice.className = "message error";
    notice.textContent = `Der Lösungsvergleich wurde abgebrochen: ${error instanceof Error ? error.message : String(error)}`;
    cards.innerHTML = "";
  } finally {
    button.disabled = false;
    button.textContent = "Drei Lösungen vergleichen";
  }
}

function renderComparison() {
  const notice = $("#comparisonNotice");
  const cards = $("#comparisonCards");
  if (!comparisonResults.length) {
    notice.className = "message";
    notice.textContent = "Noch kein Vergleich berechnet.";
    cards.innerHTML = "";
    return;
  }
  const successful = comparisonResults.filter((item) => item.result?.ok);
  const reference = successful[0]?.result;
  const maxDifference = successful.reduce((max, item) => Math.max(max, assignmentDifference(reference, item.result)), 0);
  notice.className = `message ${maxDifference ? "success" : "warning"}`;
  notice.textContent = maxDifference
    ? `Die Einstellungen verändern bei diesen Daten bis zu ${maxDifference} konkrete Schülerzuordnungen.`
    : "Die drei Einstellungen führen bei diesen Daten zur gleichen Schülerzuordnung. Die Regler wirken, aber es gibt hier keinen echten Zielkonflikt zwischen den gefundenen Lösungen.";
  cards.innerHTML = comparisonResults.map((profile) => {
    if (!profile.result?.ok) return `<div class="comparison-card"><h4>${escapeHtml(profile.label)}</h4><div class="message error">Keine Lösung: ${escapeHtml(profile.result?.errors?.[0] || "unbekannter Fehler")}</div></div>`;
    const stats = profile.result.stats;
    const selected = result?.ok && assignmentDifference(result, profile.result) === 0;
    return `<div class="comparison-card ${selected ? "selected" : ""}"><h4>${escapeHtml(profile.label)}</h4><p>${escapeHtml(profile.description)}</p><div class="comparison-metrics">
      <div class="comparison-metric"><strong>${stats.unassigned}</strong><span>unzugeteilt</span></div><div class="comparison-metric"><strong>${stats.first}</strong><span>Erstwünsche</span></div>
      <div class="comparison-metric"><strong>${stats.ruleViolationCount}</strong><span>Regelabweichungen</span></div><div class="comparison-metric"><strong>${stats.largeCourseSpread}</strong><span>Kursspannweite</span></div>
    </div><small class="muted">${reference ? assignmentDifference(reference, profile.result) : 0} Zuordnung(en) anders als Profil 1</small><button class="button primary" type="button" data-action="apply-comparison" data-profile-id="${escapeHtml(profile.id)}">Diese Lösung übernehmen</button></div>`;
  }).join("");
}

function applyPlanningRecommendation(id) {
  const item = planningInsights?.recommendations?.find((entry) => entry.id === id);
  if (!item || !item.actionLabel) return;
  if (!confirm(`${item.actionLabel}?\n\n${item.title}\n${item.message}`)) return;
  state = recommendationState(item);
  recordAudit("Planungsempfehlung", "", item.offerId, `${item.title}: ${item.actionLabel}`);
  commit();
  planningInsights = null;
  refreshPlanningAnalysis({ simulate: false });
  toast("Planungsempfehlung übernommen. Bitte Zuteilung neu berechnen.");
}

function wishQualityForCourse(courseId) {
  const rows = result?.participantResults?.filter((row) => row.workshopId === courseId) || [];
  const counts = { Erstwunsch: 0, Zweitwunsch: 0, Drittwunsch: 0, Viertwunsch: 0, "Feste Setzung": 0, "Kein Wunsch": 0 };
  rows.forEach((row) => { if (counts[row.type] !== undefined) counts[row.type] += 1; });
  const parts = [];
  if (counts.Erstwunsch) parts.push(`${counts.Erstwunsch}× 1.`);
  if (counts.Zweitwunsch) parts.push(`${counts.Zweitwunsch}× 2.`);
  if (counts.Drittwunsch) parts.push(`${counts.Drittwunsch}× 3.`);
  if (counts.Viertwunsch) parts.push(`${counts.Viertwunsch}× 4.`);
  if (counts["Feste Setzung"]) parts.push(`${counts["Feste Setzung"]} fest`);
  if (counts["Kein Wunsch"]) parts.push(`${counts["Kein Wunsch"]} außerhalb`);
  return parts.join(" · ") || "–";
}

function resultRuleBadge(course) {
  if (course.ruleDeviations) return `<span class="badge warn">${course.ruleDeviations} Abweichung(en)</span>`;
  return `<span class="badge good">erfüllt</span>`;
}

function unassignedRows() {
  return (result?.participantResults || [])
    .filter((row) => !row.workshopId)
    .sort((a, b) => a.lastName.localeCompare(b.lastName, "de") || a.firstName.localeCompare(b.firstName, "de"));
}

function findSeatCreationPlan(personId, targetCourseId) {
  const target = courseById(targetCourseId);
  if (!target || target.load < target.max) return null;
  const occupants = result.participantResults.filter((row) => row.workshopId === targetCourseId);
  for (const occupantRow of occupants) {
    const occupant = participantStateById(occupantRow.personId);
    if (!occupant || occupant.fixed) continue;
    const alternatives = result.courseResults
      .filter((course) => course.open && course.id !== targetCourseId && course.load < course.max)
      .filter((course) => occupant.wishes.includes(course.offerId) && !manualEligibility(occupant, course))
      .sort((a, b) => occupant.wishes.indexOf(a.offerId) - occupant.wishes.indexOf(b.offerId) || a.load - b.load);
    if (alternatives[0]) return { occupantRow, occupant, alternative: alternatives[0], target };
  }
  return null;
}

function suggestionActions(row, suggestion, suggestionNumber, compact = false) {
  if (!suggestion.courseId) return "";
  const person = participantStateById(row.personId);
  const target = courseById(suggestion.courseId);
  const eligible = person && target && !manualEligibility(person, target);
  const plan = eligible ? findSeatCreationPlan(row.personId, suggestion.courseId) : null;
  const free = target?.open && target.load < target.max;
  const canApply = eligible && (free || plan);
  const buttons = [];
  if (canApply) {
    const label = plan ? `Vorschlag ${suggestionNumber} per Platztausch` : `Vorschlag ${suggestionNumber} anwenden`;
    buttons.push(`<button class="button primary ${compact ? "compact-button" : ""}" type="button" data-action="apply-unassigned-suggestion" data-person-id="${escapeHtml(row.personId)}" data-course-id="${escapeHtml(suggestion.courseId)}">${escapeHtml(label)}</button>`);
  }
  if (eligible && target && target.load >= target.max) {
    const next = target.load + 1;
    const over = next - target.max;
    buttons.push(`<button class="button warning-button ${compact ? "compact-button" : ""}" type="button" data-action="overbook-unassigned-suggestion" data-person-id="${escapeHtml(row.personId)}" data-course-id="${escapeHtml(suggestion.courseId)}">Manuell überbelegen → ${next}/${target.max} (+${over})</button>`);
  }
  if (!buttons.length && target) buttons.push(`<button class="button ${compact ? "compact-button" : ""}" type="button" data-action="open-suggestion-course" data-course-id="${escapeHtml(target.id)}">Kurs prüfen</button>`);
  return buttons.join("");
}

function suggestionListHtml(row, compact = false) {
  const suggestions = (row.unassignedSuggestions || []).filter((item) => item.courseId);
  return suggestions.length ? `<div class="diagnostic-suggestions">${suggestions.map((suggestion, index) => `<div class="diagnostic-suggestion-row"><div><strong>Vorschlag ${index + 1}</strong><br>${escapeHtml(suggestion.text)}</div><div class="diagnostic-suggestion-actions">${suggestionActions(row, suggestion, index + 1, compact)}</div></div>`).join("")}</div>` : `<span class="muted">Kein Vorschlag innerhalb der Wünsche verfügbar.</span>`;
}

function renderUnassignedDiagnostics() {
  const rows = unassignedRows();
  const card = $("#unassignedDiagnosticsCard");
  const review = $("#reviewModeCard");
  card.hidden = !rows.length;
  review.hidden = !rows.length;
  if (!rows.length) return;
  $("#unassignedDiagnosticsTable").innerHTML = `<thead><tr><th>Schüler</th><th>Warum nicht zugeteilt?</th><th>Vorschläge innerhalb der Wünsche</th></tr></thead><tbody>${rows.map((row) => `<tr><td class="diagnostic-person"><strong>${escapeHtml(row.lastName)}, ${escapeHtml(row.firstName)}</strong><small>${escapeHtml(row.personId)} · Klasse ${escapeHtml(row.className)}</small></td><td>${escapeHtml(row.unassignedReason || row.note)}</td><td>${suggestionListHtml(row)}</td></tr>`).join("")}</tbody>`;
  reviewIndex = Math.max(0, Math.min(reviewIndex, rows.length - 1));
  const current = rows[reviewIndex];
  $("#reviewProgress").textContent = `${reviewIndex + 1} von ${rows.length}`;
  $("#reviewModeBody").innerHTML = `<div class="review-person"><h4>${escapeHtml(current.firstName)} ${escapeHtml(current.lastName)} · Klasse ${escapeHtml(current.className)}</h4><div class="message warning">${escapeHtml(current.unassignedReason || current.note)}</div>${suggestionListHtml(current, true)}<p class="section-help">Eine normale oder per Platztausch umgesetzte Entscheidung wird als feste Setzung geschützt. Eine manuelle Überbelegung wird protokolliert, aber nicht automatisch festgesetzt.</p></div>`;
  $("#reviewPrevBtn").disabled = reviewIndex === 0;
  $("#reviewNextBtn").disabled = reviewIndex >= rows.length - 1;
}

function renderResults() {
  const placeholder = $("#resultPlaceholder");
  const content = $("#resultContent");
  if (!result?.ok) {
    placeholder.hidden = false;
    content.hidden = true;
    return;
  }
  placeholder.hidden = true;
  content.hidden = false;
  $("#resultStats").innerHTML = statCards(result.stats);
  $("#courseResultsTable").innerHTML = `
    <thead><tr><th>Kurs</th><th>Belegung</th><th>Ziel</th><th>Mindestziel / Max</th><th>Wunschqualität</th><th>Regeln</th><th>Status</th><th></th></tr></thead>
    <tbody>${result.courseResults.map((course) => `<tr class="course-result-row" data-course-id="${escapeHtml(course.id)}">
      <td><strong>${escapeHtml(workshopLabel(course))}</strong></td>
      <td>${course.load}</td><td>${course.target}</td><td>${course.effectiveMin} / ${course.max}</td>
      <td>${escapeHtml(wishQualityForCourse(course.id))}</td>
      <td>${resultRuleBadge(course)}</td>
      <td><span class="badge ${course.open && !course.courseMinimumDeviation && !course.capacityDeviation ? "good" : "warn"}">${escapeHtml(course.status)}</span></td>
      <td><button class="button compact-button" type="button" data-action="open-course-detail" data-course-id="${escapeHtml(course.id)}">Details</button></td>
    </tr>`).join("")}</tbody>`;
  $("#participantResultsTable").innerHTML = `
    <thead><tr><th>Nachname</th><th>Vorname</th><th>Klasse</th><th>Angebot</th><th>Zuteilungsart</th><th>Hinweis</th></tr></thead>
    <tbody>${[...result.participantResults].sort((a, b) => a.lastName.localeCompare(b.lastName, "de") || a.firstName.localeCompare(b.firstName, "de")).map((row) => `<tr>
      <td>${escapeHtml(row.lastName)}</td><td>${escapeHtml(row.firstName)}</td><td>${escapeHtml(row.className)}</td>
      <td>${escapeHtml(row.workshopName || "–")}</td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.note)}</td>
    </tr>`).join("")}</tbody>`;
  renderUnassignedDiagnostics();
  renderAuditLog();
}

function courseById(id) {
  return result?.courseResults?.find((course) => course.id === id) || null;
}

function participantStateById(id) {
  return state.participants.find((person) => person.id === id) || null;
}

function participantResultById(id) {
  return result?.participantResults?.find((person) => person.personId === id) || null;
}

function hardGroupingKey(rule, person) {
  const grade = String(person.className || "").match(/^(\d{1,2})/)?.[1] || "";
  if (rule.type === "class") return String(person.className || "");
  if (rule.type === "grade") return grade;
  if (rule.type === "gradeForm") return `${grade}\u0000${person.schoolForm}`;
  return grade;
}

function hardViolationsForCourseFromResult(courseId) {
  const course = state.workshops.find((item) => item.id === courseId);
  if (!course) return [];
  const assigned = result.participantResults.filter((row) => row.workshopId === courseId).map((row) => participantStateById(row.personId)).filter(Boolean);
  const violations = [];
  const hardRules = (state.settings.rules || []).filter((rule) => rule.enabled && rule.mode === "hard");
  const rules = hardRules.filter((rule) => rule.type !== "gradeForm");
  for (const rule of rules) {
    if (rule.type !== "gradeAnyForm") {
      const groups = new Map();
      assigned.forEach((person) => {
        const key = hardGroupingKey(rule, person);
        if (!key) return;
        groups.set(key, (groups.get(key) || 0) + 1);
      });
      for (const [key, count] of groups) if (count > 0 && count < rule.min) violations.push(`${ruleTypeName(rule.type)} ${key}: ${count} < ${rule.min}`);
    } else {
      const byGrade = new Map();
      assigned.forEach((person) => {
        const grade = hardGroupingKey(rule, person);
        if (!byGrade.has(grade)) byGrade.set(grade, new Map());
        const forms = byGrade.get(grade);
        forms.set(person.schoolForm, (forms.get(person.schoolForm) || 0) + 1);
      });
      for (const [grade, forms] of byGrade) {
        const max = Math.max(0, ...forms.values());
        if (max > 0 && max < rule.min) violations.push(`Jahrgang ${grade}: kein Bildungsgang erreicht ${rule.min}`);
      }
    }
  }
  const gradeCounts = new Map();
  assigned.forEach((person) => {
    const grade = gradeNumberFromClass(person.className);
    if (Number.isFinite(grade)) gradeCounts.set(grade, (gradeCounts.get(grade) || 0) + 1);
  });
  for (const limit of gradeLimitEntriesForWorkshop(course)) {
    const count = gradeCounts.get(limit.grade) || 0;
    if (limit.min !== null && count < limit.min) violations.push(`Jahrgang ${limit.grade}: ${count} < Minimum ${limit.min}`);
    if (limit.max !== null && count > limit.max) violations.push(`Jahrgang ${limit.grade}: ${count} > Maximum ${limit.max}`);
  }
  for (const group of gradeGroupSummaryForPeople(course, assigned)) {
    if (group.remainder !== 0) violations.push(`${group.label}: ${group.count} ist nicht durch 4 teilbar`);
  }

  const configuredCohortMin = course.cohortMin === null ? (state.settings.cohortMin || 0) : course.cohortMin;
  const gradeFormMin = Math.max(
    configuredCohortMin,
    ...hardRules.filter((rule) => rule.type === "gradeForm").map((rule) => Number(rule.min) || 0),
  );
  if (gradeFormMin >= 2) {
    const groups = new Map();
    assigned.forEach((person) => {
      const grade = String(person.className || "").match(/^(\d{1,2})/)?.[1] || "";
      const key = `${grade} / ${person.schoolForm}`;
      groups.set(key, (groups.get(key) || 0) + 1);
    });
    for (const [key, count] of groups) if (count > 0 && count < gradeFormMin) violations.push(`${key}: ${count} < ${gradeFormMin}`);
  }
  return violations;
}

function manualEligibility(person, course) {
  const grade = Number(String(person.className || "").match(/^(\d{1,2})/)?.[1]);
  if (!Number.isFinite(grade) || grade < course.gradeFrom || grade > course.gradeTo) return "Klassenstufe passt nicht.";
  if (course.schoolForm !== "Alle" && course.schoolForm !== person.schoolForm) return "Bildungsgang passt nicht.";
  if (state.locks.some((lock) => lock.personId === person.id && lock.workshopId === course.id)) return "Diese Kombination ist gesperrt.";
  return "";
}

function snapshotResult() {
  resultUndoStack.push({
    result: JSON.parse(JSON.stringify(result)),
    fixed: Object.fromEntries(state.participants.map((person) => [person.id, person.fixed || ""])),
  });
  if (resultUndoStack.length > 20) resultUndoStack.shift();
}

function restoreResultSnapshot() {
  const snapshot = resultUndoStack.pop();
  if (!snapshot) return false;
  result = snapshot.result || snapshot;
  if (snapshot.fixed) state.participants.forEach((person) => { person.fixed = snapshot.fixed[person.id] || ""; });
  scheduleSave();
  return true;
}

function refreshResultAfterManualChange() {
  const courseMap = new Map(state.workshops.map((course) => [course.id, course]));
  const personMap = new Map(state.participants.map((person) => [person.id, person]));
  const loads = new Map(state.workshops.map((course) => [course.id, 0]));
  const lockSet = new Set(state.locks.map((lock) => `${lock.personId}\u0000${lock.workshopId}`));
  const openSet = new Set(result.courseResults.filter((course) => course.open).map((course) => course.id));
  for (const row of result.participantResults) {
    const person = personMap.get(row.personId);
    const course = courseMap.get(row.workshopId);
    if (row.workshopId) loads.set(row.workshopId, (loads.get(row.workshopId) || 0) + 1);
    row.workshopName = course ? workshopLabel(course) : "";
    row.offerId = course?.offerId || "";
    row.courseTypeName = course?.name || "";
    row.session = course?.session || "";
    if (person && course) {
      const idx = person.wishes.findIndex((wish) => wish === course.offerId);
      row.type = person.fixed === course.id ? "Feste Setzung" : (["Erstwunsch","Zweitwunsch","Drittwunsch","Viertwunsch"][idx] || "Kein Wunsch");
    } else row.type = "Nicht zugeteilt";
  }
  for (const course of result.courseResults) {
    course.load = loads.get(course.id) || 0;
    course.deviation = course.open ? course.load - course.target : 0;
    const assignedPeople = result.participantResults
      .filter((row) => row.workshopId === course.id)
      .map((row) => personMap.get(row.personId))
      .filter(Boolean);
    course.gradeGroupSummary = gradeGroupSummaryForPeople(course, assignedPeople);
    course.gradeGroupImbalance = course.gradeGroupRule?.enabled && course.gradeGroupRule?.balance !== false
      ? Math.abs((course.gradeGroupSummary[0]?.count || 0) - (course.gradeGroupSummary[1]?.count || 0))
      : 0;
    const hard = hardViolationsForCourseFromResult(course.id);
    const minimumHint = course.open && course.load < course.effectiveMin
      ? [`Mindestbelegung: ${course.load} statt mindestens ${course.effectiveMin} (Abweichung −${course.effectiveMin - course.load})`]
      : [];
    const capacityHint = course.open && course.load > course.max
      ? [`Manuelle Überbelegung: ${course.load} statt höchstens ${course.max} (Abweichung +${course.load - course.max})`]
      : [];
    const preferredWithoutDynamic = Math.max(0, (course.rulePreferredViolations || 0) - (course.courseMinimumViolationCount || 0) - (course.capacityViolationCount || 0));
    course.ruleHardViolations = hard.length;
    course.courseMinimumViolationCount = minimumHint.length;
    course.courseMinimumDeviation = Math.max(0, course.effectiveMin - course.load);
    course.capacityViolationCount = capacityHint.length;
    course.capacityDeviation = Math.max(0, course.load - course.max);
    course.rulePreferredViolations = preferredWithoutDynamic + minimumHint.length + capacityHint.length;
    course.ruleHints = [...minimumHint, ...capacityHint, ...hard];
    course.ruleDeviations = hard.length + course.rulePreferredViolations;
    course.ruleStatus = course.ruleDeviations ? "Bestmögliche Abweichung" : "Regeln erfüllt";
    course.status = course.open
      ? (capacityHint.length ? `Findet statt – manuell überbelegt (+${course.capacityDeviation})` : minimumHint.length ? "Findet statt – Mindestziel unterschritten" : "Findet statt")
      : "Entfällt (optional)";
  }
  for (const row of result.participantResults.filter((item) => !item.workshopId)) {
    const person = personMap.get(row.personId);
    if (!person) continue;
    const diagnosis = unassignedDiagnosis(state, person, openSet, courseMap, lockSet, loads);
    row.unassignedReason = diagnosis.reason;
    row.unassignedSuggestion = diagnosis.suggestions?.[0]?.text || "";
    row.unassignedSuggestions = diagnosis.suggestions || [];
    row.note = [diagnosis.reason, row.unassignedSuggestion ? `Vorschlag: ${row.unassignedSuggestion}` : ""].filter(Boolean).join(" · ");
  }
  const counts = new Map();
  result.participantResults.forEach((row) => counts.set(row.type, (counts.get(row.type) || 0) + 1));
  result.stats.first = counts.get("Erstwunsch") || 0;
  result.stats.second = counts.get("Zweitwunsch") || 0;
  result.stats.third = counts.get("Drittwunsch") || 0;
  result.stats.fourth = counts.get("Viertwunsch") || 0;
  result.stats.fixed = counts.get("Feste Setzung") || 0;
  result.stats.outside = counts.get("Kein Wunsch") || 0;
  result.stats.unassigned = counts.get("Nicht zugeteilt") || 0;
  const open = result.courseResults.filter((course) => course.open);
  result.stats.meanDeviation = open.length ? open.reduce((sum, course) => sum + Math.abs(course.deviation), 0) / open.length : 0;
  result.stats.hardRuleViolations = result.courseResults.reduce((sum, course) => sum + (course.ruleHardViolations || 0), 0);
  result.stats.ruleViolationCount = result.courseResults.reduce((sum, course) => sum + (course.ruleDeviations || 0), 0);
  result.stats.gradeGroupImbalance = open.reduce((sum, course) => sum + (course.gradeGroupImbalance || 0), 0);
  result.stats.capacityDeviation = open.reduce((sum, course) => sum + (course.capacityDeviation || 0), 0);
  const threshold = Math.max(0, Number(state.settings.balanceThreshold) || 0);
  const largeLoads = open.filter((course) => threshold <= 0 || course.max > threshold).map((course) => course.load);
  result.stats.largeCourseSpread = largeLoads.length ? Math.max(...largeLoads) - Math.min(...largeLoads) : 0;
  const badWishByCourse = open.map((course) => {
    const rows = result.participantResults.filter((row) => row.workshopId === course.id);
    return { third: rows.filter((row) => row.type === "Drittwunsch").length, fourth: rows.filter((row) => row.type === "Viertwunsch").length };
  });
  result.stats.maxThirdPerCourse = badWishByCourse.length ? Math.max(...badWishByCourse.map((item) => item.third)) : 0;
  result.stats.maxFourthPerCourse = badWishByCourse.length ? Math.max(...badWishByCourse.map((item) => item.fourth)) : 0;
  renderResults();
}

function moveParticipant(personId, toCourseId, { allowRuleDeviation = false, protect = false } = {}) {
  const row = participantResultById(personId);
  const person = participantStateById(personId);
  const target = courseById(toCourseId);
  const source = row ? courseById(row.workshopId) : null;
  if (!row || !person || !target) return;
  if (person.fixed && person.fixed !== toCourseId) return showDialog("Verschieben nicht möglich", "Die Person hat eine feste Setzung. Diese zuerst lösen.", "warning");
  const eligibility = manualEligibility(person, target);
  if (eligibility) return showDialog("Verschieben nicht möglich", eligibility, "warning");
  if (target.load >= target.max) return showDialog("Verschieben nicht möglich", "Der Zielkurs ist bereits voll. Nutze bei einem unzugeteilten Schüler die ausdrücklich bestätigte Überbelegung.", "warning");
  snapshotResult();
  const oldId = row.workshopId;
  row.workshopId = toCourseId;
  if (protect) person.fixed = toCourseId;
  refreshResultAfterManualChange();
  const hardIssues = [...new Set([...(oldId ? hardViolationsForCourseFromResult(oldId) : []), ...hardViolationsForCourseFromResult(toCourseId)])];
  if (hardIssues.length && !allowRuleDeviation) {
    restoreResultSnapshot();
    renderResults();
    return showDialog("Verschieben verletzt eine vorrangige Regel", hardIssues, "warning");
  }
  if (protect) scheduleSave();
  recordAudit("Manuelle Zuordnung", personId, toCourseId, `${person.firstName} ${person.lastName} wurde ${workshopLabel(source) || "ohne Kurs"} → ${workshopLabel(target)} zugeordnet${protect ? " und festgesetzt" : ""}.`);
  renderCourseDetail();
  toast("Person verschoben. Mit ↶ kann die Änderung rückgängig gemacht werden.");
}

function applyUnassignedSuggestion(personId, targetCourseId) {
  const row = participantResultById(personId);
  const person = participantStateById(personId);
  const target = courseById(targetCourseId);
  if (!row || row.workshopId || !person || !target) return;
  if (!person.wishes.includes(target.offerId)) return showDialog("Vorschlag nicht zulässig", "Es werden nur Kurse aus den eingetragenen Wünschen angeboten.", "warning");
  const eligibility = manualEligibility(person, target);
  if (eligibility) return showDialog("Vorschlag nicht direkt umsetzbar", eligibility, "warning");
  if (!target.open) return showDialog("Durchführung ist geschlossen", "Öffne die optionale Durchführung zunächst in den Angebotseinstellungen und berechne neu.", "warning");
  if (target.load < target.max) {
    moveParticipant(personId, targetCourseId, { allowRuleDeviation: true, protect: true });
    reviewIndex = Math.max(0, reviewIndex - 1);
    return;
  }
  const plan = findSeatCreationPlan(personId, targetCourseId);
  if (!plan) return showDialog("Kein einfacher Platztausch gefunden", "Der Kurs ist voll und es wurde kein bereits zugeteilter, nicht festgesetzter Schüler mit einem freien alternativen Wunschplatz gefunden. Du kannst den Kurs prüfen oder ausdrücklich überbelegen.", "warning");
  if (!confirm(`${plan.occupant.firstName} ${plan.occupant.lastName} wird von „${workshopLabel(target)}“ nach „${workshopLabel(plan.alternative)}“ verschoben. Danach erhält ${person.firstName} ${person.lastName} den frei gewordenen Platz. Umsetzen?`)) return;
  snapshotResult();
  plan.occupantRow.workshopId = plan.alternative.id;
  row.workshopId = target.id;
  person.fixed = target.id;
  refreshResultAfterManualChange();
  recordAudit("Platztausch", personId, target.id, `${plan.occupant.firstName} ${plan.occupant.lastName}: ${workshopLabel(target)} → ${workshopLabel(plan.alternative)}; ${person.firstName} ${person.lastName} erhielt ${workshopLabel(target)} und wurde festgesetzt.`);
  reviewIndex = Math.max(0, reviewIndex - 1);
  renderResults();
  toast("Platztausch und Zuteilung durchgeführt.");
}

function overbookUnassignedSuggestion(personId, targetCourseId) {
  const row = participantResultById(personId);
  const person = participantStateById(personId);
  const target = courseById(targetCourseId);
  if (!row || row.workshopId || !person || !target) return;
  if (!person.wishes.includes(target.offerId)) return showDialog("Überbelegung nicht zulässig", "Der Kurs liegt nicht in den eingetragenen Wünschen dieses Schülers.", "warning");
  const eligibility = manualEligibility(person, target);
  if (eligibility) return showDialog("Überbelegung nicht zulässig", eligibility, "warning");
  if (!target.open) return showDialog("Überbelegung nicht möglich", "Die Durchführung ist nicht geöffnet.", "warning");
  const nextLoad = target.load + 1;
  const over = nextLoad - target.max;
  if (!confirm(`${person.firstName} ${person.lastName} manuell „${workshopLabel(target)}“ zuordnen?\n\nDer Kurs hat danach ${nextLoad}/${target.max} Schüler und ist um ${over} überbelegt. Diese Abweichung wird in allen Prüffällen und im Protokoll aktuell ausgewiesen.`)) return;
  snapshotResult();
  row.workshopId = target.id;
  refreshResultAfterManualChange();
  recordAudit("Manuelle Überbelegung", personId, target.id, `${person.firstName} ${person.lastName} wurde ${workshopLabel(target)} zugeteilt; aktuelle Belegung ${nextLoad}/${target.max} (+${over}).`);
  reviewIndex = Math.max(0, reviewIndex - 1);
  renderResults();
  toast(`Manuell zugeteilt: ${workshopLabel(target)} ist jetzt um ${over} überbelegt.`);
}

function fixParticipant(personId) {
  const row = participantResultById(personId);
  const person = participantStateById(personId);
  if (!row || !person || !row.workshopId) return;
  person.fixed = row.workshopId;
  commit({ invalidate: false });
  refreshResultAfterManualChange();
  recordAudit("Feste Setzung", personId, row.workshopId, `${person.firstName} ${person.lastName}: ${workshopLabel(courseById(row.workshopId))} wurde geschützt.`);
  renderCourseDetail();
  toast("Aktuelle Zuordnung wurde festgesetzt.");
}

function swapSuggestions(courseId) {
  const assigned = result.participantResults.filter((row) => row.workshopId === courseId);
  const outside = result.participantResults.filter((row) => row.workshopId && row.workshopId !== courseId);
  const suggestions = [];
  const currentCourse = courseById(courseId);
  for (const a of assigned) {
    const pa = participantStateById(a.personId);
    if (!pa || pa.fixed) continue;
    for (const b of outside) {
      const pb = participantStateById(b.personId);
      const otherCourse = courseById(b.workshopId);
      if (!pb || pb.fixed || !otherCourse) continue;
      if (manualEligibility(pa, otherCourse) || manualEligibility(pb, currentCourse)) continue;
      const aNow = pa.wishes.indexOf(currentCourse.offerId); const aNew = pa.wishes.indexOf(otherCourse.offerId);
      const bNow = pb.wishes.indexOf(otherCourse.offerId); const bNew = pb.wishes.indexOf(currentCourse.offerId);
      const norm = (idx) => idx < 0 ? 5 : idx;
      const gain = (norm(aNow) - norm(aNew)) + (norm(bNow) - norm(bNew));
      if (gain > 0) suggestions.push({ a, b, gain, otherCourse });
    }
  }
  return suggestions.sort((x, y) => y.gain - x.gain).slice(0, 8);
}

function applySwap(aId, bId) {
  const a = participantResultById(aId); const b = participantResultById(bId);
  if (!a || !b) return;
  snapshotResult();
  const aCourse = a.workshopId; const bCourse = b.workshopId;
  a.workshopId = bCourse; b.workshopId = aCourse;
  refreshResultAfterManualChange();
  const issues = [...hardViolationsForCourseFromResult(aCourse), ...hardViolationsForCourseFromResult(bCourse)];
  if (issues.length) {
    restoreResultSnapshot(); renderResults();
    return showDialog("Tausch verletzt eine vorrangige Regel", issues, "warning");
  }
  recordAudit("Manueller Tausch", "", "", `${a.firstName} ${a.lastName} und ${b.firstName} ${b.lastName} wurden zwischen ${workshopLabel(courseById(aCourse))} und ${workshopLabel(courseById(bCourse))} getauscht.`);
  renderCourseDetail(); toast("Tausch durchgeführt.");
}

function renderCourseDetail() {
  if (!result?.ok) return;
  const courses = result.courseResults.filter((course) => course.open);
  if (!courses.length) return;
  if (!selectedCourseId || !courses.some((course) => course.id === selectedCourseId)) selectedCourseId = courses[0].id;
  const course = courseById(selectedCourseId);
  if (!course) return;
  $("#courseDetailTitle").textContent = workshopLabel(course);
  $("#courseDetailSelect").innerHTML = courses.map((item) => option(item.id, selectedCourseId, workshopLabel(item))).join("");
  const quality = wishQualityForCourse(course.id);
  $("#courseDetailStats").innerHTML = [
    [course.load, "Belegung"], [course.target, "Ziel"], [`${course.effectiveMin} / ${course.max}`, "Mindestziel / Max"], [quality, "Wünsche"]
  ].map(([value, label]) => `<div class="stat"><strong>${escapeHtml(value)}</strong><span>${label}</span></div>`).join("");
  const details = course.ruleDetails || [];
  const gradeLimits = course.gradeLimitSummary || [];
  const gradeLimitLabel = "Jahrgangsvorgaben (bestmöglich):";
  const gradeLimitHtml = gradeLimits.length ? `<div class="grade-limit-result"><strong>${gradeLimitLabel}</strong> ${gradeLimits.map((item) => {
    const bounds = item.min !== null && item.max !== null ? `${item.min}–${item.max}` : item.min !== null ? `mind. ${item.min}` : `max. ${item.max}`;
    return `Jg. ${item.grade}: ${item.count} (${bounds})`;
  }).join(" · ")}</div>` : "";
  const gradeGroups = course.gradeGroupSummary || [];
  const gradeGroupHtml = gradeGroups.length ? `<div class="grade-limit-result debate-result"><strong>Jahrgangsgruppen-Regel · Gruppengröße 4 (bestmöglich):</strong> ${gradeGroups.map((item) => `${escapeHtml(item.label)}: ${item.count}${item.remainder === 0 ? " ✓" : " – nicht durch 4 teilbar"}`).join(" · ")}${course.gradeGroupRule?.balance ? `<br><span class="muted">Weicher Ausgleich: Differenz ${course.gradeGroupImbalance || 0}</span>` : ""}</div>` : "";
  const ruleHints = course.ruleHints || [];
  const detailsHtml = details.length || ruleHints.length
    ? `<details><summary>${resultRuleBadge(course)} Regeldetails anzeigen</summary>${ruleHints.map((hint) => `<div class="message warning">${escapeHtml(hint)}</div>`).join("")}${details.map((item) => `<div class="message warning">${escapeHtml(ruleTypeName(item.type))}: ${escapeHtml(item.label)} · ${item.count} von mindestens ${item.min}</div>`).join("")}</details>`
    : resultRuleBadge(course);
  $("#courseRuleSummary").innerHTML = `${gradeGroupHtml}${gradeLimitHtml}${detailsHtml}`;

  $$(".detail-tab").forEach((button) => button.classList.toggle("active", button.dataset.detailTab === courseDetailTab));
  const assigned = result.participantResults.filter((row) => row.workshopId === course.id).sort((a,b) => a.lastName.localeCompare(b.lastName,"de") || a.firstName.localeCompare(b.firstName,"de"));
  if (courseDetailTab === "assigned") {
    $("#courseDetailBody").innerHTML = `<div class="table-wrap"><table class="detail-table"><thead><tr><th>Name</th><th>Klasse</th><th>Bildungsgang</th><th>Wunsch</th><th>Nachbearbeitung</th></tr></thead><tbody>${assigned.map((row) => {
      const person = participantStateById(row.personId);
      const destinationOptions = result.courseResults
        .filter((item) => item.open && item.id !== course.id && item.load < item.max)
        .filter((item) => person && !manualEligibility(person, item))
        .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(workshopLabel(item))}</option>`).join("");
      return `<tr>
      <td><strong>${escapeHtml(row.lastName)}, ${escapeHtml(row.firstName)}</strong></td><td>${escapeHtml(row.className)}</td><td>${escapeHtml(row.schoolForm)}</td><td>${escapeHtml(row.type)}</td>
      <td><div class="move-controls"><select data-move-person="${escapeHtml(row.personId)}"><option value="">Zielkurs …</option>${destinationOptions}</select><button type="button" class="button" data-action="move-person" data-person-id="${escapeHtml(row.personId)}">Verschieben</button><button type="button" class="button" data-action="fix-person" data-person-id="${escapeHtml(row.personId)}">Festsetzen</button></div></td>
    </tr>`; }).join("")}</tbody></table></div>`;
  } else if (courseDetailTab === "applicants") {
    const applicants = result.participantResults.filter((row) => participantStateById(row.personId)?.wishes.includes(course.offerId)).sort((a,b) => {
      const pa = participantStateById(a.personId); const pb = participantStateById(b.personId);
      return pa.wishes.indexOf(course.offerId) - pb.wishes.indexOf(course.offerId) || a.lastName.localeCompare(b.lastName,"de");
    });
    $("#courseDetailBody").innerHTML = `<div class="table-wrap"><table class="detail-table"><thead><tr><th>Name</th><th>Klasse</th><th>Bildungsgang</th><th>Einwahl</th><th>Tatsächlich zugeteilt</th></tr></thead><tbody>${applicants.map((row) => { const person=participantStateById(row.personId); const rank=person.wishes.indexOf(course.offerId); return `<tr><td>${escapeHtml(row.lastName)}, ${escapeHtml(row.firstName)}</td><td>${escapeHtml(row.className)}</td><td>${escapeHtml(row.schoolForm)}</td><td>${rank+1}. Wunsch</td><td>${escapeHtml(row.workshopName || "Nicht zugeteilt")}</td></tr>`; }).join("")}</tbody></table></div>`;
  } else {
    const swaps = swapSuggestions(course.id);
    $("#courseDetailBody").innerHTML = swaps.length ? `<div class="swap-list">${swaps.map((item) => `<div class="swap-card"><div><strong>${escapeHtml(item.a.lastName)}, ${escapeHtml(item.a.firstName)}</strong> ↔ <strong>${escapeHtml(item.b.lastName)}, ${escapeHtml(item.b.firstName)}</strong><br><span class="muted">${escapeHtml(workshopLabel(course))} ↔ ${escapeHtml(workshopLabel(item.otherCourse))} · Verbesserung: ${item.gain} Wunschstufe(n)</span></div><button type="button" class="button" data-action="apply-swap" data-a="${escapeHtml(item.a.personId)}" data-b="${escapeHtml(item.b.personId)}">Tauschen</button></div>`).join("")}</div>` : `<div class="empty-state">Keine einfache Tauschverbesserung gefunden.</div>`;
  }
  $("#undoMoveBtn").disabled = !resultUndoStack.length;
}

function openCourseDetail(courseId) {
  selectedCourseId = courseId;
  courseDetailTab = "assigned";
  renderCourseDetail();
  $("#courseDetailDialog").showModal();
}

function renderAll() {
  renderDashboard();
  renderEnrollmentCheck();
  renderPlanning();
  renderWorkshops();
  renderParticipants();
  renderLocks();
  renderResults();
}

function runOptimization() {
  const calculated = optimizeEvent(state);
  if (!calculated.ok) {
    showDialog("Zuteilung nicht möglich", calculated.errors, "error");
    return;
  }
  result = calculated;
  resultUndoStack.length = 0;
  selectedCourseId = result.courseResults.find((course) => course.open)?.id || "";
  renderResults();
  planningInsights = null;
  if (calculated.warnings.length) showDialog("Zuteilung berechnet – mit Hinweisen", calculated.warnings, "warning");
  else toast("Zuteilung erfolgreich berechnet.");
  activateTab("results");
}

function activateTab(name) {
  $$(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  $$(".panel").forEach((panel) => panel.classList.toggle("active-panel", panel.dataset.panel === name));
  if (name === "planning") renderPlanning();
}

function nextId(prefix, existing) {
  for (let i = 1; i <= 9999; i += 1) {
    const id = `${prefix}${String(i).padStart(2, "0")}`;
    if (!existing.has(id)) return id;
  }
  return "";
}

function addWorkshop() {
  if (state.workshops.length >= 30) return showDialog("Grenze erreicht", "Es können höchstens 30 Durchführungen eingetragen werden.", "warning");
  const id = nextId("W", new Set(state.workshops.map((w) => w.id)));
  const offerId = nextId("K", new Set(state.workshops.map((w) => w.offerId)));
  state.workshops.push({
    id, offerId, name: "Neues Angebot", session: "A", gradeFrom: 7, gradeTo: 12,
    schoolForm: "Alle", cohortMin: null, min: 0, max: 12, mode: state.settings.defaultMode, gradeLimits: {},
    gradeGroupRule: { enabled: false, balance: true },
  });
  commit(); renderWorkshops(); renderParticipants(); renderLocks();
}

function addParticipant() {
  if (state.participants.length >= 500) return showDialog("Grenze erreicht", "Es können höchstens 500 Teilnehmende eingetragen werden.", "warning");
  state.participants.push({
    id: nextId("P", new Set(state.participants.map((p) => p.id))), firstName: "", lastName: "", className: state.settings.classRequired ? "7a" : "",
    schoolForm: "Regional", wishes: ["", "", "", ""], fixed: "", enrollmentIssues: [],
  });
  commit(); renderParticipants(); renderLocks();
}

function addLock() {
  state.locks.push({ personId: "", workshopId: "", reason: "" });
  commit(); renderLocks();
}

function handleTableChange(event) {
  const control = event.target.closest("[data-entity]");
  if (!control) return;
  const row = control.closest("tr");
  const index = Number(row?.dataset.index);
  const field = control.dataset.field;
  let value = control.value;
  if (control.type === "number") value = field === "cohortMin" && value === "" ? null : Number(value);

  if (control.dataset.entity === "workshop") state.workshops[index][field] = value;
  if (control.dataset.entity === "participant") {
    if (field.startsWith("wish")) state.participants[index].wishes[Number(field.slice(4))] = value;
    else {
      state.participants[index][field] = value;
      if (field === "className" && value) state.participants[index].schoolForm = inferSchoolForm(value);
    }
  }
  if (control.dataset.entity === "lock") state.locks[index][field] = value;
  commit();
}

function handleTableClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const index = Number(button.closest("tr")?.dataset.index);
  if (button.dataset.action === "edit-grade-limits") {
    openGradeLimitsDialog(index);
    return;
  }
  if (button.dataset.action === "duplicate-workshop") {
    if (state.workshops.length >= 30) return showDialog("Grenze erreicht", "Es können höchstens 30 Durchführungen eingetragen werden.", "warning");
    const source = state.workshops[index];
    const copy = {
      ...source,
      gradeLimits: JSON.parse(JSON.stringify(source.gradeLimits || {})),
      gradeGroupRule: JSON.parse(JSON.stringify(source.gradeGroupRule || { enabled: false, balance: true })),
      id: nextId("W", new Set(state.workshops.map((w) => w.id))),
      session: nextSessionLabel(source.offerId),
      fixed: undefined,
    };
    state.workshops.splice(index + 1, 0, copy);
    commit(); renderWorkshops(); renderParticipants(); renderLocks();
  }
  if (button.dataset.action === "delete-workshop") {
    const removed = state.workshops[index];
    state.workshops.splice(index, 1);
    if (state.fuxExport?.courses) delete state.fuxExport.courses[removed.id];
    for (const override of Object.values(state.fuxExport?.assignmentOverrides || {})) {
      if (override.hj1WorkshopId === removed.id) override.hj1WorkshopId = "";
      if (override.hj2WorkshopId === removed.id) override.hj2WorkshopId = "";
    }
    const offerStillExists = state.workshops.some((w) => w.offerId === removed.offerId);
    state.participants.forEach((p) => {
      if (!offerStillExists) p.wishes = p.wishes.map((wish) => wish === removed.offerId ? "" : wish);
      if (p.fixed === removed.id) p.fixed = "";
    });
    state.locks = state.locks.filter((lock) => lock.workshopId !== removed.id);
    commit(); renderWorkshops(); renderParticipants(); renderLocks();
  }
  if (button.dataset.action === "delete-participant") {
    const removed = state.participants[index];
    state.participants.splice(index, 1);
    if (state.fuxExport?.assignmentOverrides) delete state.fuxExport.assignmentOverrides[removed.id];
    state.locks = state.locks.filter((lock) => lock.personId !== removed.id);
    commit(); renderParticipants(); renderLocks();
  }
  if (button.dataset.action === "delete-lock") {
    state.locks.splice(index, 1); commit(); renderLocks();
  }
}

function exportJson() {
  downloadBlob(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }), `${safeFilename(state.name)}.json`);
}

async function importJson(file) {
  const parsed = JSON.parse(await file.text());
  state = normalizeEvent(parsed);
  result = null;
  scheduleSave(); renderAll(); toast("JSON-Datei geladen.");
}

function getRowValue(row, aliases) {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [String(key).trim().toLowerCase(), value]));
  for (const alias of aliases) {
    const value = normalized[alias.toLowerCase()];
    if (value !== undefined && value !== null) return value;
  }
  return "";
}

function worksheetObjects(worksheet, requiredHeader) {
  if (!worksheet) return [];
  let headerRow = null;
  let headers = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (headerRow || rowNumber > 15) return;
    const values = row.values.slice(1).map((value) => String(value ?? "").trim());
    if (values.some((value) => value.toLowerCase() === requiredHeader.toLowerCase())) {
      headerRow = rowNumber;
      headers = values;
    }
  });
  if (!headerRow) return [];
  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const object = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const cell = row.getCell(index + 1);
      object[header] = cell.text ?? cell.value ?? "";
    });
    rows.push(object);
  });
  return rows;
}

function parseExcelWorkbook(workbook) {
  const workshopSheet = workbook.getWorksheet("Angebote") || workbook.getWorksheet("Workshops");
  const gradeLimitSheet = workbook.getWorksheet("Jahrgangsbelegung") || workbook.getWorksheet("Jahrgangsgrenzen");
  const participantSheet = workbook.getWorksheet("Kursanwahl") || workbook.getWorksheet("Teilnehmende") || workbook.getWorksheet("Personen");
  const lockSheet = workbook.getWorksheet("Sperrungen");

  let workshopRows = worksheetObjects(workshopSheet, "Durchführungs-ID");
  if (!workshopRows.length) workshopRows = worksheetObjects(workshopSheet, "Durchfuehrungs-ID");
  if (!workshopRows.length) workshopRows = worksheetObjects(workshopSheet, "Workshop-ID");
  const importedWorkshops = workshopRows.map((row) => {
    const id = String(getRowValue(row, ["Durchführungs-ID", "Durchfuehrungs-ID", "Workshop-ID", "ID"])).trim();
    return {
      id,
      offerId: String(getRowValue(row, ["Angebots-ID", "Kursart-ID", "Anwahl-ID", "Kurs-ID"]) || id).trim(),
      name: String(getRowValue(row, ["Angebot", "Kursart", "Workshopname", "Workshop", "Name"])).trim(),
      session: String(getRowValue(row, ["Gruppe", "Durchführungsgruppe", "Durchfuehrungsgruppe"])).trim(),
      gradeFrom: Number(getRowValue(row, ["Klasse von", "Von"])),
      gradeTo: Number(getRowValue(row, ["Klasse bis", "Bis"])),
      schoolForm: String(getRowValue(row, ["Bildungsgang", "Schulform"]) || "Alle").trim(),
      cohortMin: (() => { const v = getRowValue(row, ["Kohortenminimum", "Kohorte min.", "Jahrgang/Bildungsgang min."]); return v === "" ? null : Number(v); })(),
      min: Number(getRowValue(row, ["Mindestbelegung", "Minimum", "Min"])) || 0,
      max: Number(getRowValue(row, ["Maximalbelegung", "Maximum", "Max"])) || 0,
      mode: String(getRowValue(row, ["Pflicht/Optional", "Durchführung", "Durchfuehrung"]) || state.settings.defaultMode).trim(),
      gradeLimits: {},
      gradeGroupRule: {
        enabled: parseYesNo(getRowValue(row, ["Jahrgangsgruppen-Regel 8/9 + 10+", "Jahrgangsgruppen-Regel", "Vierergruppen 8/9 + 10+", "Vierergruppen", "Jugend debattiert"]), false),
        balance: parseYesNo(getRowValue(row, ["Gruppenausgleich", "Jahrgangsgruppen ausgleichen", "Wettbewerbsgruppen ausgleichen", "Ausgleich Debattiergruppen"]), true),
      },
    };
  }).filter((row) => row.id);

  const gradeLimitRows = worksheetObjects(gradeLimitSheet, "Durchführungs-ID");
  const gradeLimitMap = new Map();
  for (const row of gradeLimitRows) {
    const workshopId = String(getRowValue(row, ["Durchführungs-ID", "Durchfuehrungs-ID", "Workshop-ID", "ID"])).trim();
    const grade = Number(getRowValue(row, ["Jahrgang", "Klassenstufe", "Jg."]));
    const rawMin = getRowValue(row, ["Minimum", "Min", "Mindestens"]);
    const rawMax = getRowValue(row, ["Maximum", "Max", "Höchstens", "Hoechstens"]);
    const min = normalizeNullableLimit(rawMin);
    const max = normalizeNullableLimit(rawMax);
    if (!workshopId || !Number.isInteger(grade) || grade < 1 || grade > 20 || (min === null && max === null)) continue;
    if (!gradeLimitMap.has(workshopId)) gradeLimitMap.set(workshopId, {});
    gradeLimitMap.get(workshopId)[String(grade)] = { min, max };
  }
  importedWorkshops.forEach((workshop) => { workshop.gradeLimits = gradeLimitMap.get(workshop.id) || {}; });

  const importedParticipants = worksheetObjects(participantSheet, "Person-ID").map((row) => ({
    id: String(getRowValue(row, ["Person-ID", "ID"])).trim(),
    firstName: String(getRowValue(row, ["Vorname"])).trim(),
    lastName: String(getRowValue(row, ["Nachname"])).trim(),
    className: String(getRowValue(row, ["Klasse"])).trim(),
    schoolForm: String(getRowValue(row, ["Bildungsgang", "Schulform"]) || inferSchoolForm(getRowValue(row, ["Klasse"])) || "Regional").trim(),
    wishes: ["Erstwunsch", "Zweitwunsch", "Drittwunsch", "Viertwunsch"].map((key) => String(getRowValue(row, [key])).trim()),
    fixed: String(getRowValue(row, ["Feste Setzung"])).trim(),
  })).filter((row) => row.id);

  const importedLocks = worksheetObjects(lockSheet, "Person-ID").map((row) => ({
    personId: String(getRowValue(row, ["Person-ID", "Person"])).trim(),
    workshopId: String(getRowValue(row, ["Durchführungs-ID", "Angebots-ID", "Workshop-ID", "Workshop"])).trim(),
    reason: String(getRowValue(row, ["Grund / Hinweis", "Grund", "Hinweis"])).trim(),
  })).filter((row) => row.personId || row.workshopId);

  if (!importedParticipants.length && !importedWorkshops.length) throw new Error("Es wurden weder Angebote noch Teilnehmende erkannt.");

  const workshops = importedWorkshops.length ? importedWorkshops : state.workshops;
  const participants = importedParticipants.length ? importedParticipants : state.participants;
  const locks = lockSheet ? importedLocks : state.locks;
  if (!workshops.length) throw new Error("Es sind keine Angebote vorhanden. Bitte zuerst Angebote anlegen oder ein Blatt „Angebote“ beziehungsweise „Workshops“ mit importieren.");
  return normalizeEvent({ ...state, workshops, participants, locks });
}

async function importExcel(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  state = parseExcelWorkbook(workbook);
  result = null; scheduleSave(); renderAll(); toast("Excel-Datei importiert.");
}

function styleWorksheet(worksheet) {
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  worksheet.columns.forEach((column) => {
    let width = 12;
    column.eachCell({ includeEmpty: true }, (cell) => { width = Math.min(38, Math.max(width, String(cell.text ?? "").length + 2)); });
    column.width = width;
  });
}

async function exportExcel() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ProFlex / GTS / Angebotsmanager";
  const addTableSheet = (name, columns, rows) => {
    const worksheet = workbook.addWorksheet(name);
    worksheet.columns = columns.map(([header, key]) => ({ header, key }));
    worksheet.addRows(rows);
    styleWorksheet(worksheet);
  };
  addTableSheet("Angebote", [
    ["Durchführungs-ID", "id"], ["Angebots-ID", "offerId"], ["Angebot", "name"], ["Gruppe", "session"],
    ["Klasse von", "gradeFrom"], ["Klasse bis", "gradeTo"], ["Bildungsgang", "schoolForm"], ["Kohortenminimum", "cohortMin"],
    ["Mindestbelegung", "min"], ["Maximalbelegung", "max"], ["Jahrgangsgruppen-Regel 8/9 + 10+", "gradeGroupEnabled"],
    ["Gruppenausgleich", "gradeGroupBalance"], ["Pflicht/Optional", "mode"],
  ], state.workshops.map((workshop) => ({
    ...workshop,
    gradeGroupEnabled: workshop.gradeGroupRule?.enabled ? "Ja" : "Nein",
    gradeGroupBalance: workshop.gradeGroupRule?.balance !== false ? "Ja" : "Nein",
  })));
  addTableSheet("Jahrgangsbelegung", [
    ["Durchführungs-ID", "workshopId"], ["Jahrgang", "grade"], ["Minimum", "min"], ["Maximum", "max"],
  ], state.workshops.flatMap((workshop) => gradeLimitEntriesForWorkshop(workshop).map((limit) => ({ workshopId: workshop.id, grade: limit.grade, min: limit.min ?? "", max: limit.max ?? "" }))));
  addTableSheet("Teilnehmende", [
    ["Person-ID", "id"], ["Vorname", "firstName"], ["Nachname", "lastName"], ["Klasse", "className"], ["Bildungsgang", "schoolForm"],
    ["Erstwunsch", "wish1"], ["Zweitwunsch", "wish2"], ["Drittwunsch", "wish3"], ["Viertwunsch", "wish4"], ["Feste Setzung", "fixed"],
  ], state.participants.map((p) => ({ ...p, wish1: p.wishes[0], wish2: p.wishes[1], wish3: p.wishes[2], wish4: p.wishes[3] })));
  addTableSheet("Sperrungen", [["Person-ID", "personId"], ["Durchführungs-ID", "workshopId"], ["Grund / Hinweis", "reason"]], state.locks);
  if (result?.ok) {
    addTableSheet("Ergebnis", [["Nachname", "lastName"], ["Vorname", "firstName"], ["Klasse", "className"], ["Angebot", "workshopName"], ["Zuteilungsart", "type"], ["Hinweis", "note"]], result.participantResults);
    addTableSheet("Angebotsübersicht", [["Angebot", "name"], ["Gruppe", "session"], ["Pflicht/Optional", "mode"], ["Kohortenminimum", "cohortMinEffective"], ["Minimum", "effectiveMin"], ["Ziel", "target"], ["Belegung", "load"], ["Maximum", "max"], ["Abweichung", "deviation"], ["Jahrgangsgruppe 8–9", "gradeGroupSekI"], ["Jahrgangsgruppe 10+", "gradeGroupSekII"], ["Gruppendifferenz", "gradeGroupImbalanceExport"], ["Regelhinweise", "ruleHintsExport"], ["Status", "status"]], result.courseResults.map((course) => ({
      ...course,
      gradeGroupSekI: course.gradeGroupSummary?.find((item) => item.key === "sekI")?.count ?? "",
      gradeGroupSekII: course.gradeGroupSummary?.find((item) => item.key === "sekII")?.count ?? "",
      gradeGroupImbalanceExport: course.gradeGroupRule?.enabled && course.gradeGroupRule?.balance !== false ? course.gradeGroupImbalance : "",
      ruleHintsExport: (course.ruleHints || []).join("; "),
    })));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${safeFilename(state.name)}.xlsx`);
}

function fuxOpenCourses() {
  const openIds = new Set((result?.courseResults || []).filter((course) => course.open).map((course) => course.id));
  return state.workshops.filter((course) => openIds.has(course.id));
}

function ensureFuxExportDefaults() {
  state.fuxExport = state.fuxExport || { courses: {}, assignmentOverrides: {} };
  state.fuxExport.courses = state.fuxExport.courses || {};
  state.fuxExport.assignmentOverrides = state.fuxExport.assignmentOverrides || {};
  for (const course of state.workshops) {
    const existing = state.fuxExport.courses[course.id] || {};
    const fallback = defaultFuxCourseConfig(course, state.fuxExport.courses);
    state.fuxExport.courses[course.id] = {
      ...fallback,
      ...existing,
      courseId: String(existing.courseId || fallback.courseId).trim(),
      courseName: String(existing.courseName || course.name).trim(),
      gradeRange: String(existing.gradeRange || fallback.gradeRange).trim(),
      hj1: existing.hj1 !== false,
      hj2: existing.hj2 !== false,
    };
  }
}

function fuxExportDataFromDraft() {
  return buildFuxExportData({
    courses: fuxOpenCourses(),
    participantResults: result?.participantResults || [],
    courseConfigs: fuxExportDraft?.courses || {},
    assignmentOverrides: fuxExportDraft?.assignmentOverrides || {},
  });
}

function fuxCourseOptions(selected, semester = "") {
  const courses = fuxOpenCourses();
  return [option("", selected, "– kein Kurs –"), ...courses.map((course) => {
    const config = fuxExportDraft.courses[course.id];
    const inactive = semester && !config?.[semester.toLowerCase()];
    const label = `${config?.courseId || course.id} · ${config?.courseName || course.name}${inactive ? ` · nicht für ${semester} aktiviert` : ""}`;
    return option(course.id, selected, label);
  })].join("");
}

function renderFuxCourseRows() {
  const rows = fuxOpenCourses().map((course) => {
    const config = fuxExportDraft.courses[course.id];
    return `<tr data-fux-workshop-id="${escapeHtml(course.id)}">
      <td><input data-fux-course-field="courseId" value="${escapeHtml(config.courseId)}" autocomplete="off"></td>
      <td><input data-fux-course-field="courseName" value="${escapeHtml(config.courseName)}" autocomplete="off"></td>
      <td><input data-fux-course-field="gradeRange" value="${escapeHtml(config.gradeRange)}" autocomplete="off"></td>
      <td class="fux-check"><input type="checkbox" data-fux-course-field="hj1" ${config.hj1 ? "checked" : ""} aria-label="${escapeHtml(config.courseId)} in HJ1"></td>
      <td class="fux-check"><input type="checkbox" data-fux-course-field="hj2" ${config.hj2 ? "checked" : ""} aria-label="${escapeHtml(config.courseId)} in HJ2"></td>
      <td><input data-fux-course-field="teacher1" value="${escapeHtml(config.teacher1)}" placeholder="Kürzel oder Name" autocomplete="off"></td>
      <td><input data-fux-course-field="teacher2" value="${escapeHtml(config.teacher2)}" placeholder="optional" autocomplete="off"></td>
      <td><input data-fux-course-field="teacher3" value="${escapeHtml(config.teacher3)}" placeholder="optional" autocomplete="off"></td>
      <td><input data-fux-course-field="remark" value="${escapeHtml(config.remark)}" placeholder="optional" autocomplete="off"></td>
    </tr>`;
  }).join("");
  $("#fuxCoursesTable").innerHTML = `<thead><tr><th>Kurs-ID</th><th>Kursname</th><th>Jahrgang</th><th>HJ1</th><th>HJ2</th><th>Lehrer 1</th><th>Lehrer 2</th><th>Lehrer 3</th><th>Bemerkung</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderFuxOverrideRows() {
  const people = new Map((result?.participantResults || []).map((person) => [person.personId, person]));
  const entries = Object.entries(fuxExportDraft.assignmentOverrides || {})
    .filter(([personId]) => people.has(personId))
    .sort(([a], [b]) => {
      const pa = people.get(a); const pb = people.get(b);
      return pa.lastName.localeCompare(pb.lastName, "de") || pa.firstName.localeCompare(pb.firstName, "de") || pa.className.localeCompare(pb.className, "de", { numeric: true });
    });
  $("#fuxOverridesTable").innerHTML = `<thead><tr><th>Schüler</th><th>HJ1</th><th>HJ2</th><th></th></tr></thead><tbody>${entries.map(([personId, override]) => {
    const person = people.get(personId);
    return `<tr data-fux-person-id="${escapeHtml(personId)}"><td><strong>${escapeHtml(person.lastName)}, ${escapeHtml(person.firstName)}</strong><small>Klasse ${escapeHtml(person.className)}</small></td><td><select data-fux-override-field="hj1WorkshopId">${fuxCourseOptions(override.hj1WorkshopId, "HJ1")}</select></td><td><select data-fux-override-field="hj2WorkshopId">${fuxCourseOptions(override.hj2WorkshopId, "HJ2")}</select></td><td><button class="icon-button" type="button" data-action="delete-fux-override" title="Halbjahreswechsel entfernen">×</button></td></tr>`;
  }).join("") || `<tr><td colspan="4" class="muted">Keine individuellen Halbjahreswechsel. Die aktuelle Zuteilung gilt entsprechend der HJ1-/HJ2-Markierung des Kurses.</td></tr>`}</tbody>`;

  const overridden = new Set(entries.map(([personId]) => personId));
  const selectable = [...people.values()]
    .filter((person) => !overridden.has(person.personId))
    .sort((a, b) => a.lastName.localeCompare(b.lastName, "de") || a.firstName.localeCompare(b.firstName, "de") || a.className.localeCompare(b.className, "de", { numeric: true }));
  $("#fuxOverridePerson").innerHTML = selectable.length
    ? selectable.map((person) => option(person.personId, "", `${person.lastName}, ${person.firstName} · ${person.className}`)).join("")
    : `<option value="">Alle Schüler mit Ergebnis sind bereits bearbeitet</option>`;
  $("#fuxAddOverrideBtn").disabled = !selectable.length;
}

function renderFuxExportSummary() {
  const data = fuxExportDataFromDraft();
  $("#fuxExportStats").innerHTML = [
    [data.stats.courses, "Kurse"],
    [data.stats.participantAssignments, "Schüler-Kurs-Zeilen"],
    [data.stats.overrides, "Halbjahreswechsel"],
    [data.stats.unassigned, "Nicht exportiert (unzugeteilt)"],
  ].map(([value, label]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
  const messages = [
    ...data.errors.map((message) => `<div class="message error">${escapeHtml(message)}</div>`),
    ...data.warnings.map((message) => `<div class="message warning">${escapeHtml(message)}</div>`),
  ];
  if (!messages.length) messages.push(`<div class="message success">Exportstruktur ist vollständig und bereit.</div>`);
  $("#fuxExportIssues").innerHTML = messages.join("");
  $("#fuxDownloadBtn").disabled = data.errors.length > 0;
}

function openFuxExportDialog() {
  if (!ensureResult()) return;
  ensureFuxExportDefaults();
  fuxExportDraft = JSON.parse(JSON.stringify(state.fuxExport));
  renderFuxCourseRows();
  renderFuxOverrideRows();
  renderFuxExportSummary();
  $("#fuxExportDialog").showModal();
}

function handleFuxExportChange(event) {
  const courseControl = event.target.closest("[data-fux-course-field]");
  if (courseControl) {
    const workshopId = courseControl.closest("tr")?.dataset.fuxWorkshopId;
    const field = courseControl.dataset.fuxCourseField;
    if (workshopId && fuxExportDraft.courses[workshopId]) {
      fuxExportDraft.courses[workshopId][field] = courseControl.type === "checkbox" ? courseControl.checked : courseControl.value;
      if (field === "hj1" || field === "hj2" || field === "courseId" || field === "courseName") renderFuxOverrideRows();
      renderFuxExportSummary();
    }
    return;
  }
  const overrideControl = event.target.closest("[data-fux-override-field]");
  if (overrideControl) {
    const personId = overrideControl.closest("tr")?.dataset.fuxPersonId;
    if (personId && fuxExportDraft.assignmentOverrides[personId]) {
      fuxExportDraft.assignmentOverrides[personId][overrideControl.dataset.fuxOverrideField] = overrideControl.value;
      renderFuxExportSummary();
    }
  }
}

function handleFuxExportClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "set-fux-semesters") {
    const mode = button.dataset.mode;
    for (const course of fuxOpenCourses()) {
      fuxExportDraft.courses[course.id].hj1 = mode !== "hj2";
      fuxExportDraft.courses[course.id].hj2 = mode !== "hj1";
    }
    renderFuxCourseRows(); renderFuxOverrideRows(); renderFuxExportSummary();
  }
  if (button.dataset.action === "delete-fux-override") {
    const personId = button.closest("tr")?.dataset.fuxPersonId;
    if (personId) delete fuxExportDraft.assignmentOverrides[personId];
    renderFuxOverrideRows(); renderFuxExportSummary();
  }
}

function addFuxAssignmentOverride() {
  const personId = $("#fuxOverridePerson").value;
  const person = result?.participantResults?.find((item) => item.personId === personId);
  if (!person) return;
  const config = fuxExportDraft.courses[person.workshopId];
  fuxExportDraft.assignmentOverrides[personId] = {
    hj1WorkshopId: config?.hj1 ? person.workshopId : "",
    hj2WorkshopId: config?.hj2 ? person.workshopId : "",
  };
  renderFuxOverrideRows(); renderFuxExportSummary();
}

async function downloadFuxExport() {
  const data = fuxExportDataFromDraft();
  if (data.errors.length) {
    renderFuxExportSummary();
    return showDialog("FuxNoten-Export prüfen", data.errors, "warning");
  }
  state.fuxExport = normalizeEvent({ ...state, fuxExport: fuxExportDraft }).fuxExport;
  scheduleSave();
  const workbook = createFuxWorkbook(data);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${safeFilename(state.name)}_FuxNoten.xlsx`);
  $("#fuxExportDialog").close();
  toast(`FuxNoten-Excel mit ${data.stats.courses} Kursen und ${data.stats.participantAssignments} Zuordnungszeilen erstellt.`);
}

function ensureResult() {
  if (result?.ok) return true;
  showDialog("Noch kein Ergebnis", "Bitte zuerst die Zuteilung berechnen.", "warning");
  return false;
}

function addPdfHeader(doc, title, subtitle) {
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text(title, 14, 18);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(subtitle, 14, 25);
}

async function exportCoursePdfs() {
  if (!ensureResult()) return;
  const zip = new JSZip();
  for (const course of result.courseResults.filter((c) => c.open)) {
    const persons = result.participantResults
      .filter((p) => p.workshopId === course.id)
      .sort((a, b) => a.lastName.localeCompare(b.lastName, "de") || a.firstName.localeCompare(b.firstName, "de"));
    const doc = new jsPDF({ format: "a4", unit: "mm" });
    addPdfHeader(doc, `Teilnehmerliste: ${workshopLabel(course)}`, `Klasse ${course.gradeFrom}–${course.gradeTo} · Belegung ${course.load} · Ziel ${course.target} · Maximum ${course.max} · Kohorte min. ${course.cohortMinEffective || "aus"}`);
    autoTable(doc, {
      startY: 31,
      head: [["Nr.", "Nachname", "Vorname", "Klasse", "Zuteilungsart"]],
      body: persons.map((p, i) => [i + 1, p.lastName, p.firstName, String(p.className), p.type]),
      styles: { font: "helvetica", fontSize: 9 },
      headStyles: { fillColor: [31, 78, 120] },
    });
    zip.file(`${safeFilename(workshopLabel(course))}.pdf`, doc.output("arraybuffer"));
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${safeFilename(state.name)}_Kurslisten.zip`);
}

async function exportClassPdfs() {
  if (!ensureResult()) return;
  const zip = new JSZip();
  const classes = [...new Set(result.participantResults.map((p) => p.className))].sort((a, b) => String(a).localeCompare(String(b), "de", { numeric: true }));
  for (const className of classes) {
    const persons = result.participantResults
      .filter((p) => p.className === className)
      .sort((a, b) => a.lastName.localeCompare(b.lastName, "de") || a.firstName.localeCompare(b.firstName, "de"));
    const doc = new jsPDF({ format: "a4", unit: "mm" });
    addPdfHeader(doc, `Klassenliste: ${className}`, "Alphabetisch nach Nachname und Vorname");
    autoTable(doc, {
      startY: 31,
      head: [["Nr.", "Nachname", "Vorname", "Angebot", "Zuteilungsart"]],
      body: persons.map((p, i) => [i + 1, p.lastName, p.firstName, p.workshopName || "Nicht zugeteilt", p.type]),
      styles: { font: "helvetica", fontSize: 9 },
      headStyles: { fillColor: [31, 78, 120] },
    });
    zip.file(`Klasse_${safeFilename(className)}.pdf`, doc.output("arraybuffer"));
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${safeFilename(state.name)}_Klassenlisten.zip`);
}


function docxEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function docxParagraph(text, { bold = false, size = 20, after = 0 } = {}) {
  const runProps = `${bold ? "<w:b/>" : ""}<w:sz w:val=\"${size}\"/><w:szCs w:val=\"${size}\"/>`;
  return `<w:p><w:pPr><w:spacing w:after="${after}"/></w:pPr><w:r><w:rPr>${runProps}</w:rPr><w:t xml:space="preserve">${docxEscape(text)}</w:t></w:r></w:p>`;
}

function docxCell(value, { header = false } = {}) {
  const shading = header ? '<w:shd w:val="clear" w:color="auto" w:fill="D9EAF7"/>' : "";
  return `<w:tc><w:tcPr>${shading}</w:tcPr>${docxParagraph(value, { bold: header, size: 18 })}</w:tc>`;
}

function docxTable(headers, rows) {
  const borders = `<w:tblBorders><w:top w:val="single" w:sz="4" w:color="B7C9D6"/><w:left w:val="single" w:sz="4" w:color="B7C9D6"/><w:bottom w:val="single" w:sz="4" w:color="B7C9D6"/><w:right w:val="single" w:sz="4" w:color="B7C9D6"/><w:insideH w:val="single" w:sz="4" w:color="D9E2E8"/><w:insideV w:val="single" w:sz="4" w:color="D9E2E8"/></w:tblBorders>`;
  const headerRow = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((value) => docxCell(value, { header: true })).join("")}</w:tr>`;
  const bodyRows = rows.map((row) => `<w:tr>${row.map((value) => docxCell(value)).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/>${borders}</w:tblPr>${headerRow}${bodyRows}</w:tbl>`;
}

async function createDocxFile({ title, subtitle, headers, rows }) {
  const file = new JSZip();
  file.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);
  file.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  const word = file.folder("word");
  word.file("styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`);
  word.folder("_rels").file("document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  word.file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${docxParagraph(title, { bold: true, size: 30, after: 80 })}
    ${docxParagraph(subtitle, { size: 18, after: 160 })}
    ${docxTable(headers, rows)}
    <w:p>${docxParagraph("· © 2026 Oliver Richter", { size: 16 }).replace(/^<w:p>|<\/w:p>$/g, "")}</w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="425" w:footer="425" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`);
  return file.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

async function exportCourseDocx() {
  if (!ensureResult()) return;
  const zip = new JSZip();
  for (const course of result.courseResults.filter((c) => c.open)) {
    const persons = result.participantResults
      .filter((p) => p.workshopId === course.id)
      .sort((a, b) => a.lastName.localeCompare(b.lastName, "de") || a.firstName.localeCompare(b.firstName, "de"));
    const docx = await createDocxFile({
      title: `Teilnehmerliste: ${workshopLabel(course)}`,
      subtitle: `Belegung ${course.load} · Ziel ${course.target} · Mindestziel ${course.effectiveMin} · Maximum ${course.max}`,
      headers: ["Nr.", "Nachname", "Vorname", "Klasse", "Zuteilungsart"],
      rows: persons.map((person, index) => [index + 1, person.lastName, person.firstName, String(person.className), person.type]),
    });
    zip.file(`${safeFilename(workshopLabel(course))}.docx`, docx);
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${safeFilename(state.name)}_Kurslisten_Word.zip`);
}

async function exportClassDocx() {
  if (!ensureResult()) return;
  const zip = new JSZip();
  const classes = [...new Set(result.participantResults.map((p) => p.className))]
    .sort((a, b) => String(a).localeCompare(String(b), "de", { numeric: true }));
  for (const className of classes) {
    const persons = result.participantResults
      .filter((p) => p.className === className)
      .sort((a, b) => a.lastName.localeCompare(b.lastName, "de") || a.firstName.localeCompare(b.firstName, "de"));
    const docx = await createDocxFile({
      title: `Klassenliste: ${className}`,
      subtitle: "Alphabetisch nach Nachname und Vorname",
      headers: ["Nr.", "Nachname", "Vorname", "Angebot", "Zuteilungsart"],
      rows: persons.map((person, index) => [index + 1, person.lastName, person.firstName, person.workshopName || "Nicht zugeteilt", person.type]),
    });
    zip.file(`Klasse_${safeFilename(className)}.docx`, docx);
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${safeFilename(state.name)}_Klassenlisten_Word.zip`);
}


async function downloadCourseChoiceTemplate() {
  if (!state.workshops.length) return showDialog("Keine Angebote", "Bitte zuerst Angebote anlegen.", "warning");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ProFlex / GTS / Angebotsmanager";

  const guide = workbook.addWorksheet("Anleitung");
  guide.addRow(["ProFlex / GTS / Angebotsmanager – vollständige Importvorlage"]);
  guide.addRow([]);
  guide.addRow(["Blatt", "Verwendung"]);
  guide.addRow(["Angebote", "Angebote und Durchführungen einschließlich Klassenbereich, Bildungsgang, Kohortenminimum, Mindest-/Maximalbelegung und optionaler Jahrgangsgruppen-Regel pflegen. Beim Import ersetzen diese Angaben die Angebote im aktuellen Projekt."]);
  guide.addRow(["Jahrgangsbelegung", "Optionale Mindest- und Höchstzahlen je Jahrgang und Durchführung. Sie werden bestmöglich erfüllt; leere Felder bedeuten keine Vorgabe."]);
  guide.addRow(["Kursanwahl", `Teilnehmendendaten und ${state.settings.expectedWishes} Wunschspalten erfassen. Die Wünsche beziehen sich auf die Angebots-ID; die feste Setzung auf die konkrete Durchführungs-ID.`]);
  guide.addRow(["Sperrungen", "Unerlaubte Kombinationen aus Person-ID und Durchführungs-ID eintragen. Ein vorhandenes Blatt Sperrungen ersetzt beim Import die Sperrungen des aktuellen Projekts."]);
  guide.addRow([]);
  guide.addRow(["Kohortenminimum", "Leer = globaler Wert der Anwendung, 0 = aus, ab 2 = eigener vorrangiger Zielwert für diese Durchführung."]);
  guide.addRow(["Jahrgangsbelegung", "Beispiel: Jahrgang 8 Minimum 7 = mindestens 7 Achtklässler müssen in diesem Kurs sein. Nur Maximum 4 = höchstens 4. Leer = keine Vorgabe."]);
  guide.addRow(["Jahrgangsgruppen-Regel 8/9 + 10+", "Ja = Jahrgänge 8+9 sowie Jahrgang 10 aufwärts sollen jeweils mit einer durch 4 teilbaren Schülerzahl vertreten sein. Ist das nicht vollständig möglich, wird trotzdem zugeteilt und die kleinste Abweichung angezeigt. Gruppenausgleich Ja = beide Jahrgangsgruppen sollen zusätzlich möglichst gleich groß sein."]);
  guide.addRow(["Hinweis", "Die Vorlage enthält die aktuell im Projekt eingetragenen Angebote, Jahrgangsvorgaben und Sperrungen. Änderungen können direkt in Excel vorgenommen und anschließend wieder importiert werden."]);
  guide.getColumn(1).width = 24;
  guide.getColumn(2).width = 110;
  guide.getRow(1).font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  guide.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  guide.getRow(3).font = { bold: true };

  const workshops = workbook.addWorksheet("Angebote");
  workshops.columns = [
    { header: "Durchführungs-ID", key: "id", width: 20 },
    { header: "Angebots-ID", key: "offerId", width: 16 },
    { header: "Angebot", key: "name", width: 30 },
    { header: "Gruppe", key: "session", width: 12 },
    { header: "Klasse von", key: "gradeFrom", width: 12 },
    { header: "Klasse bis", key: "gradeTo", width: 12 },
    { header: "Bildungsgang", key: "schoolForm", width: 16 },
    { header: "Kohortenminimum", key: "cohortMin", width: 18 },
    { header: "Mindestbelegung", key: "min", width: 18 },
    { header: "Maximalbelegung", key: "max", width: 18 },
    { header: "Jahrgangsgruppen-Regel 8/9 + 10+", key: "gradeGroupEnabled", width: 34 },
    { header: "Gruppenausgleich", key: "gradeGroupBalance", width: 20 },
    { header: "Pflicht/Optional", key: "mode", width: 18 },
  ];
  workshops.addRows(state.workshops.map((w) => ({
    id: w.id,
    offerId: w.offerId || w.id,
    name: w.name,
    session: w.session || "",
    gradeFrom: w.gradeFrom ?? "",
    gradeTo: w.gradeTo ?? "",
    schoolForm: w.schoolForm || "Alle",
    cohortMin: w.cohortMin ?? "",
    min: w.min ?? 0,
    max: w.max ?? 0,
    gradeGroupEnabled: w.gradeGroupRule?.enabled ? "Ja" : "Nein",
    gradeGroupBalance: w.gradeGroupRule?.balance !== false ? "Ja" : "Nein",
    mode: w.mode || state.settings.defaultMode,
  })));
  while (workshops.rowCount < 31) workshops.addRow({});
  styleWorksheet(workshops);
  for (let row = 2; row <= 31; row += 1) {
    workshops.getCell(row, 7).dataValidation = { type: "list", allowBlank: false, formulae: ['"Alle,Regional,Gymnasial"'] };
    workshops.getCell(row, 11).dataValidation = { type: "list", allowBlank: false, formulae: ['"Ja,Nein"'] };
    workshops.getCell(row, 12).dataValidation = { type: "list", allowBlank: false, formulae: ['"Ja,Nein"'] };
    workshops.getCell(row, 13).dataValidation = { type: "list", allowBlank: false, formulae: ['"Pflicht,Optional"'] };
  }

  const gradeLimitsSheet = workbook.addWorksheet("Jahrgangsbelegung");
  gradeLimitsSheet.columns = [
    { header: "Durchführungs-ID", key: "workshopId", width: 22 },
    { header: "Jahrgang", key: "grade", width: 12 },
    { header: "Minimum", key: "min", width: 14 },
    { header: "Maximum", key: "max", width: 14 },
  ];
  for (const workshop of state.workshops) {
    const from = Math.max(1, Math.min(20, Number(workshop.gradeFrom) || 1));
    const to = Math.max(from, Math.min(20, Number(workshop.gradeTo) || from));
    for (let grade = from; grade <= to; grade += 1) {
      const limit = workshop.gradeLimits?.[String(grade)] || {};
      gradeLimitsSheet.addRow({ workshopId: workshop.id, grade, min: limit.min ?? "", max: limit.max ?? "" });
    }
  }
  styleWorksheet(gradeLimitsSheet);

  const sheet = workbook.addWorksheet("Kursanwahl");
  const wishHeaders = ["Erstwunsch", "Zweitwunsch", "Drittwunsch", "Viertwunsch"].slice(0, state.settings.expectedWishes || 3);
  sheet.columns = [
    ["Person-ID", 16], ["Vorname", 20], ["Nachname", 22], ["Klasse", 12], ["Bildungsgang", 16],
    ...wishHeaders.map((header) => [header, 18]), ["Feste Setzung", 20],
  ].map(([header, width]) => ({ header, width }));
  for (let i = 0; i < 500; i += 1) sheet.addRow({});
  styleWorksheet(sheet);
  for (let row = 2; row <= 501; row += 1) {
    sheet.getCell(row, 5).dataValidation = { type: "list", allowBlank: !state.settings.classRequired, formulae: ['"Regional,Gymnasial"'] };
    for (let col = 6; col < 6 + wishHeaders.length; col += 1) {
      sheet.getCell(row, col).dataValidation = { type: "list", allowBlank: true, formulae: ["'Angebote'!$B$2:$B$31"] };
    }
    sheet.getCell(row, 6 + wishHeaders.length).dataValidation = { type: "list", allowBlank: true, formulae: ["'Angebote'!$A$2:$A$31"] };
  }

  const locks = workbook.addWorksheet("Sperrungen");
  locks.columns = [
    { header: "Person-ID", key: "personId", width: 18 },
    { header: "Durchführungs-ID", key: "workshopId", width: 22 },
    { header: "Grund / Hinweis", key: "reason", width: 42 },
  ];
  locks.addRows((state.locks || []).map((lock) => ({
    personId: lock.personId,
    workshopId: lock.workshopId,
    reason: lock.reason || "",
  })));
  while (locks.rowCount < 501) locks.addRow({});
  styleWorksheet(locks);
  for (let row = 2; row <= 501; row += 1) {
    locks.getCell(row, 1).dataValidation = { type: "list", allowBlank: true, formulae: ["'Kursanwahl'!$A$2:$A$501"] };
    locks.getCell(row, 2).dataValidation = { type: "list", allowBlank: true, formulae: ["'Angebote'!$A$2:$A$31"] };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${safeFilename(state.name)}_Importvorlage.xlsx`);
}

async function downloadProviderTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ProFlex / GTS / Angebotsmanager";
  const sheet = workbook.addWorksheet("Angebote");
  sheet.columns = [
    ["Durchführungs-ID", 18], ["Angebots-ID", 16], ["Angebot", 32], ["Gruppe", 12],
    ["Klasse von", 12], ["Klasse bis", 12], ["Bildungsgang", 16], ["Kohortenminimum", 18],
    ["Mindestbelegung", 18], ["Maximalbelegung", 18], ["Pflicht/Optional", 18],
  ].map(([header, width]) => ({ header, width }));
  for (let i = 0; i < 30; i += 1) sheet.addRow({});
  styleWorksheet(sheet);
  for (let row = 2; row <= 31; row += 1) {
    sheet.getCell(row, 7).dataValidation = { type: "list", allowBlank: false, formulae: ['"Alle,Regional,Gymnasial"'] };
    sheet.getCell(row, 11).dataValidation = { type: "list", allowBlank: false, formulae: ['"Pflicht,Optional"'] };
  }
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "Angebots_Zulieferervorlage.xlsx");
}

async function downloadRosterTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ProFlex / GTS / Angebotsmanager";
  const sheet = workbook.addWorksheet("Schueler_Klassenliste");
  sheet.columns = [
    ["Person-ID", 16], ["Nachname", 24], ["Vorname", 22], ["Klasse", 14],
  ].map(([header, width]) => ({ header, width }));
  for (let i = 0; i < 500; i += 1) sheet.addRow({});
  styleWorksheet(sheet);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "Schueler_und_Klassenliste_Vorlage.xlsx");
}

async function downloadSurveyTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ProFlex / GTS / Angebotsmanager";
  const sheet = workbook.addWorksheet("Antworten");
  const wishHeaders = ["Erstwunsch", "Zweitwunsch", "Drittwunsch", "Viertwunsch"].slice(0, state.settings.expectedWishes || 3);
  sheet.columns = [
    ["Name", 28], ["Übermittelt", 20], ["Klasse", 14], ...wishHeaders.map((header) => [header, 28]),
  ].map(([header, width]) => ({ header, width }));
  for (let i = 0; i < 500; i += 1) sheet.addRow({});
  styleWorksheet(sheet);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `Umfragevorlage_${state.settings.expectedWishes || 3}_Wuensche.xlsx`);
}

function handleUnassignedAction(event) {
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "apply-unassigned-suggestion") applyUnassignedSuggestion(action.dataset.personId, action.dataset.courseId);
  if (action.dataset.action === "overbook-unassigned-suggestion") overbookUnassignedSuggestion(action.dataset.personId, action.dataset.courseId);
  if (action.dataset.action === "open-suggestion-course") openCourseDetail(action.dataset.courseId);
}

function bindEvents() {
  $("#tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (button) activateTab(button.dataset.tab);
  });
  $("#eventName").addEventListener("input", (event) => { state.name = event.target.value; commit({ invalidate: false }); });
  $("#projectType").addEventListener("change", (event) => {
    state.settings.projectType = event.target.value === "general" ? "general" : "school";
    state.settings.classRequired = state.settings.projectType === "school";
    commit();
    renderParticipants();
  });
  $("#classRequired").addEventListener("change", (event) => {
    state.settings.classRequired = event.target.value === "true";
    commit();
  });
  $("#expectedWishes").addEventListener("change", (event) => {
    state.settings.expectedWishes = Math.max(1, Math.min(4, Number(event.target.value) || 3));
    commit();
    renderParticipants();
  });
  $("#allowOutside").addEventListener("change", (event) => { state.settings.allowOutside = event.target.value === "true"; commit(); });
  $("#defaultMode").addEventListener("change", (event) => { state.settings.defaultMode = event.target.value; commit({ invalidate: false }); });
  $("#balanceLevel").addEventListener("change", (event) => { state.settings.balanceWeight = Number(event.target.value) || 0; commit(); });
  $("#balanceThreshold").addEventListener("change", (event) => { state.settings.balanceThreshold = Math.max(0, Number(event.target.value) || 0); commit(); });
  $("#qualityMode").addEventListener("change", (event) => { state.settings.qualityMode = event.target.value; commit(); });
  $("#gradePreferenceWeight").addEventListener("input", (event) => updateGradePreferenceWeightOutput(event.target.value));
  $("#gradePreferenceWeight").addEventListener("change", (event) => {
    state.settings.gradePreferenceWeight = Math.max(0, Math.min(100, Number(event.target.value) || 0));
    commit();
  });
  $("#addRuleBtn").addEventListener("click", addRule);
  $("#rulesTable").addEventListener("change", handleRuleChange);
  $("#rulesTable").addEventListener("click", handleRuleClick);
  $("#gradeLimitsSaveBtn").addEventListener("click", saveGradeLimitsDialog);
  $("#gradeLimitsCancelBtn").addEventListener("click", () => $("#gradeLimitsDialog").close());
  $("#debateRuleEnabled").addEventListener("change", (event) => {
    $("#debateBalanceEnabled").disabled = !event.target.checked;
  });
  $("#workshopsTable").addEventListener("change", handleTableChange);
  $("#participantsTable").addEventListener("change", handleTableChange);
  $("#locksTable").addEventListener("change", handleTableChange);
  $("#workshopsTable").addEventListener("click", handleTableClick);
  $("#participantsTable").addEventListener("click", handleTableClick);
  $("#locksTable").addEventListener("click", handleTableClick);
  $("#participantSearch").addEventListener("input", renderParticipants);
  $("#addWorkshopBtn").addEventListener("click", addWorkshop);
  $("#addParticipantBtn").addEventListener("click", addParticipant);
  $("#addLockBtn").addEventListener("click", addLock);
  $("#optimizeBtn").addEventListener("click", runOptimization);
  $("#optimizeBtnSecondary").addEventListener("click", runOptimization);
  $("#fuxExportBtn").addEventListener("click", openFuxExportDialog);
  $("#fuxExportCloseBtn").addEventListener("click", () => $("#fuxExportDialog").close());
  $("#fuxExportCancelBtn").addEventListener("click", () => $("#fuxExportDialog").close());
  $("#fuxCoursesTable").addEventListener("input", handleFuxExportChange);
  $("#fuxOverridesTable").addEventListener("change", handleFuxExportChange);
  $("#fuxExportDialog").addEventListener("click", handleFuxExportClick);
  $("#fuxAddOverrideBtn").addEventListener("click", addFuxAssignmentOverride);
  $("#fuxDownloadBtn").addEventListener("click", async () => {
    try { await downloadFuxExport(); }
    catch (error) { showDialog("FuxNoten-Export fehlgeschlagen", error.message || String(error)); }
  });
  $("#refreshPlanningBtn").addEventListener("click", () => refreshPlanningAnalysis({ simulate: true }));
  $("#compareSolutionsBtn").addEventListener("click", runSolutionComparison);
  $("#demandSort").addEventListener("change", renderPlanning);
  $("#bottleneckList").addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="apply-recommendation"]');
    if (button) applyPlanningRecommendation(button.dataset.recommendationId);
  });
  $("#comparisonCards").addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="apply-comparison"]');
    if (!button) return;
    const profile = comparisonResults.find((item) => item.id === button.dataset.profileId && item.result?.ok);
    if (!profile) return;
    result = JSON.parse(JSON.stringify(profile.result));
    state.settings.gradePreferenceWeight = profile.weight;
    state.settings.balanceWeight = profile.balance;
    commit({ invalidate: false });
    recordAudit("Lösungsprofil", "", "", `Profil „${profile.label}“ wurde als Ergebnis übernommen.`);
    renderResults();
    activateTab("results");
    toast(`Lösung „${profile.label}“ übernommen.`);
  });
  $("#unassignedDiagnosticsTable").addEventListener("click", handleUnassignedAction);
  $("#reviewModeBody").addEventListener("click", handleUnassignedAction);
  $("#reviewPrevBtn").addEventListener("click", () => { reviewIndex = Math.max(0, reviewIndex - 1); renderUnassignedDiagnostics(); });
  $("#reviewNextBtn").addEventListener("click", () => { reviewIndex += 1; renderUnassignedDiagnostics(); });
  $("#reviewSkipBtn").addEventListener("click", () => { const count = unassignedRows().length; if (count) reviewIndex = (reviewIndex + 1) % count; renderUnassignedDiagnostics(); });
  $("#clearAuditBtn").addEventListener("click", () => {
    if (!(state.auditLog || []).length || !confirm("Änderungsprotokoll wirklich leeren?")) return;
    state.auditLog = [];
    scheduleSave();
    renderAuditLog();
  });
  $("#courseResultsTable").addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-course-detail"]');
    const row = event.target.closest("tr[data-course-id]");
    const id = button?.dataset.courseId || row?.dataset.courseId;
    if (id) openCourseDetail(id);
  });
  $("#courseDetailSelect").addEventListener("change", (event) => { selectedCourseId = event.target.value; renderCourseDetail(); });
  $("#prevCourseBtn").addEventListener("click", () => { const courses=result?.courseResults?.filter(c=>c.open)||[]; const i=courses.findIndex(c=>c.id===selectedCourseId); if(courses.length){selectedCourseId=courses[(i-1+courses.length)%courses.length].id;renderCourseDetail();} });
  $("#nextCourseBtn").addEventListener("click", () => { const courses=result?.courseResults?.filter(c=>c.open)||[]; const i=courses.findIndex(c=>c.id===selectedCourseId); if(courses.length){selectedCourseId=courses[(i+1)%courses.length].id;renderCourseDetail();} });
  $("#undoMoveBtn").addEventListener("click", () => { if (restoreResultSnapshot()) { recordAudit("Rückgängig", "", "", "Die letzte manuelle Ergebnisänderung wurde zurückgenommen."); renderResults(); renderCourseDetail(); toast("Letzte manuelle Änderung rückgängig gemacht."); } });
  $("#courseDetailDialog").addEventListener("click", (event) => {
    const tab=event.target.closest("[data-detail-tab]"); if(tab){courseDetailTab=tab.dataset.detailTab;renderCourseDetail();return;}
    const action=event.target.closest("[data-action]"); if(!action)return;
    if(action.dataset.action==="move-person"){const id=action.dataset.personId;const select=$("[data-move-person='"+CSS.escape(id)+"']");if(select?.value)moveParticipant(id,select.value);}
    if(action.dataset.action==="fix-person") fixParticipant(action.dataset.personId);
    if(action.dataset.action==="apply-swap") applySwap(action.dataset.a,action.dataset.b);
  });
  $("#sampleBtn").addEventListener("click", () => {
    if (!confirm("Aktuelle Daten durch die Beispieldaten ersetzen?")) return;
    state = createSampleData(); result = null; scheduleSave(); renderAll(); toast("Beispieldaten geladen.");
  });
  $("#deleteProjectBtn").addEventListener("click", deleteCurrentProject);
  $("#jsonExportBtn").addEventListener("click", exportJson);
  $("#jsonImportBtn").addEventListener("click", () => $("#jsonFile").click());
  $("#templateBtn").addEventListener("click", downloadCourseChoiceTemplate);
  $("#providerTemplateBtn").addEventListener("click", downloadProviderTemplate);
  $("#rosterTemplateBtn").addEventListener("click", downloadRosterTemplate);
  $("#surveyTemplateBtn").addEventListener("click", downloadSurveyTemplate);
  $("#excelImportBtn").addEventListener("click", () => $("#excelFile").click());
  $("#excelExportBtn").addEventListener("click", exportExcel);
  $("#coursePdfBtn").addEventListener("click", exportCoursePdfs);
  $("#classPdfBtn").addEventListener("click", exportClassPdfs);
  $("#courseDocxBtn").addEventListener("click", exportCourseDocx);
  $("#classDocxBtn").addEventListener("click", exportClassDocx);
  $("#jsonFile").addEventListener("change", async (event) => {
    try { if (event.target.files[0]) await importJson(event.target.files[0]); }
    catch (error) { showDialog("JSON-Import fehlgeschlagen", error.message); }
    event.target.value = "";
  });
  $("#excelFile").addEventListener("change", async (event) => {
    try { if (event.target.files[0]) await importExcel(event.target.files[0]); }
    catch (error) { showDialog("Excel-Import fehlgeschlagen", error.message); }
    event.target.value = "";
  });
}

bindEvents();
renderAll();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
