const MODES = new Set(["Pflicht", "Optional"]);
const FORMS = new Set(["Alle", "Regional", "Gymnasial"]);
const GRADE_GROUP_SIZE = 4;
const GRADE_GROUPS = Object.freeze([
  { key: "sekI", label: "Sek I (Jahrgänge 8–9)", gradeFrom: 8, gradeTo: 9 },
  { key: "sekII", label: "Sek II (Jahrgang 10 aufwärts)", gradeFrom: 10, gradeTo: 20 },
]);

export function parseGrade(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})/);
  return match ? Number(match[1]) : NaN;
}

function nullableCount(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(500, Math.trunc(number)));
}

function normalizeGradeLimits(raw) {
  const result = {};
  if (!raw || typeof raw !== "object") return result;
  for (const [rawGrade, value] of Object.entries(raw)) {
    const grade = Number(rawGrade);
    if (!Number.isInteger(grade) || grade < 1 || grade > 20) continue;
    const min = nullableCount(value?.min);
    const max = nullableCount(value?.max);
    if (min === null && max === null) continue;
    result[String(grade)] = { min, max };
  }
  return result;
}

function normalizeGradeGroupRule(raw) {
  if (raw === true) return { enabled: true, balance: true };
  return {
    enabled: raw?.enabled === true,
    balance: raw?.balance !== false,
  };
}

function gradeGroupForGrade(grade) {
  return GRADE_GROUPS.find((group) => grade >= group.gradeFrom && grade <= group.gradeTo) || null;
}

function gradeGroupCountsForPeople(people) {
  const counts = new Map(GRADE_GROUPS.map((group) => [group.key, 0]));
  for (const person of people || []) {
    const group = gradeGroupForGrade(parseGrade(person.className));
    if (group) counts.set(group.key, (counts.get(group.key) || 0) + 1);
  }
  return counts;
}

function gradeGroupSummaryForPeople(course, people) {
  if (!course?.gradeGroupRule?.enabled) return [];
  const counts = gradeGroupCountsForPeople(people);
  return GRADE_GROUPS.map((group) => {
    const count = counts.get(group.key) || 0;
    return {
      key: group.key,
      label: group.label,
      count,
      groupSize: GRADE_GROUP_SIZE,
      remainder: count % GRADE_GROUP_SIZE,
    };
  });
}

function gradeGroupViolationsForPeople(course, people) {
  return gradeGroupSummaryForPeople(course, people)
    .filter((item) => item.remainder !== 0)
    .map((item) => ({
      kind: "debateModulo",
      course,
      ...item,
      distance: Math.min(item.remainder, GRADE_GROUP_SIZE - item.remainder),
    }));
}

function gradeGroupImbalanceForPeople(course, people) {
  if (!course?.gradeGroupRule?.enabled || !course.gradeGroupRule.balance) return 0;
  const summary = gradeGroupSummaryForPeople(course, people);
  return summary.length === 2 ? Math.abs(summary[0].count - summary[1].count) : 0;
}

function gradeLimitEntries(course) {
  return Object.entries(course?.gradeLimits || {})
    .map(([grade, limit]) => ({ grade: Number(grade), min: nullableCount(limit?.min), max: nullableCount(limit?.max) }))
    .filter((item) => Number.isInteger(item.grade) && item.grade >= 1 && item.grade <= 20)
    .sort((a, b) => a.grade - b.grade);
}

function gradeMinimumTotal(course) {
  return gradeLimitEntries(course).reduce((sum, item) => sum + (item.min ?? 0), 0);
}

function courseGradeMaximum(course, grade) {
  const limit = course?.gradeLimits?.[String(grade)];
  const configured = nullableCount(limit?.max);
  return configured === null ? course.max : Math.min(course.max, configured);
}

function normalizeFuxExportState(raw) {
  const courseConfigs = {};
  for (const [workshopId, config] of Object.entries(raw?.courses || {})) {
    const id = String(workshopId || "").trim();
    if (!id) continue;
    courseConfigs[id] = {
      courseId: String(config?.courseId || "").trim(),
      courseName: String(config?.courseName || "").trim(),
      gradeRange: String(config?.gradeRange || "").trim(),
      hj1: config?.hj1 !== false,
      hj2: config?.hj2 !== false,
      teacher1: String(config?.teacher1 || "").trim(),
      teacher2: String(config?.teacher2 || "").trim(),
      teacher3: String(config?.teacher3 || "").trim(),
      remark: String(config?.remark || "").trim(),
    };
  }
  const assignmentOverrides = {};
  for (const [personId, override] of Object.entries(raw?.assignmentOverrides || {})) {
    const id = String(personId || "").trim();
    if (!id) continue;
    assignmentOverrides[id] = {
      hj1WorkshopId: String(override?.hj1WorkshopId || "").trim(),
      hj2WorkshopId: String(override?.hj2WorkshopId || "").trim(),
    };
  }
  return { courses: courseConfigs, assignmentOverrides };
}

export function normalizeEvent(input) {
  const inferredWishCount = Math.max(0, ...(input?.participants || []).map((person) => {
    const wishes = Array.isArray(person?.wishes) ? person.wishes : [];
    let last = 0;
    wishes.forEach((wish, index) => { if (String(wish || "").trim()) last = index + 1; });
    return last;
  }));
  const expectedWishes = input?.settings?.expectedWishes === undefined
    ? Math.max(3, Math.min(4, inferredWishCount || 3))
    : Math.max(1, Math.min(4, Math.trunc(Number(input.settings.expectedWishes) || 3)));
  const settings = {
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
    gradeLimitsRelaxed: false,
    courseMinimumsRelaxed: false,
    rules: [],
    ...(input?.settings ?? {}),
  };

  const normalizedCohortMin = Number(settings.cohortMin);
  const rawRules = Array.isArray(settings.rules) ? settings.rules : [];
  const ruleTypes = new Set(["class", "grade", "gradeForm", "gradeAnyForm"]);
  const normalizedRules = rawRules.map((rule, index) => ({
    id: String(rule?.id || `R${index + 1}`),
    type: ruleTypes.has(rule?.type) ? rule.type : "gradeForm",
    min: Math.max(2, Math.min(20, Number(rule?.min) || 2)),
    mode: rule?.mode === "hard" ? "hard" : "preferred",
    enabled: rule?.enabled !== false,
  }));

  return {
    name: String(input?.name || "Neue Veranstaltung"),
    settings: {
      projectType: settings.projectType === "general" ? "general" : "school",
      classRequired: settings.classRequired !== false,
      expectedWishes,
      allowOutside: Boolean(settings.allowOutside),
      defaultMode: MODES.has(settings.defaultMode) ? settings.defaultMode : "Pflicht",
      balanceWeight: Math.max(0, Math.min(500, Number(settings.balanceWeight) || 0)),
      balanceThreshold: Math.max(0, Math.min(500, Number(settings.balanceThreshold) || 0)),
      cohortMin: normalizedCohortMin === 0 ? 0 : Math.max(2, Math.min(20, Number.isFinite(normalizedCohortMin) ? normalizedCohortMin : 0)),
      qualityMode: ["fast", "standard", "thorough"].includes(settings.qualityMode) ? settings.qualityMode : "standard",
      gradePreferenceWeight: Math.max(0, Math.min(100, Number.isFinite(Number(settings.gradePreferenceWeight)) ? Number(settings.gradePreferenceWeight) : 50)),
      gradeLimitsRelaxed: settings.gradeLimitsRelaxed === true,
      courseMinimumsRelaxed: settings.courseMinimumsRelaxed === true,
      rules: normalizedRules,
    },
    workshops: (input?.workshops ?? []).map((w) => {
      const id = String(w.id ?? "").trim();
      const offerId = String(w.offerId ?? w.courseTypeId ?? w.choiceId ?? id).trim();
      const rawCohortMin = w.cohortMin;
      return {
        id,
        offerId,
        name: String(w.name ?? "").trim(),
        session: String(w.session ?? w.group ?? "").trim(),
        gradeFrom: Number(w.gradeFrom),
        gradeTo: Number(w.gradeTo),
        schoolForm: FORMS.has(w.schoolForm) ? w.schoolForm : "Alle",
        min: Math.max(0, Number(w.min) || 0),
        max: Math.max(0, Number(w.max) || 0),
        mode: MODES.has(w.mode) ? w.mode : settings.defaultMode,
        cohortMin: rawCohortMin === "" || rawCohortMin === null || rawCohortMin === undefined
          ? null
          : Math.max(0, Math.min(20, Number(rawCohortMin) || 0)),
        gradeLimits: normalizeGradeLimits(w.gradeLimits),
        // Neue Projekte verwenden den neutralen Namen. Das alte Feld bleibt beim
        // Import als Alias erhalten, damit vorhandene JSON-Projekte weiterlaufen.
        gradeGroupRule: normalizeGradeGroupRule(w.gradeGroupRule ?? w.debateRule),
        _classRequired: settings.classRequired !== false,
        _gradeLimitsRelaxed: settings.gradeLimitsRelaxed === true,
        _courseMinimumsRelaxed: settings.courseMinimumsRelaxed === true,
      };
    }),
    participants: (input?.participants ?? []).map((p) => {
      const className = String(p.className ?? "").trim();
      const inferredForm = /reg(ional)?$/i.test(className) || /r$/i.test(className)
        ? "Regional"
        : /g/i.test(className) ? "Gymnasial" : "Regional";
      return {
        id: String(p.id ?? "").trim(),
        firstName: String(p.firstName ?? "").trim(),
        lastName: String(p.lastName ?? "").trim(),
        className,
        schoolForm: p.schoolForm === "Gymnasial" ? "Gymnasial" : p.schoolForm === "Regional" ? "Regional" : inferredForm,
        wishes: Array.from({ length: 4 }, (_, i) => i < expectedWishes ? String(p.wishes?.[i] ?? "").trim() : ""),
        fixed: String(p.fixed ?? "").trim(),
        enrollmentIssues: Array.isArray(p.enrollmentIssues) ? p.enrollmentIssues.map((issue) => String(issue || "").trim()).filter(Boolean) : [],
        sourceFile: String(p.sourceFile ?? "").trim(),
        sourceRow: Number(p.sourceRow) || 0,
      };
    }),
    locks: (input?.locks ?? []).map((l) => ({
      personId: String(l.personId ?? "").trim(),
      workshopId: String(l.workshopId ?? "").trim(),
      reason: String(l.reason ?? "").trim(),
    })),
    fuxExport: normalizeFuxExportState(input?.fuxExport),
    auditLog: (Array.isArray(input?.auditLog) ? input.auditLog : []).slice(-100).map((entry, index) => ({
      id: String(entry?.id || `A${index + 1}`),
      timestamp: String(entry?.timestamp || ""),
      action: String(entry?.action || "Änderung"),
      personId: String(entry?.personId || ""),
      courseId: String(entry?.courseId || ""),
      message: String(entry?.message || ""),
    })),
  };
}

function courseMinimumGoal(course, isOpen = true) {
  if (!isOpen) return 0;
  return Math.max(course.min, course.mode === "Pflicht" ? 1 : 0);
}

function effectiveMinimum(course, isOpen = true) {
  if (!isOpen || course?._courseMinimumsRelaxed) return 0;
  // Im ersten Suchlauf bleibt die Kursmindestbelegung eine echte Untergrenze.
  // Nur wenn dieser Lauf keine Lösung findet, startet optimizeEvent automatisch
  // einen Bestmöglich-Durchlauf, in dem das Mindestziel unterschritten werden darf.
  return courseMinimumGoal(course, isOpen);
}

function effectiveCohortMinimum(event, course) {
  const value = course.cohortMin === null ? event.settings.cohortMin : course.cohortMin;
  if (!value) return 0;
  return Math.max(2, value);
}

function cohortKey(person) {
  return `${parseGrade(person.className)}\u0000${person.schoolForm}`;
}

function cohortLabelFromKey(key) {
  const [grade, form] = String(key).split("\u0000");
  return `Jahrgang ${grade} / ${form}`;
}

function rankIndex(person, course) {
  if (!course) return -1;
  return person.wishes.findIndex((wish) => wish === course.offerId);
}

export function rankLabel(person, course) {
  if (!course) return "Nicht zugeteilt";
  if (person.fixed === course.id) return "Feste Setzung";
  const index = rankIndex(person, course);
  return ["Erstwunsch", "Zweitwunsch", "Drittwunsch", "Viertwunsch"][index] ?? "Kein Wunsch";
}

// Wunschkosten sind bewusst stark gestaffelt.
// Eine einzige schlechtere Wunschstufe soll nicht durch viele kleine Vorteile
// beim Kursausgleich aufgewogen werden können. Bei maximal 500 Personen gilt:
// - Drittwunsch ist eine Notlösung gegenüber Erst-/Zweitwunsch.
// - Viertwunsch ist eine deutlich stärkere Notlösung.
// - außerhalb der Wünsche ist noch einmal wesentlich schlechter.
const PREFERENCE_COST = Object.freeze({
  first: 0,
  second: 1_000_000,
  third: 1_000_000_000,
  fourth: 1_000_000_000_000,
  outside: 2_000_000_000_000,
  unassigned: 5_000_000_000_000,
});

function rankBucket(person, course) {
  const index = rankIndex(person, course);
  return index >= 0 ? index : 4;
}

function preferenceCost(person, course) {
  if (person.fixed === course.id) return 0;
  const index = rankBucket(person, course);
  if (index === 0) return PREFERENCE_COST.first;
  if (index === 1) return PREFERENCE_COST.second;
  if (index === 2) return PREFERENCE_COST.third;
  if (index === 3) return PREFERENCE_COST.fourth;
  return PREFERENCE_COST.outside;
}

function badWishMarginalPenalty(rank, ordinal) {
  // Nur als Tie-Breaker innerhalb derselben Wunschqualität:
  // weitere Dritt-/Viertwünsche im selben Kurs werden zunehmend teurer.
  // Die Summen bleiben deutlich kleiner als der Sprung zur nächsten Wunschstufe.
  if (rank === 2) return ordinal * 100;
  if (rank === 3) return ordinal * 100_000;
  return 0;
}

function rankCountsFromAssignments(event, assignments, courseMap) {
  const counts = new Map();
  for (const courseId of courseMap.keys()) counts.set(courseId, [0, 0, 0, 0, 0]);
  const personMap = new Map(event.participants.map((person) => [person.id, person]));
  for (const [personId, courseId] of assignments) {
    if (!courseId || !courseMap.has(courseId)) continue;
    const person = personMap.get(personId);
    if (!person || person.fixed === courseId) continue;
    const bucket = rankBucket(person, courseMap.get(courseId));
    counts.get(courseId)[bucket] += 1;
  }
  return counts;
}

function courseEligible(person, course, lockSet, allowOutside) {
  const grade = parseGrade(person.className);
  if (!Number.isFinite(grade)) {
    if (course._classRequired) return false;
  } else {
    if (grade < course.gradeFrom || grade > course.gradeTo) return false;
    if (course.schoolForm !== "Alle" && person.schoolForm !== course.schoolForm) return false;
  }
  if (lockSet.has(`${person.id}\u0000${course.id}`)) return false;
  if (person.fixed) return person.fixed === course.id;
  return allowOutside || person.wishes.includes(course.offerId);
}

function courseDisplayLabel(course) {
  return `${course.name}${course.session ? ` – Gruppe ${course.session}` : ""}`;
}

export function unassignedDiagnosis(event, person, openSet, courseMap, lockSet, loads) {
  const grade = parseGrade(person.className);
  const wishedOfferIds = [...new Set(person.wishes.filter(Boolean))];
  const lockReasons = new Map(event.locks
    .filter((lock) => lock.personId === person.id && lock.workshopId)
    .map((lock) => [lock.workshopId, lock.reason || "ohne Begründung"]));
  const analyses = event.workshops.map((course) => {
    const load = loads.get(course.id) || 0;
    const hasGrade = Number.isFinite(grade);
    const gradeMatches = hasGrade ? grade >= course.gradeFrom && grade <= course.gradeTo : !event.settings.classRequired;
    const formMatches = hasGrade ? course.schoolForm === "Alle" || course.schoolForm === person.schoolForm : !event.settings.classRequired;
    const locked = lockSet.has(`${person.id}\u0000${course.id}`);
    const wished = wishedOfferIds.includes(course.offerId);
    const open = openSet.has(course.id);
    const freeSeats = Math.max(0, course.max - load);
    return { course, load, gradeMatches, formMatches, locked, wished, open, freeSeats };
  });

  let reason = "Kein zulässiger freier Kursplatz gefunden.";
  if (!wishedOfferIds.length && !event.settings.allowOutside) {
    reason = "Es ist kein Kurswunsch eingetragen und Zuteilungen außerhalb der Wünsche sind ausgeschaltet.";
  } else {
    const wishedCourses = analyses.filter((item) => item.wished);
    const unknownWishes = wishedOfferIds.filter((offerId) => !event.workshops.some((course) => course.offerId === offerId));
    const blockers = wishedCourses.map((item) => {
      const parts = [];
      if (item.locked) parts.push(`gesperrt (${lockReasons.get(item.course.id)})`);
      if (!item.gradeMatches) parts.push(`Klasse ${person.className} liegt außerhalb ${item.course.gradeFrom}–${item.course.gradeTo}`);
      if (!item.formMatches) parts.push(`Bildungsgang ${person.schoolForm} nicht zugelassen`);
      if (!item.open) parts.push("optionale Durchführung ist entfallen");
      if (item.open && item.freeSeats === 0) {
        const overbookedBy = Math.max(0, item.load - item.course.max);
        parts.push(overbookedBy
          ? `überbelegt (${item.load}/${item.course.max}; +${overbookedBy})`
          : `voll (${item.load}/${item.course.max})`);
      }
      if (!parts.length) parts.push("zulässig und mit freiem Platz – bitte Berechnung erneut prüfen");
      return `${courseDisplayLabel(item.course)}: ${parts.join(", ")}`;
    });
    for (const offerId of unknownWishes) blockers.push(`Wunsch ${offerId}: nicht im Kursangebot vorhanden`);
    if (blockers.length) reason = `Kein nutzbarer Wunschplatz. ${blockers.join("; ")}.`;
  }

  const suggestions = analyses
    .filter((item) => item.wished && !item.locked && item.course.max > 0)
    .map((item) => {
      const violations = [];
      const actions = [];
      const wishRank = person.wishes.findIndex((wish) => wish === item.course.offerId) + 1;
      let score = Math.max(0, wishRank - 1) * 2;
      if (!item.open) { actions.push("optionale Durchführung öffnen"); score += 20; }
      if (item.freeSeats === 0) {
        const overbookedBy = Math.max(0, item.load - item.course.max);
        actions.push(overbookedBy
          ? `Platztausch schaffen oder weiter überbelegen – aktuell ${item.load}/${item.course.max} (+${overbookedBy})`
          : `Platztausch schaffen – aktuell voll (${item.load}/${item.course.max})`);
        score += 35;
      }
      if (!item.formMatches) { violations.push(`Bildungsgang-Ausnahme (${person.schoolForm} → ${item.course.schoolForm})`); score += 80; }
      if (!item.gradeMatches) {
        violations.push(`Klassenstufen-Ausnahme (Klasse ${person.className}; zugelassen ${item.course.gradeFrom}–${item.course.gradeTo})`);
        const distance = grade < item.course.gradeFrom ? item.course.gradeFrom - grade : grade - item.course.gradeTo;
        score += 100 + Math.max(0, distance) * 3;
      }
      const canApply = item.open && item.freeSeats > 0 && item.gradeMatches && item.formMatches;
      const overbookedBy = Math.max(0, item.load - item.course.max);
      const freeText = item.freeSeats > 0
        ? `${item.freeSeats} Platz/Plätze frei`
        : overbookedBy
          ? `überbelegt ${item.load}/${item.course.max}; +${overbookedBy}`
          : `voll ${item.load}/${item.course.max}`;
      const requirements = [...actions, ...violations];
      return {
        courseId: item.course.id,
        courseName: courseDisplayLabel(item.course),
        canApply,
        wishRank,
        score,
        violations,
        text: `${wishRank}. Wunsch: ${courseDisplayLabel(item.course)} (${freeText})${requirements.length ? ` – erforderlich: ${requirements.join("; ")}` : " – ohne zusätzliche Regelabweichung möglich"}`,
      };
    })
    .sort((a, b) => a.score - b.score || a.courseName.localeCompare(b.courseName, "de"))
    .slice(0, 3);

  if (!suggestions.length) {
    suggestions.push({
      courseId: "",
      courseName: "",
      canApply: false,
      score: Number.POSITIVE_INFINITY,
      violations: [],
      text: "Kein Zuordnungsvorschlag innerhalb der eingetragenen Wünsche verfügbar. Die Wunschkurse sind gesperrt, unzulässig oder nicht im Kursangebot vorhanden.",
    });
  }
  return { reason, suggestions };
}

export function validateEvent(raw) {
  const event = normalizeEvent(raw);
  const errors = [];
  const warnings = [];
  const courseMap = new Map();
  const offerMap = new Map();
  const personMap = new Map();
  const lockSet = new Set();

  if (event.participants.length > 500) errors.push("Es sind mehr als 500 Teilnehmende eingetragen.");
  if (event.workshops.length > 30) errors.push("Es sind mehr als 30 Durchführungen eingetragen.");
  if (!event.workshops.length) errors.push("Es ist kein Angebot eingetragen.");
  if (!event.participants.length) errors.push("Es ist keine teilnehmende Person eingetragen.");

  event.workshops.forEach((course, index) => {
    const where = `Angebots-Zeile ${index + 1}`;
    if (!course.id) errors.push(`${where}: Durchführungs-ID fehlt.`);
    if (!course.offerId) errors.push(`${where}: Kursart-ID fehlt.`);
    if (!course.name) errors.push(`${where}: Angebotsname fehlt.`);
    if (courseMap.has(course.id)) errors.push(`${where}: Durchführungs-ID ${course.id} ist doppelt.`);
    courseMap.set(course.id, course);
    if (!offerMap.has(course.offerId)) offerMap.set(course.offerId, course.name);
    else if (offerMap.get(course.offerId) !== course.name) warnings.push(`${course.id}: Kursart-ID ${course.offerId} wird mit unterschiedlichen Namen verwendet.`);
    if (!Number.isFinite(course.gradeFrom) || !Number.isFinite(course.gradeTo)) {
      errors.push(`${course.id || where}: Klassenbereich ist ungültig.`);
    } else if (course.gradeFrom > course.gradeTo) {
      errors.push(`${course.id}: „Klasse von“ ist größer als „Klasse bis“.`);
    }
    if (course.max < 1) errors.push(`${course.id}: Maximalbelegung muss mindestens 1 sein.`);
    if (course.min > course.max) errors.push(`${course.id}: Mindestbelegung ist größer als Maximalbelegung.`);
    if (!MODES.has(course.mode)) errors.push(`${course.id}: Durchführung muss Pflicht oder Optional sein.`);
    if (course.cohortMin === 1) errors.push(`${course.id}: Kohortenminimum darf nicht 1 sein (0 = aus, leer = global, sonst mindestens 2).`);

    const gradeLimits = gradeLimitEntries(course);
    for (const limit of gradeLimits) {
      if (limit.min !== null && limit.max !== null && limit.min > limit.max) {
        warnings.push(`${course.id}: Jahrgang ${limit.grade}: Minimum ${limit.min} ist größer als Maximum ${limit.max}. Die widersprüchlichen Zielwerte werden bestmöglich angenähert.`);
      }
      if ((limit.min ?? 0) > course.max) {
        warnings.push(`${course.id}: Jahrgang ${limit.grade}: Minimum ${limit.min} ist größer als die gesamte Maximalbelegung ${course.max}. Diese Jahrgangsregel kann nur bestmöglich angenähert werden.`);
      }
      if (limit.grade < course.gradeFrom || limit.grade > course.gradeTo) {
        if ((limit.min ?? 0) > 0) warnings.push(`${course.id}: Jahrgang ${limit.grade} hat ein Minimum, liegt aber außerhalb des zugelassenen Klassenbereichs ${course.gradeFrom}–${course.gradeTo}. Diese Vorgabe wird bei Bedarf als Regelabweichung behandelt.`);
        else warnings.push(`${course.id}: Jahrgang ${limit.grade} liegt außerhalb des zugelassenen Klassenbereichs; die Jahrgangsgrenze hat daher keine Wirkung.`);
      }
    }
    const gradeMinTotal = gradeMinimumTotal(course);
    if (gradeMinTotal > course.max) {
      warnings.push(`${course.id}: Die Jahrgangs-Minima ergeben zusammen ${gradeMinTotal}, die Maximalbelegung des Kurses ist aber nur ${course.max}. Die Jahrgangsregeln werden bestmöglich angenähert.`);
    }
    if (course.gradeGroupRule.enabled) {
      if (course.gradeTo < 8) {
        warnings.push(`${course.id}: Die Jahrgangsgruppen-Regel hat keine Wirkung, weil der Kurs nur Jahrgänge unter 8 zulässt.`);
      }
      const overlapsSekI = course.gradeFrom <= 9 && course.gradeTo >= 8;
      const overlapsSekII = course.gradeTo >= 10;
      if (course.gradeGroupRule.balance && !(overlapsSekI && overlapsSekII)) {
        warnings.push(`${course.id}: Der weiche Ausgleich der Jahrgangsgruppen wirkt nur sinnvoll, wenn Jahrgänge 8–9 und 10 aufwärts zugelassen sind.`);
      }
      if (course.mode === "Pflicht" && course.gradeFrom >= 8) {
        const minimum = effectiveMinimum(course);
        const firstAllowedTotal = Math.ceil(minimum / GRADE_GROUP_SIZE) * GRADE_GROUP_SIZE;
        if (firstAllowedTotal > course.max) {
          warnings.push(`${course.id}: Zwischen Mindestbelegung ${minimum} und Maximum ${course.max} liegt keine durch ${GRADE_GROUP_SIZE} teilbare Gesamtbelegung. Die Jahrgangsgruppen-Regel wird deshalb bestmöglich angenähert.`);
        }
      }
    }
  });

  event.participants.forEach((person, index) => {
    const where = `Teilnehmenden-Zeile ${index + 1}`;
    if (!person.id) errors.push(`${where}: Person-ID fehlt.`);
    if (personMap.has(person.id)) errors.push(`${where}: Person-ID ${person.id} ist doppelt.`);
    personMap.set(person.id, person);
    if (!person.firstName || !person.lastName) warnings.push(`${person.id || where}: Vor- oder Nachname fehlt.`);
    const grade = parseGrade(person.className);
    if (!Number.isFinite(grade)) {
      if (event.settings.classRequired) {
        warnings.push(`${person.id || where} – ${person.firstName} ${person.lastName}: Klasse fehlt oder ist nicht auswertbar. Die Person wird ohne Klassenkorrektur nicht über Jahrgangsregeln zugeordnet.`);
      } else if (person.className) {
        warnings.push(`${person.id || where} – ${person.firstName} ${person.lastName}: Klassenangabe „${person.className}“ enthält keinen erkennbaren Jahrgang und wird für Zugangsregeln ignoriert.`);
      }
    }
    person.wishes.filter(Boolean).forEach((wish) => {
      if (!offerMap.has(wish)) warnings.push(`${person.id}: Wunsch ${wish} ist nicht als Kursart vorhanden.`);
    });
    const used = person.wishes.filter(Boolean);
    if (new Set(used).size !== used.length) {
      const positions = new Map();
      person.wishes.forEach((wish, wishIndex) => {
        if (!wish) return;
        if (!positions.has(wish)) positions.set(wish, []);
        positions.get(wish).push(wishIndex + 1);
      });
      for (const [wish, wishPositions] of positions) {
        if (wishPositions.length < 2) continue;
        const name = offerMap.get(wish) || "unbekanntes Angebot";
        warnings.push(`${person.id} – ${person.firstName} ${person.lastName} (Klasse ${person.className}): „${name}“ (${wish}) wurde mehrfach eingetragen – Wunsch ${wishPositions.join(" und ")}.`);
      }
    }
    const uniqueWishCount = new Set(used).size;
    if (uniqueWishCount < event.settings.expectedWishes) {
      const classLabel = person.className ? `Klasse ${person.className}` : "ohne Klasse";
      warnings.push(`${person.id || where} – ${person.firstName} ${person.lastName} (${classLabel}): nur ${uniqueWishCount} von ${event.settings.expectedWishes} erwarteten unterschiedlichen Wünschen eingetragen.`);
    }
    for (const issue of person.enrollmentIssues || []) {
      const classLabel = person.className ? `Klasse ${person.className}` : "ohne Klasse";
      warnings.push(`${person.id || where} – ${person.firstName} ${person.lastName} (${classLabel}): ${issue}`);
    }
    if (person.fixed && !courseMap.has(person.fixed)) errors.push(`${person.id}: Feste Setzung auf Durchführung ${person.fixed} ist unbekannt.`);
  });

  event.locks.forEach((lock, index) => {
    if (!lock.personId && !lock.workshopId) return;
    if (!personMap.has(lock.personId)) warnings.push(`Sperrung ${index + 1}: Person ${lock.personId} ist unbekannt.`);
    if (!courseMap.has(lock.workshopId)) warnings.push(`Sperrung ${index + 1}: Angebot ${lock.workshopId} ist unbekannt.`);
    const key = `${lock.personId}\u0000${lock.workshopId}`;
    if (lockSet.has(key)) warnings.push(`Sperrung ${index + 1}: Kombination ist doppelt.`);
    lockSet.add(key);
  });

  for (const person of event.participants) {
    if (!person.fixed || !courseMap.has(person.fixed)) continue;
    const course = courseMap.get(person.fixed);
    const grade = parseGrade(person.className);
    if (Number.isFinite(grade) && (grade < course.gradeFrom || grade > course.gradeTo)) {
      errors.push(`${person.id}: Feste Setzung ${course.id} passt nicht zur Klassenstufe.`);
    }
    if (Number.isFinite(grade) && course.schoolForm !== "Alle" && course.schoolForm !== person.schoolForm) {
      errors.push(`${person.id}: Feste Setzung ${course.id} passt nicht zum Bildungsgang.`);
    }
    if (lockSet.has(`${person.id}\u0000${course.id}`)) {
      errors.push(`${person.id}: Feste Setzung ${course.id} ist gleichzeitig gesperrt.`);
    }
  }

  const mandatoryMinimum = event.workshops
    .filter((course) => course.mode === "Pflicht")
    .reduce((sum, course) => sum + courseMinimumGoal(course), 0);
  if (mandatoryMinimum > event.participants.length) {
    const message = `Die Mindestziele der Pflichtkurse (${mandatoryMinimum}) übersteigen die Teilnehmerzahl (${event.participants.length}).`;
    if (event.settings.courseMinimumsRelaxed) warnings.push(`${message} Sie werden deshalb bestmöglich angenähert.`);
    else errors.push(message);
  }

  return { event, errors, warnings };
}

class BinaryHeap {
  constructor() { this.items = []; }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= item[0]) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items;
    if (!a.length) return null;
    const root = a[0];
    const last = a.pop();
    if (a.length && last) {
      let i = 0;
      while (true) {
        let left = i * 2 + 1;
        if (left >= a.length) break;
        let right = left + 1;
        let child = right < a.length && a[right][0] < a[left][0] ? right : left;
        if (a[child][0] >= last[0]) break;
        a[i] = a[child];
        i = child;
      }
      a[i] = last;
    }
    return root;
  }
  get size() { return this.items.length; }
}

class MinCostMaxFlow {
  constructor(n) {
    this.graph = Array.from({ length: n }, () => []);
  }
  addEdge(from, to, cap, cost, meta = null) {
    const forward = { to, rev: this.graph[to].length, cap, cost, initialCap: cap, meta };
    const reverse = { to: from, rev: this.graph[from].length, cap: 0, cost: -cost, initialCap: 0, meta: null };
    this.graph[from].push(forward);
    this.graph[to].push(reverse);
    return forward;
  }
  run(source, sink, maxFlow) {
    const n = this.graph.length;
    const potential = Array(n).fill(0);
    let flow = 0;
    let cost = 0;

    while (flow < maxFlow) {
      const dist = Array(n).fill(Infinity);
      const prevNode = Array(n).fill(-1);
      const prevEdge = Array(n).fill(-1);
      dist[source] = 0;
      const heap = new BinaryHeap();
      heap.push([0, source]);

      while (heap.size) {
        const [d, node] = heap.pop();
        if (d !== dist[node]) continue;
        const edges = this.graph[node];
        for (let i = 0; i < edges.length; i += 1) {
          const edge = edges[i];
          if (edge.cap <= 0) continue;
          const next = d + edge.cost + potential[node] - potential[edge.to];
          if (next < dist[edge.to]) {
            dist[edge.to] = next;
            prevNode[edge.to] = node;
            prevEdge[edge.to] = i;
            heap.push([next, edge.to]);
          }
        }
      }

      if (!Number.isFinite(dist[sink])) break;
      for (let i = 0; i < n; i += 1) {
        if (Number.isFinite(dist[i])) potential[i] += dist[i];
      }

      let add = maxFlow - flow;
      for (let node = sink; node !== source; node = prevNode[node]) {
        if (node < 0 || prevNode[node] < 0) { add = 0; break; }
        add = Math.min(add, this.graph[prevNode[node]][prevEdge[node]].cap);
      }
      if (add <= 0) break;

      for (let node = sink; node !== source; node = prevNode[node]) {
        const edge = this.graph[prevNode[node]][prevEdge[node]];
        edge.cap -= add;
        this.graph[node][edge.rev].cap += add;
        cost += add * edge.cost;
      }
      flow += add;
    }

    return { flow, cost };
  }
}

class Dinic {
  constructor(n) { this.g = Array.from({ length: n }, () => []); }
  addEdge(from, to, cap) {
    const f = { to, rev: this.g[to].length, cap };
    const r = { to: from, rev: this.g[from].length, cap: 0 };
    this.g[from].push(f); this.g[to].push(r);
  }
  maxFlow(source, sink) {
    let total = 0;
    const n = this.g.length;
    while (true) {
      const level = Array(n).fill(-1);
      level[source] = 0;
      const queue = [source];
      for (let q = 0; q < queue.length; q += 1) {
        const v = queue[q];
        for (const e of this.g[v]) if (e.cap > 0 && level[e.to] < 0) {
          level[e.to] = level[v] + 1; queue.push(e.to);
        }
      }
      if (level[sink] < 0) return total;
      const it = Array(n).fill(0);
      const dfs = (v, pushed) => {
        if (v === sink) return pushed;
        for (; it[v] < this.g[v].length; it[v] += 1) {
          const e = this.g[v][it[v]];
          if (e.cap <= 0 || level[e.to] !== level[v] + 1) continue;
          const sent = dfs(e.to, Math.min(pushed, e.cap));
          if (sent > 0) { e.cap -= sent; this.g[e.to][e.rev].cap += sent; return sent; }
        }
        return 0;
      };
      while (true) {
        const sent = dfs(source, Number.MAX_SAFE_INTEGER);
        if (!sent) break;
        total += sent;
      }
    }
  }
}

function fixedLoads(event, courseMap) {
  const loads = new Map([...courseMap.keys()].map((id) => [id, 0]));
  for (const person of event.participants) if (person.fixed && loads.has(person.fixed)) {
    loads.set(person.fixed, loads.get(person.fixed) + 1);
  }
  return loads;
}

function canMeetMinimums(event, openSet, lockSet, courseMap) {
  const fixed = fixedLoads(event, courseMap);
  for (const [courseId, load] of fixed) {
    if (load > 0 && !openSet.has(courseId)) return false;
    if (load > (courseMap.get(courseId)?.max ?? 0)) return false;
  }

  const courses = [...openSet].map((id) => courseMap.get(id)).filter(Boolean);
  const nonFixed = event.participants.filter((p) => !p.fixed);
  const source = 0;
  const courseStart = 1;
  const personStart = courseStart + courses.length;
  const sink = personStart + nonFixed.length;
  const dinic = new Dinic(sink + 1);
  let requiredTotal = 0;

  courses.forEach((course, ci) => {
    const requirement = Math.max(0, effectiveMinimum(course) - (fixed.get(course.id) || 0));
    if (requirement > course.max - (fixed.get(course.id) || 0)) return false;
    requiredTotal += requirement;
    dinic.addEdge(source, courseStart + ci, requirement);
    nonFixed.forEach((person, pi) => {
      if (courseEligible(person, course, lockSet, event.settings.allowOutside)) {
        dinic.addEdge(courseStart + ci, personStart + pi, 1);
      }
    });
  });
  nonFixed.forEach((_, pi) => dinic.addEdge(personStart + pi, sink, 1));
  return dinic.maxFlow(source, sink) === requiredTotal;
}

function determineOpenCourses(event, lockSet, courseMap) {
  const open = new Set(event.workshops.filter((c) => c.mode === "Pflicht").map((c) => c.id));
  for (const person of event.participants) if (person.fixed) open.add(person.fixed);

  if (!canMeetMinimums(event, open, lockSet, courseMap)) {
    throw new Error("Die Mindestbelegungen der Pflichtangebote können nicht gleichzeitig erfüllt werden. Prüfe Wünsche, Sperrungen, Klassenstufen und Bildungsgänge.");
  }

  const optional = event.workshops
    .filter((course) => course.mode === "Optional" && !open.has(course.id))
    .map((course) => {
      let score = 0;
      let candidates = 0;
      for (const person of event.participants) {
        if (!courseEligible(person, course, lockSet, event.settings.allowOutside)) continue;
        candidates += 1;
        const idx = rankIndex(person, course);
        score += [100, 30, 10, 3][idx] ?? (event.settings.allowOutside ? 1 : 0);
      }
      return { course, score, candidates };
    })
    .filter(({ course, candidates }) => candidates >= courseMinimumGoal(course))
    .sort((a, b) => b.score - a.score || a.course.id.localeCompare(b.course.id, "de"));

  for (const { course } of optional) {
    const trial = new Set(open);
    trial.add(course.id);
    if (canMeetMinimums(event, trial, lockSet, courseMap)) open.add(course.id);
  }
  return open;
}

function calculateTargets(event, openSet, courseMap, fixed) {
  const targets = new Map();
  const openCourses = [...openSet].map((id) => courseMap.get(id)).filter(Boolean);
  let baseTotal = 0;
  let maxTotal = 0;

  for (const course of openCourses) {
    const target = Math.min(fixed.get(course.id) || 0, course.max);
    targets.set(course.id, target);
    baseTotal += target;
    maxTotal += course.max;
  }

  let remaining = Math.min(event.participants.length, maxTotal) - baseTotal;
  const threshold = Math.max(0, Number(event.settings.balanceThreshold) || 0);

  // Mindestbelegungen bleiben das erste Belegungsziel. Sind zusammen nicht
  // genügend Schüler vorhanden, werden die erreichbaren Plätze fair auf die
  // noch unter ihrem Mindestziel liegenden Kurse verteilt, statt abzubrechen.
  while (remaining > 0) {
    const candidates = openCourses
      .filter((course) => (targets.get(course.id) || 0) < Math.min(courseMinimumGoal(course), course.max))
      .sort((a, b) => {
        const aGoal = Math.max(1, Math.min(courseMinimumGoal(a), a.max));
        const bGoal = Math.max(1, Math.min(courseMinimumGoal(b), b.max));
        const aRatio = (targets.get(a.id) || 0) / aGoal;
        const bRatio = (targets.get(b.id) || 0) / bGoal;
        return aRatio - bRatio || (targets.get(a.id) || 0) - (targets.get(b.id) || 0) || a.id.localeCompare(b.id, "de");
      });
    if (!candidates.length) break;
    const course = candidates[0];
    targets.set(course.id, (targets.get(course.id) || 0) + 1);
    remaining -= 1;
  }

  // Kleine Kurse (bis einschließlich der eingestellten Schwelle) erhalten
  // bevorzugt ihre Maximalgröße als Ziel. Die Mindestbelegungen aller anderen
  // Kurse sind zu diesem Zeitpunkt bereits als Ziel berücksichtigt.
  const smallCourses = openCourses
    .filter((course) => threshold > 0 && course.max <= threshold)
    .sort((a, b) => a.max - b.max || a.id.localeCompare(b.id, "de"));

  for (const course of smallCourses) {
    if (remaining <= 0) break;
    const gap = Math.max(0, course.max - (targets.get(course.id) || 0));
    const add = Math.min(gap, remaining);
    targets.set(course.id, (targets.get(course.id) || 0) + add);
    remaining -= add;
  }

  // Der Rest wird auf die größeren Kurse nach absoluter Teilnehmerzahl
  // möglichst gleichmäßig verteilt. Maximalgrößen bleiben harte Grenzen.
  const largeCourses = openCourses.filter((course) => !(threshold > 0 && course.max <= threshold));
  while (remaining > 0 && largeCourses.length) {
    const candidates = largeCourses
      .filter((course) => (targets.get(course.id) || 0) < course.max)
      .sort((a, b) => (targets.get(a.id) || 0) - (targets.get(b.id) || 0) || a.max - b.max || a.id.localeCompare(b.id, "de"));
    if (!candidates.length) break;
    const course = candidates[0];
    targets.set(course.id, (targets.get(course.id) || 0) + 1);
    remaining -= 1;
  }

  // Falls es ausschließlich kleine Kurse gibt oder große Kurse bereits voll sind.
  while (remaining > 0) {
    const candidates = openCourses
      .filter((course) => (targets.get(course.id) || 0) < course.max)
      .sort((a, b) => (targets.get(a.id) || 0) - (targets.get(b.id) || 0) || a.max - b.max || a.id.localeCompare(b.id, "de"));
    if (!candidates.length) break;
    const course = candidates[0];
    targets.set(course.id, (targets.get(course.id) || 0) + 1);
    remaining -= 1;
  }

  return targets;
}

function assignMinimums(event, openSet, lockSet, courseMap, assignments, loads) {
  const nonFixed = event.participants.filter((person) => !assignments.has(person.id));
  const courses = [...openSet].map((id) => courseMap.get(id)).filter(Boolean);
  const existingRanks = rankCountsFromAssignments(event, assignments, courseMap);
  const source = 0;
  const courseStart = 1;
  const rankStart = courseStart + courses.length;
  const rankNode = (ci, rank) => rankStart + ci * 5 + rank;
  const personStart = rankStart + courses.length * 5;
  const sink = personStart + nonFixed.length;
  const flow = new MinCostMaxFlow(sink + 1);
  const assignmentEdges = [];
  let requiredTotal = 0;

  courses.forEach((course, ci) => {
    const required = Math.max(0, effectiveMinimum(course) - (loads.get(course.id) || 0));
    requiredTotal += required;
    flow.addEdge(source, courseStart + ci, required, 0);

    for (let rank = 0; rank < 5; rank += 1) {
      const already = existingRanks.get(course.id)?.[rank] || 0;
      for (let seat = 1; seat <= required; seat += 1) {
        flow.addEdge(
          courseStart + ci,
          rankNode(ci, rank),
          1,
          badWishMarginalPenalty(rank, already + seat),
        );
      }
    }

    nonFixed.forEach((person, pi) => {
      if (!courseEligible(person, course, lockSet, event.settings.allowOutside)) return;
      const rank = rankBucket(person, course);
      const edge = flow.addEdge(rankNode(ci, rank), personStart + pi, 1, preferenceCost(person, course), {
        personId: person.id,
        courseId: course.id,
      });
      assignmentEdges.push(edge);
    });
  });
  nonFixed.forEach((_, pi) => flow.addEdge(personStart + pi, sink, 1, 0));

  const outcome = flow.run(source, sink, requiredTotal);
  if (outcome.flow !== requiredTotal) throw new Error("Die Mindestbelegungen konnten nicht erfüllt werden.");
  for (const edge of assignmentEdges) {
    if (edge.initialCap === 1 && edge.cap === 0) {
      assignments.set(edge.meta.personId, edge.meta.courseId);
      loads.set(edge.meta.courseId, (loads.get(edge.meta.courseId) || 0) + 1);
    }
  }
}

function assignRemaining(event, openSet, lockSet, courseMap, assignments, loads, targets) {
  const remainingPeople = event.participants.filter((person) => !assignments.has(person.id));
  const courses = [...openSet].map((id) => courseMap.get(id)).filter(Boolean);
  const existingRanks = rankCountsFromAssignments(event, assignments, courseMap);
  const source = 0;
  const personStart = 1;
  const rankStart = personStart + remainingPeople.length;
  const rankNode = (ci, rank) => rankStart + ci * 5 + rank;
  const courseStart = rankStart + courses.length * 5;
  const sink = courseStart + courses.length;
  const flow = new MinCostMaxFlow(sink + 1);
  const assignmentEdges = [];
  const unassignedEdges = [];

  remainingPeople.forEach((person, pi) => {
    const personNode = personStart + pi;
    flow.addEdge(source, personNode, 1, 0);
    courses.forEach((course, ci) => {
      if (!courseEligible(person, course, lockSet, event.settings.allowOutside)) return;
      if ((loads.get(course.id) || 0) >= course.max) return;
      const rank = rankBucket(person, course);
      const edge = flow.addEdge(personNode, rankNode(ci, rank), 1, preferenceCost(person, course), {
        personId: person.id,
        courseId: course.id,
      });
      assignmentEdges.push(edge);
    });
    const edge = flow.addEdge(personNode, sink, 1, PREFERENCE_COST.unassigned, { personId: person.id });
    unassignedEdges.push(edge);
  });

  courses.forEach((course, ci) => {
    const current = loads.get(course.id) || 0;
    const available = Math.max(0, course.max - current);

    for (let rank = 0; rank < 5; rank += 1) {
      const already = existingRanks.get(course.id)?.[rank] || 0;
      for (let seat = 1; seat <= available; seat += 1) {
        flow.addEdge(
          rankNode(ci, rank),
          courseStart + ci,
          1,
          badWishMarginalPenalty(rank, already + seat),
        );
      }
    }

    for (let seat = 1; seat <= available; seat += 1) {
      const resultingLoad = current + seat;
      const threshold = Math.max(0, Number(event.settings.balanceThreshold) || 0);
      const smallCourse = threshold > 0 && course.max <= threshold;
      const balanceActive = event.settings.balanceWeight > 0;
      let penalty = 0;
      if (balanceActive) {
        if (smallCourse) {
          // Kleine Kurse sollen bevorzugt ihr Maximum erreichen. Eine leichte
          // Zusatzstrafe auf große Kurse macht bei ansonsten gleicher
          // Wunschqualität den kleinen Kurs attraktiver.
          penalty = Math.round(event.settings.balanceWeight * Math.max(0, resultingLoad - course.max));
        } else {
          penalty = Math.round(event.settings.balanceWeight * Math.abs(resultingLoad - (targets.get(course.id) || 0)));
        }
      }
      flow.addEdge(courseStart + ci, sink, 1, penalty);
    }
  });

  const outcome = flow.run(source, sink, remainingPeople.length);
  if (outcome.flow !== remainingPeople.length) throw new Error("Die restlichen Teilnehmenden konnten nicht verarbeitet werden.");
  for (const edge of assignmentEdges) {
    if (edge.initialCap === 1 && edge.cap === 0) {
      assignments.set(edge.meta.personId, edge.meta.courseId);
      loads.set(edge.meta.courseId, (loads.get(edge.meta.courseId) || 0) + 1);
    }
  }
  for (const edge of unassignedEdges) {
    if (edge.initialCap === 1 && edge.cap === 0 && !assignments.has(edge.meta.personId)) {
      assignments.set(edge.meta.personId, "");
    }
  }
}

// Gemeinsame Erstzuteilung mit unteren und oberen Schranken. Anders als die
// historische Zweiphasen-Variante entscheidet dieses Modell gleichzeitig,
// welche Personen die Mindestplätze belegen und wie alle übrigen Plätze
// vergeben werden. So wird kein vielseitig einsetzbarer Schüler vorschnell für
// ein Kursminimum gebunden, wenn ein stärker gebundener Schüler diesen Platz
// dringender benötigt.
function assignInitialCombined(event, openSet, lockSet, courseMap, assignments, loads, targets) {
  const people = event.participants.filter((person) => !assignments.has(person.id));
  const courses = [...openSet].map((id) => courseMap.get(id)).filter(Boolean);
  const existingRanks = rankCountsFromAssignments(event, assignments, courseMap);
  const source = 0;
  const personStart = 1;
  const rankStart = personStart + people.length;
  const rankNode = (ci, rank) => rankStart + ci * 5 + rank;
  const courseStart = rankStart + courses.length * 5;
  const unassignedNode = courseStart + courses.length;
  const sink = unassignedNode + 1;
  const superSource = sink + 1;
  const superSink = superSource + 1;
  const flow = new MinCostMaxFlow(superSink + 1);
  const balance = Array(superSink + 1).fill(0);
  const assignmentEdges = [];
  let invalidBounds = false;

  const addBoundedEdge = (from, to, lower, upper, cost, meta = null) => {
    const lo = Math.max(0, Math.trunc(lower));
    const hi = Math.max(0, Math.trunc(upper));
    if (lo > hi) {
      invalidBounds = true;
      return null;
    }
    balance[from] -= lo;
    balance[to] += lo;
    return flow.addEdge(from, to, hi - lo, cost, meta);
  };

  people.forEach((person, pi) => {
    const personNode = personStart + pi;
    addBoundedEdge(source, personNode, 1, 1, 0);
    courses.forEach((course, ci) => {
      if (!courseEligible(person, course, lockSet, event.settings.allowOutside)) return;
      const rank = rankBucket(person, course);
      const edge = addBoundedEdge(
        personNode,
        rankNode(ci, rank),
        0,
        1,
        preferenceCost(person, course),
        { personId: person.id, courseId: course.id },
      );
      if (edge) assignmentEdges.push(edge);
    });
    addBoundedEdge(personNode, unassignedNode, 0, 1, PREFERENCE_COST.unassigned);
  });

  courses.forEach((course, ci) => {
    const current = loads.get(course.id) || 0;
    const available = Math.max(0, course.max - current);
    const required = Math.max(0, effectiveMinimum(course) - current);
    if (required > available) invalidBounds = true;

    for (let rank = 0; rank < 5; rank += 1) {
      const already = existingRanks.get(course.id)?.[rank] || 0;
      for (let seat = 1; seat <= available; seat += 1) {
        addBoundedEdge(
          rankNode(ci, rank),
          courseStart + ci,
          0,
          1,
          badWishMarginalPenalty(rank, already + seat),
        );
      }
    }

    // Der erste Anteil bildet die echte Mindestbelegung ab. Die weiteren
    // Einheitskanten tragen dieselben Ausgleichskosten wie assignRemaining.
    addBoundedEdge(courseStart + ci, sink, required, required, 0);
    for (let seat = 1; seat <= Math.max(0, available - required); seat += 1) {
      const resultingLoad = current + required + seat;
      const threshold = Math.max(0, Number(event.settings.balanceThreshold) || 0);
      const smallCourse = threshold > 0 && course.max <= threshold;
      let penalty = 0;
      if (event.settings.balanceWeight > 0) {
        penalty = smallCourse
          ? Math.round(event.settings.balanceWeight * Math.max(0, resultingLoad - course.max))
          : Math.round(event.settings.balanceWeight * Math.abs(resultingLoad - (targets.get(course.id) || 0)));
      }
      addBoundedEdge(courseStart + ci, sink, 0, 1, penalty);
    }
  });

  addBoundedEdge(unassignedNode, sink, 0, people.length, 0);
  addBoundedEdge(sink, source, people.length, people.length, 0);
  if (invalidBounds) throw new Error("Die Mindestbelegungen konnten im gemeinsamen Flussmodell nicht erfüllt werden.");

  let requiredFlow = 0;
  for (let node = 0; node <= sink; node += 1) {
    if (balance[node] > 0) {
      flow.addEdge(superSource, node, balance[node], 0);
      requiredFlow += balance[node];
    } else if (balance[node] < 0) {
      flow.addEdge(node, superSink, -balance[node], 0);
    }
  }

  const outcome = flow.run(superSource, superSink, requiredFlow);
  if (outcome.flow !== requiredFlow) {
    throw new Error("Die Mindestbelegungen konnten im gemeinsamen Flussmodell nicht erfüllt werden.");
  }

  for (const person of people) assignments.set(person.id, "");
  for (const edge of assignmentEdges) {
    if (edge.initialCap - edge.cap > 0) assignments.set(edge.meta.personId, edge.meta.courseId);
  }
  for (const courseId of loads.keys()) loads.set(courseId, 0);
  for (const courseId of assignments.values()) {
    if (courseId && loads.has(courseId)) loads.set(courseId, (loads.get(courseId) || 0) + 1);
  }
}

function initialAssignmentMetrics(event, openSet, courseMap, snapshot, targets) {
  let unassigned = 0;
  let preferencePenalty = 0;
  for (const person of event.participants) {
    const courseId = snapshot.assignments.get(person.id) || "";
    const course = courseId ? courseMap.get(courseId) : null;
    if (!course) {
      unassigned += 1;
      preferencePenalty += PREFERENCE_COST.unassigned;
    } else if (person.fixed !== course.id) {
      preferencePenalty += preferenceCost(person, course);
    }
  }

  const rankCounts = rankCountsFromAssignments(event, snapshot.assignments, courseMap);
  let concentrationPenalty = 0;
  for (const counts of rankCounts.values()) {
    for (let ordinal = 1; ordinal <= (counts[2] || 0); ordinal += 1) {
      concentrationPenalty += badWishMarginalPenalty(2, ordinal);
    }
    for (let ordinal = 1; ordinal <= (counts[3] || 0); ordinal += 1) {
      concentrationPenalty += badWishMarginalPenalty(3, ordinal);
    }
  }

  let minimumDeviation = 0;
  let balanceDeviation = 0;
  for (const courseId of openSet) {
    const course = courseMap.get(courseId);
    if (!course) continue;
    const load = snapshot.loads.get(courseId) || 0;
    minimumDeviation += Math.max(0, effectiveMinimum(course) - load);
    balanceDeviation += Math.abs(load - (targets.get(courseId) || 0));
  }
  return { unassigned, minimumDeviation, preferencePenalty, concentrationPenalty, balanceDeviation };
}

function initialAssignmentIsValid(event, openSet, lockSet, courseMap, snapshot) {
  const countedLoads = new Map([...courseMap.keys()].map((courseId) => [courseId, 0]));
  for (const person of event.participants) {
    const courseId = snapshot.assignments.get(person.id) || "";
    if (!courseId) {
      if (person.fixed) return false;
      continue;
    }
    const course = courseMap.get(courseId);
    if (!course || !openSet.has(courseId)) return false;
    if (!courseEligible(person, course, lockSet, event.settings.allowOutside)) return false;
    countedLoads.set(courseId, (countedLoads.get(courseId) || 0) + 1);
  }
  for (const courseId of openSet) {
    const course = courseMap.get(courseId);
    const load = countedLoads.get(courseId) || 0;
    if (!course || load > course.max || load < effectiveMinimum(course)) return false;
    if (load !== (snapshot.loads.get(courseId) || 0)) return false;
  }
  return true;
}

function compareInitialAssignmentCandidates(left, right) {
  const fields = ["unassigned", "minimumDeviation", "preferencePenalty", "concentrationPenalty", "balanceDeviation"];
  for (const field of fields) {
    if (left.metrics[field] !== right.metrics[field]) return left.metrics[field] - right.metrics[field];
  }
  return 0;
}

function assignInitialWithSafetyComparison(event, openSet, lockSet, courseMap, assignments, loads, targets) {
  const base = { assignments: new Map(assignments), loads: new Map(loads) };
  const candidates = [];
  let firstError = null;
  const attempt = (method, assign) => {
    const candidateAssignments = new Map(base.assignments);
    const candidateLoads = new Map(base.loads);
    try {
      assign(candidateAssignments, candidateLoads);
      const snapshot = { method, assignments: candidateAssignments, loads: candidateLoads };
      if (!initialAssignmentIsValid(event, openSet, lockSet, courseMap, snapshot)) {
        throw new Error(`Ungültige Erstzuteilung (${method}).`);
      }
      snapshot.metrics = initialAssignmentMetrics(event, openSet, courseMap, snapshot, targets);
      candidates.push(snapshot);
    } catch (error) {
      firstError ||= error;
    }
  };

  attempt("two-phase", (candidateAssignments, candidateLoads) => {
    assignMinimums(event, openSet, lockSet, courseMap, candidateAssignments, candidateLoads);
    assignRemaining(event, openSet, lockSet, courseMap, candidateAssignments, candidateLoads, targets);
  });
  attempt("combined", (candidateAssignments, candidateLoads) => {
    assignInitialCombined(event, openSet, lockSet, courseMap, candidateAssignments, candidateLoads, targets);
  });

  if (!candidates.length) throw firstError || new Error("Die Erstzuteilung konnte nicht berechnet werden.");
  const legacy = candidates.find((candidate) => candidate.method === "two-phase");
  const combined = candidates.find((candidate) => candidate.method === "combined");
  // Bei Gleichstand gilt das neue gemeinsame Modell als mindestens gleich gut.
  const selected = combined && (!legacy || compareInitialAssignmentCandidates(combined, legacy) <= 0)
    ? combined
    : legacy;
  restoreAssignmentSnapshot(selected, assignments, loads);
  return selected.method;
}


// Vollständige globale Neuberechnung mit unteren und oberen Schranken.
// Anders als die lokalen Reparaturschritte kann dieses Flussmodell auch
// Verschiebungsketten über beliebig viele Kurse gleichzeitig finden.
function rebuildWithGlobalGradeSearch(event, openSet, lockSet, courseMap, assignments, loads, { relaxed = false } = {}) {
  const courses = [...openSet].map((id) => courseMap.get(id)).filter(Boolean);
  const courseIndex = new Map(courses.map((course, index) => [course.id, index]));
  const ungradedKey = "__ohne_klasse__";
  const grades = [...new Set([
    ...event.participants.map((person) => parseGrade(person.className)).filter(Number.isFinite),
    ...courses.flatMap((course) => gradeLimitEntries(course).map((limit) => limit.grade)),
    ...(event.settings.classRequired ? [] : [ungradedKey]),
  ])].sort((a, b) => {
    if (a === ungradedKey) return 1;
    if (b === ungradedKey) return -1;
    return a - b;
  });
  const gradeSlots = [];
  const gradeSlotIndex = new Map();

  for (const course of courses) {
    for (const grade of grades) {
      if (grade !== ungradedKey && (grade < course.gradeFrom || grade > course.gradeTo)) continue;
      const index = gradeSlots.length;
      gradeSlots.push({ course, grade });
      gradeSlotIndex.set(`${course.id}\u0000${grade}`, index);
    }
  }

  const source = 0;
  const personStart = 1;
  const gradeStart = personStart + event.participants.length;
  const courseStart = gradeStart + gradeSlots.length;
  const unassignedNode = courseStart + courses.length;
  const sink = unassignedNode + 1;
  const superSource = sink + 1;
  const superSink = superSource + 1;
  const flow = new MinCostMaxFlow(superSink + 1);
  const balance = Array(superSink + 1).fill(0);
  const assignmentEdges = [];
  const initialUnassigned = event.participants.reduce((sum, person) => sum + (assignments.get(person.id) ? 0 : 1), 0);
  let invalidBounds = false;
  const softGradeBaseline = 10_000_000_000;
  const softGradeViolation = 1_000_000_000_000;
  const softPreference = (person, course) => {
    if (person.fixed === course.id) return 0;
    return [0, 1_000, 1_000_000, 1_000_000_000, 2_000_000_000][rankBucket(person, course)] ?? 2_000_000_000;
  };

  const addBoundedEdge = (from, to, lower, upper, cost, meta = null) => {
    const lo = Math.max(0, Math.trunc(lower));
    const hi = Math.max(0, Math.trunc(upper));
    if (lo > hi) { invalidBounds = true; return null; }
    balance[from] -= lo;
    balance[to] += lo;
    return flow.addEdge(from, to, hi - lo, cost, meta);
  };

  event.participants.forEach((person, personIndex) => {
    const personNode = personStart + personIndex;
    addBoundedEdge(source, personNode, 1, 1, 0);
    const parsedGrade = parseGrade(person.className);
    const grade = Number.isFinite(parsedGrade) ? parsedGrade : ungradedKey;

    for (const course of courses) {
      const slotIndex = gradeSlotIndex.get(`${course.id}\u0000${grade}`);
      if (slotIndex === undefined || !courseEligible(person, course, lockSet, event.settings.allowOutside)) continue;
      const stabilityCost = (assignments.get(person.id) || "") === course.id ? 0 : 1;
      const edge = addBoundedEdge(
        personNode,
        gradeStart + slotIndex,
        0,
        1,
        (relaxed ? softPreference(person, course) : preferenceCost(person, course)) + stabilityCost,
        { personId: person.id, courseId: course.id },
      );
      if (edge) assignmentEdges.push(edge);
    }

    if (!person.fixed) {
      const stabilityCost = assignments.get(person.id) ? 1 : 0;
      addBoundedEdge(
        personNode,
        unassignedNode,
        0,
        1,
        (relaxed ? softGradeViolation * 5 : PREFERENCE_COST.unassigned) + stabilityCost,
      );
    }
  });

  gradeSlots.forEach(({ course, grade }, slotIndex) => {
    const configured = grade === ungradedKey ? {} : course.gradeLimits?.[String(grade)] || {};
    const minimum = nullableCount(configured.min) ?? 0;
    const maximum = grade === ungradedKey ? course.max : courseGradeMaximum(course, grade);
    const from = gradeStart + slotIndex;
    const to = courseStart + courseIndex.get(course.id);
    if (!relaxed) {
      addBoundedEdge(from, to, minimum, maximum, 0);
      return;
    }

    const preferredSeats = Math.min(minimum, course.max);
    const regularSeats = Math.max(0, Math.min(maximum, course.max) - preferredSeats);
    const excessSeats = Math.max(0, course.max - Math.max(maximum, preferredSeats));
    if (preferredSeats) addBoundedEdge(from, to, 0, preferredSeats, 0);
    if (regularSeats) addBoundedEdge(from, to, 0, regularSeats, softGradeBaseline);
    if (excessSeats) addBoundedEdge(from, to, 0, excessSeats, softGradeBaseline + softGradeViolation);
  });

  courses.forEach((course, index) => {
    const minimum = relaxed
      ? Math.max(course.min, course.mode === "Pflicht" ? 1 : 0)
      : effectiveMinimum(course);
    addBoundedEdge(courseStart + index, sink, minimum, course.max, 0);
  });
  // Eine Jahrgangsregel darf die Zahl der Nichtzugeteilten niemals erhöhen.
  // Innerhalb dieser Obergrenze darf die globale Suche Personen austauschen und
  // bereits unzugeteilte Schüler nach Möglichkeit sogar noch unterbringen.
  addBoundedEdge(unassignedNode, sink, 0, initialUnassigned, 0);
  addBoundedEdge(sink, source, event.participants.length, event.participants.length, 0);
  if (invalidBounds) return false;

  let required = 0;
  for (let node = 0; node <= sink; node += 1) {
    if (balance[node] > 0) {
      flow.addEdge(superSource, node, balance[node], 0);
      required += balance[node];
    } else if (balance[node] < 0) {
      flow.addEdge(node, superSink, -balance[node], 0);
    }
  }

  const outcome = flow.run(superSource, superSink, required);
  if (outcome.flow !== required) return false;

  const rebuilt = new Map(event.participants.map((person) => [person.id, ""]));
  for (const edge of assignmentEdges) {
    if (edge.initialCap - edge.cap > 0) rebuilt.set(edge.meta.personId, edge.meta.courseId);
  }
  for (const person of event.participants) {
    if (person.fixed && rebuilt.get(person.id) !== person.fixed) return false;
  }

  assignments.clear();
  for (const [personId, courseId] of rebuilt) assignments.set(personId, courseId);
  for (const courseId of loads.keys()) loads.set(courseId, 0);
  for (const courseId of assignments.values()) {
    if (courseId && loads.has(courseId)) loads.set(courseId, (loads.get(courseId) || 0) + 1);
  }
  return relaxed || courseGradeLimitViolations(event, openSet, courseMap, assignments).length === 0;
}


function cohortSummaryForCourse(event, course, assignments, personMap) {
  const counts = new Map();
  for (const [personId, courseId] of assignments) {
    if (courseId !== course.id) continue;
    const person = personMap.get(personId);
    if (!person) continue;
    const key = cohortKey(person);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "de", { numeric: true }))
    .map(([key, count]) => ({ key, label: cohortLabelFromKey(key), count }));
}


function gradeCountsForPeople(people) {
  const counts = new Map();
  for (const person of people || []) {
    const grade = parseGrade(person.className);
    if (!Number.isFinite(grade)) continue;
    counts.set(grade, (counts.get(grade) || 0) + 1);
  }
  return counts;
}

function gradeLimitViolationsForPeople(course, people) {
  const counts = gradeCountsForPeople(people);
  const violations = [];
  for (const limit of gradeLimitEntries(course)) {
    const count = counts.get(limit.grade) || 0;
    if (limit.min !== null && count < limit.min) {
      violations.push({
        kind: "gradeMin", course, grade: limit.grade, count, min: limit.min, max: limit.max,
        members: (people || []).filter((person) => parseGrade(person.className) === limit.grade),
        label: `Jahrgang ${limit.grade}`,
      });
    }
    if (limit.max !== null && count > limit.max) {
      violations.push({
        kind: "gradeMax", course, grade: limit.grade, count, min: limit.min, max: limit.max,
        members: (people || []).filter((person) => parseGrade(person.className) === limit.grade),
        label: `Jahrgang ${limit.grade}`,
      });
    }
  }
  return violations;
}

function courseGradeLimitViolations(event, openSet, courseMap, assignments) {
  const byCourse = peopleByCourse(event, assignments);
  const violations = [];
  for (const courseId of openSet) {
    const course = courseMap.get(courseId);
    if (!course) continue;
    violations.push(...gradeLimitViolationsForPeople(course, byCourse.get(courseId) || []));
  }
  return violations;
}

function courseMinimumViolations(event, openSet, courseMap, assignments) {
  const byCourse = peopleByCourse(event, assignments);
  const violations = [];
  for (const courseId of openSet) {
    const course = courseMap.get(courseId);
    if (!course) continue;
    const count = (byCourse.get(courseId) || []).length;
    const min = courseMinimumGoal(course);
    if (count < min) violations.push({ kind: "courseMin", course, count, min, distance: min - count });
  }
  return violations;
}

function repairCourseGradeLimits(event, openSet, lockSet, courseMap, assignments, loads, targets) {
  const maxPasses = Math.max(80, event.workshops.length * 20);
  let globalSearchTried = false;

  if (event.settings.gradeLimitsRelaxed) {
    if (!rebuildWithGlobalGradeSearch(event, openSet, lockSet, courseMap, assignments, loads, { relaxed: true })) {
      throw new Error("Auch die bestmögliche Jahrgangsverteilung konnte mit den aktuellen Mindestbelegungen, Kapazitäten, Sperrungen und festen Setzungen nicht berechnet werden.");
    }
    return courseGradeLimitViolations(event, openSet, courseMap, assignments);
  }

  const bestSwapForViolation = (violation, byCourse) => {
    const target = violation.course;
    const targetPeople = byCourse.get(target.id) || [];
    const targetBeforeState = hardRuleStateForCourse(event, target, targetPeople);
    const insiders = (violation.kind === "gradeMax"
      ? violation.members
      : targetPeople.filter((person) => parseGrade(person.className) !== violation.grade))
      .filter((person) => !person.fixed);
    const outsiders = event.participants
      .filter((person) => !person.fixed && (assignments.get(person.id) || "") !== target.id)
      .filter((person) => violation.kind === "gradeMin"
        ? parseGrade(person.className) === violation.grade
        : parseGrade(person.className) !== violation.grade)
      .filter((person) => courseEligible(person, target, lockSet, event.settings.allowOutside));
    const candidates = [];

    for (const inside of insiders) {
      const targetWithoutInside = targetPeople.filter((person) => person.id !== inside.id);
      for (const outside of outsiders) {
        const fromId = assignments.get(outside.id) || "";
        const donor = fromId ? courseMap.get(fromId) : null;
        if (fromId && (!donor || !openSet.has(fromId) || !courseEligible(inside, donor, lockSet, event.settings.allowOutside))) continue;

        const targetAfter = [...targetWithoutInside, outside];
        const targetAfterState = hardRuleStateForCourse(event, target, targetAfter);
        if (!hardRuleStateImproves(targetBeforeState, targetAfterState)) continue;

        if (donor) {
          const donorBefore = byCourse.get(fromId) || [];
          const donorAfter = [...donorBefore.filter((person) => person.id !== outside.id), inside];
          const donorBeforeState = hardRuleStateForCourse(event, donor, donorBefore);
          const donorAfterState = hardRuleStateForCourse(event, donor, donorAfter);
          if (!hardRuleStateNoWorse(donorBeforeState, donorAfterState)) continue;
        }

        const score = assignmentPreferenceCost(inside, fromId, courseMap)
          + assignmentPreferenceCost(outside, target.id, courseMap)
          - assignmentPreferenceCost(inside, target.id, courseMap)
          - assignmentPreferenceCost(outside, fromId, courseMap);
        candidates.push({ inside, outside, fromId, score });
      }
    }

    return candidates
      .sort((a, b) => a.score - b.score
        || a.inside.id.localeCompare(b.inside.id, "de")
        || a.outside.id.localeCompare(b.outside.id, "de"))[0] || null;
  };

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const byCourse = peopleByCourse(event, assignments);
    const violations = courseGradeLimitViolations(event, openSet, courseMap, assignments);
    if (!violations.length) return;

    violations.sort((a, b) => {
      const aSeverity = a.kind === "gradeMax" ? a.count - a.max : a.min - a.count;
      const bSeverity = b.kind === "gradeMax" ? b.count - b.max : b.min - b.count;
      return bSeverity - aSeverity || a.course.id.localeCompare(b.course.id, "de") || a.grade - b.grade;
    });

    let changed = false;

    for (const violation of violations) {
      const target = violation.course;
      const targetPeople = byCourse.get(target.id) || [];

      if (violation.kind === "gradeMin") {
        const candidates = event.participants
          .filter((person) => !person.fixed && parseGrade(person.className) === violation.grade)
          .filter((person) => {
            const fromId = assignments.get(person.id) || "";
            if (fromId === target.id) return false;
            return courseEligible(person, target, lockSet, event.settings.allowOutside);
          })
          .map((person) => {
            const fromId = assignments.get(person.id) || "";
            const donor = fromId ? courseMap.get(fromId) : null;
            const donorPeople = donor ? (byCourse.get(fromId) || []) : [];
            const donorAfter = donor ? donorPeople.filter((item) => item.id !== person.id) : [];
            if (donor && donorAfter.length < effectiveMinimum(donor)) return null;
            if (donor) {
              const donorBeforeState = hardRuleStateForCourse(event, donor, donorPeople);
              const donorAfterState = hardRuleStateForCourse(event, donor, donorAfter);
              if (!hardRuleStateNoWorse(donorBeforeState, donorAfterState)) return null;
            }

            const targetAfter = [...targetPeople, person];
            if (targetAfter.length > target.max) return null;
            if (gradeCountsForPeople(targetAfter).get(violation.grade) > courseGradeMaximum(target, violation.grade)) return null;
            const targetBeforeState = hardRuleStateForCourse(event, target, targetPeople);
            const targetAfterState = hardRuleStateForCourse(event, target, targetAfter);
            if (!hardRuleStateImproves(targetBeforeState, targetAfterState)) return null;

            const currentCost = donor ? preferenceCost(person, donor) : PREFERENCE_COST.unassigned;
            const balance = Math.round(event.settings.balanceWeight * Math.abs((loads.get(target.id) || 0) + 1 - (targets.get(target.id) || 0)));
            return { person, fromId, score: preferenceCost(person, target) - currentCost + balance };
          })
          .filter(Boolean)
          .sort((a, b) => a.score - b.score || a.person.id.localeCompare(b.person.id, "de"));

        const chosen = candidates[0];
        if (chosen) {
          if (chosen.fromId) loads.set(chosen.fromId, (loads.get(chosen.fromId) || 0) - 1);
          assignments.set(chosen.person.id, target.id);
          loads.set(target.id, (loads.get(target.id) || 0) + 1);
          changed = true;
          break;
        }

        const swap = bestSwapForViolation(violation, byCourse);
        if (!swap) continue;
        assignments.set(swap.inside.id, swap.fromId);
        assignments.set(swap.outside.id, target.id);
        changed = true;
        break;
      }

      if (violation.kind === "gradeMax") {
        const movable = violation.members
          .filter((person) => !person.fixed)
          .map((person) => {
            const targetAfter = targetPeople.filter((item) => item.id !== person.id);
            if (targetAfter.length < effectiveMinimum(target)) return null;
            const targetBeforeState = hardRuleStateForCourse(event, target, targetPeople);
            const targetAfterState = hardRuleStateForCourse(event, target, targetAfter);
            if (!hardRuleStateImproves(targetBeforeState, targetAfterState)) return null;

            const destinations = [...openSet]
              .map((id) => courseMap.get(id))
              .filter((course) => course && course.id !== target.id)
              .filter((course) => (loads.get(course.id) || 0) < course.max)
              .filter((course) => courseEligible(person, course, lockSet, event.settings.allowOutside))
              .map((course) => {
                const existing = byCourse.get(course.id) || [];
                const after = [...existing, person];
                const grade = parseGrade(person.className);
                if ((gradeCountsForPeople(after).get(grade) || 0) > courseGradeMaximum(course, grade)) return null;
                const beforeState = hardRuleStateForCourse(event, course, existing);
                const afterState = hardRuleStateForCourse(event, course, after);
                if (!hardRuleStateNoWorse(beforeState, afterState)) return null;
                const balance = Math.round(event.settings.balanceWeight * Math.abs((loads.get(course.id) || 0) + 1 - (targets.get(course.id) || 0)));
                return { course, score: preferenceCost(person, course) - preferenceCost(person, target) + balance };
              })
              .filter(Boolean)
              .sort((a, b) => a.score - b.score || a.course.id.localeCompare(b.course.id, "de"));

            return destinations.length ? { person, toId: destinations[0].course.id, score: destinations[0].score } : null;
          })
          .filter(Boolean)
          .sort((a, b) => a.score - b.score || a.person.id.localeCompare(b.person.id, "de"));

        const chosen = movable[0];
        if (chosen) {
          assignments.set(chosen.person.id, chosen.toId);
          loads.set(target.id, (loads.get(target.id) || 0) - 1);
          if (chosen.toId) loads.set(chosen.toId, (loads.get(chosen.toId) || 0) + 1);
          changed = true;
          break;
        }

        const swap = bestSwapForViolation(violation, byCourse);
        if (swap) {
          assignments.set(swap.inside.id, swap.fromId);
          assignments.set(swap.outside.id, target.id);
          changed = true;
          break;
        }

        // Eine Jahrgangsgrenze darf keinen Schüler aus einer ansonsten zulässigen
        // Zuteilung herausdrängen. Wenn weder Verschieben noch Tauschen gelingt,
        // übernimmt die globale Suche unten die bestmögliche Annäherung.
        continue;
      }
    }

    if (!changed) {
      if (!globalSearchTried) {
        globalSearchTried = true;
        if (rebuildWithGlobalGradeSearch(event, openSet, lockSet, courseMap, assignments, loads)) continue;
        if (rebuildWithGlobalGradeSearch(event, openSet, lockSet, courseMap, assignments, loads, { relaxed: true })) {
          const remaining = courseGradeLimitViolations(event, openSet, courseMap, assignments);
          if (!remaining.length) continue;
          event.settings.gradeLimitsRelaxed = true;
          return remaining;
        }
      }
      const first = violations[0];
      if (first.kind === "gradeMin") {
        throw new Error(`${first.course.name}${first.course.session ? ` – Gruppe ${first.course.session}` : ""}: Jahrgang ${first.grade} benötigt mindestens ${first.min} Schüler, aktuell sind ${first.count} möglich. Diese harte Jahrgangs-Mindestbelegung kann mit den aktuellen Wünschen, Kapazitäten, Sperrungen und festen Setzungen nicht erfüllt werden.`);
      }
      throw new Error(`${first.course.name}${first.course.session ? ` – Gruppe ${first.course.session}` : ""}: Jahrgang ${first.grade} darf höchstens ${first.max} Schüler enthalten, aktuell sind es ${first.count}. Diese harte Jahrgangs-Maximalbelegung kann mit den aktuellen Vorgaben nicht erfüllt werden.`);
    }
  }

  const remaining = courseGradeLimitViolations(event, openSet, courseMap, assignments);
  if (remaining.length) {
    const first = remaining[0];
    throw new Error(`${first.course.name}: Jahrgangsbelegung konnte nach mehreren Reparaturschritten nicht stabil erfüllt werden.`);
  }
}


function flexibleRuleGroupKey(rule, person) {
  const grade = parseGrade(person.className);
  if (rule.type === "class") return String(person.className || "").trim();
  if (rule.type === "grade") return String(grade);
  if (rule.type === "gradeForm") return `${grade}\u0000${person.schoolForm}`;
  if (rule.type === "gradeAnyForm") return String(grade);
  return "";
}

function flexibleRuleGroupLabel(rule, key) {
  if (rule.type === "class") return `Klasse ${key}`;
  if (rule.type === "grade") return `Jahrgang ${key}`;
  if (rule.type === "gradeForm") {
    const [grade, form] = String(key).split("\u0000");
    return `Jahrgang ${grade} / ${form}`;
  }
  if (rule.type === "gradeAnyForm") return `Jahrgang ${key} (mindestens ein Bildungsgang)`;
  return String(key);
}

function ruleTypeLabel(type) {
  return ({
    class: "Klasse",
    grade: "Jahrgang",
    gradeForm: "Jahrgang + Bildungsgang",
    gradeAnyForm: "Jahrgang: mindestens ein Bildungsgang",
  })[type] || type;
}

function peopleByCourse(event, assignments) {
  const personMap = new Map(event.participants.map((person) => [person.id, person]));
  const map = new Map(event.workshops.map((course) => [course.id, []]));
  for (const [personId, courseId] of assignments) {
    if (!courseId || !map.has(courseId)) continue;
    const person = personMap.get(personId);
    if (person) map.get(courseId).push(person);
  }
  return map;
}

function effectiveGradeFormConstraints(event, course) {
  let hardMin = effectiveCohortMinimum(event, course);
  let preferredMin = 0;
  for (const rule of event.settings.rules || []) {
    if (!rule.enabled || rule.type !== "gradeForm") continue;
    if (rule.mode === "hard") hardMin = Math.max(hardMin, rule.min);
    else preferredMin = Math.max(preferredMin, rule.min);
  }
  return {
    hardMin,
    // Ein weicheres Ziel unterhalb einer bereits strengeren harten Vorgabe ist
    // vollständig abgedeckt und wird deshalb weder erneut repariert noch gemeldet.
    preferredMin: preferredMin > hardMin ? preferredMin : 0,
  };
}

function gradeFormConstraintViolationsForPeople(event, course, people, mode = null) {
  const constraints = effectiveGradeFormConstraints(event, course);
  if (!constraints.hardMin && !constraints.preferredMin) return [];

  const groups = new Map();
  for (const person of people || []) {
    const key = cohortKey(person);
    if (!key || key.startsWith("NaN\u0000")) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(person);
  }

  const violations = [];
  for (const [key, members] of groups) {
    const count = members.length;
    let violationMode = "";
    let min = 0;
    if (constraints.hardMin && count < constraints.hardMin) {
      violationMode = "hard";
      min = constraints.hardMin;
    } else if (constraints.preferredMin && count < constraints.preferredMin) {
      violationMode = "preferred";
      min = constraints.preferredMin;
    }
    if (!violationMode || (mode && mode !== violationMode)) continue;
    const rule = {
      id: `__gradeForm_${violationMode}`,
      type: "gradeForm",
      min,
      mode: violationMode,
      enabled: true,
    };
    violations.push({
      kind: "gradeForm",
      rule,
      course,
      key,
      cohortKey: key,
      members,
      count,
      min,
      label: cohortLabelFromKey(key),
    });
  }
  return violations;
}

function gradeFormConstraintViolations(event, openSet, courseMap, assignments, mode = null) {
  const byCourse = peopleByCourse(event, assignments);
  const violations = [];
  for (const courseId of openSet) {
    const course = courseMap.get(courseId);
    if (!course) continue;
    violations.push(...gradeFormConstraintViolationsForPeople(event, course, byCourse.get(courseId) || [], mode));
  }
  return violations;
}

function violationsForFlexibleRule(rule, course, people) {
  if (!rule.enabled || !people.length) return [];
  const groups = new Map();
  for (const person of people) {
    const key = flexibleRuleGroupKey(rule, person);
    if (!key || key === "NaN") continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(person);
  }
  const violations = [];
  if (rule.type !== "gradeAnyForm") {
    for (const [key, members] of groups) {
      if (members.length > 0 && members.length < rule.min) {
        violations.push({ rule, course, key, members, count: members.length, min: rule.min, label: flexibleRuleGroupLabel(rule, key) });
      }
    }
    return violations;
  }

  for (const [gradeKey, members] of groups) {
    const byForm = new Map();
    for (const person of members) {
      if (!byForm.has(person.schoolForm)) byForm.set(person.schoolForm, []);
      byForm.get(person.schoolForm).push(person);
    }
    const formEntries = [...byForm.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "de"));
    const best = formEntries[0];
    const bestCount = best?.[1]?.length || 0;
    if (members.length > 0 && bestCount < rule.min) {
      violations.push({
        rule, course, key: gradeKey, members, count: bestCount, total: members.length, min: rule.min,
        preferredForm: best?.[0] || "", label: flexibleRuleGroupLabel(rule, gradeKey),
      });
    }
  }
  return violations;
}

function flexibleRuleViolations(event, openSet, courseMap, assignments, mode = null) {
  const byCourse = peopleByCourse(event, assignments);
  const violations = [];
  const rules = (event.settings.rules || [])
    .filter((rule) => rule.enabled && rule.type !== "gradeForm" && (!mode || rule.mode === mode));
  for (const courseId of openSet) {
    const course = courseMap.get(courseId);
    if (!course) continue;
    for (const rule of rules) violations.push(...violationsForFlexibleRule(rule, course, byCourse.get(courseId) || []));
  }
  return violations;
}

function hardRuleStateForCourse(event, course, people) {
  const violations = [];
  for (const rule of (event.settings.rules || []).filter((r) => r.enabled && r.mode === "hard" && r.type !== "gradeForm")) {
    violations.push(...violationsForFlexibleRule(rule, course, people));
  }
  if (!event.settings.gradeLimitsRelaxed) violations.push(...gradeLimitViolationsForPeople(course, people));
  violations.push(...gradeFormConstraintViolationsForPeople(event, course, people, "hard"));

  const totalMinDeficit = Math.max(0, effectiveMinimum(course) - people.length);
  const totalMaxExcess = Math.max(0, people.length - course.max);
  const deficit = violations.reduce((sum, violation) => {
    if (violation.kind === "gradeMax") return sum + Math.max(1, violation.count - violation.max);
    return sum + Math.max(1, (violation.min ?? 0) - violation.count);
  }, 0) + totalMinDeficit + totalMaxExcess;

  return {
    count: violations.length + (totalMinDeficit ? 1 : 0) + (totalMaxExcess ? 1 : 0),
    deficit,
  };
}

function hardRuleStateCompare(a, b) {
  if (a.count !== b.count) return a.count - b.count;
  return a.deficit - b.deficit;
}

function hardRuleStateNoWorse(before, after) {
  return hardRuleStateCompare(after, before) <= 0;
}

function hardRuleStateImproves(before, after) {
  return hardRuleStateCompare(after, before) < 0;
}

function moveWouldKeepCourseHardRules(event, course, people) {
  if (people.length < effectiveMinimum(course)) return false;
  return hardRuleStateForCourse(event, course, people).count === 0;
}

function flexibleCandidateMatches(violation, person) {
  const rule = violation.rule;
  if (rule.type === "gradeAnyForm") {
    if (String(parseGrade(person.className)) !== violation.key) return false;
    return !violation.preferredForm || person.schoolForm === violation.preferredForm;
  }
  return flexibleRuleGroupKey(rule, person) === violation.key;
}

function repairFlexibleRules(event, openSet, lockSet, courseMap, assignments, loads, targets, mode = "hard", violationProvider = flexibleRuleViolations) {
  const maxPasses = Math.max(40, event.workshops.length * 10);
  const preferredBudget = 100_000; // deutlich kleiner als der Sprung Erst- -> Zweitwunsch

  const violationStillPresent = (violation, people) => violationsForFlexibleRule(violation.rule, violation.course, people)
    .some((item) => item.key === violation.key);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const violations = violationProvider(event, openSet, courseMap, assignments, mode);
    if (!violations.length) return [];
    violations.sort((a, b) => (a.min - a.count) - (b.min - b.count) || a.course.id.localeCompare(b.course.id, "de"));
    let changed = false;

    for (const violation of violations) {
      const target = violation.course;
      const targetLoad = loads.get(target.id) || 0;
      const byCourse = peopleByCourse(event, assignments);

      // 1) Die zu kleine Gruppe verstärken. Bei harten Regeln dürfen andere bereits
      // vorhandene harte Verletzungen im Zielkurs die Reparatur nicht blockieren.
      // Entscheidend ist, dass jeder Schritt die harte Gesamtsituation verbessert und
      // im abgebenden Kurs nichts verschlechtert.
      if (targetLoad < target.max) {
        const candidates = event.participants
          .filter((person) => !person.fixed && flexibleCandidateMatches(violation, person))
          .filter((person) => {
            const fromId = assignments.get(person.id) || "";
            if (!fromId || fromId === target.id) return false;
            if (!courseEligible(person, target, lockSet, event.settings.allowOutside)) return false;
            return Boolean(courseMap.get(fromId));
          })
          .map((person) => {
            const fromId = assignments.get(person.id) || "";
            const donor = courseMap.get(fromId);
            const preferenceDelta = preferenceCost(person, target) - preferenceCost(person, donor);
            const balanceDelta = Math.round(event.settings.balanceWeight * (
              Math.abs(targetLoad + 1 - (targets.get(target.id) || 0)) - Math.abs(targetLoad - (targets.get(target.id) || 0))
            ));
            return { person, fromId, score: preferenceDelta + balanceDelta };
          })
          .sort((a, b) => a.score - b.score || a.person.id.localeCompare(b.person.id, "de"));

        const tempByCourse = new Map([...byCourse.entries()].map(([id, people]) => [id, [...people]]));
        const tempLoads = new Map(loads);
        const selected = [];

        for (const candidate of candidates) {
          if ((tempLoads.get(target.id) || 0) >= target.max) break;
          if (mode === "preferred" && candidate.score > preferredBudget) continue;

          const donor = courseMap.get(candidate.fromId);
          const donorBefore = tempByCourse.get(candidate.fromId) || [];
          const donorAfter = donorBefore.filter((person) => person.id !== candidate.person.id);
          if (donorAfter.length < effectiveMinimum(donor)) continue;

          const targetBefore = tempByCourse.get(target.id) || [];
          const targetAfter = [...targetBefore, candidate.person];

          if (mode === "hard") {
            const donorBeforeState = hardRuleStateForCourse(event, donor, donorBefore);
            const donorAfterState = hardRuleStateForCourse(event, donor, donorAfter);
            const targetBeforeState = hardRuleStateForCourse(event, target, targetBefore);
            const targetAfterState = hardRuleStateForCourse(event, target, targetAfter);
            if (!hardRuleStateNoWorse(donorBeforeState, donorAfterState)) continue;
            if (!hardRuleStateImproves(targetBeforeState, targetAfterState)) continue;
          } else {
            if (!moveWouldKeepCourseHardRules(event, donor, donorAfter)) continue;
            if (!moveWouldKeepCourseHardRules(event, target, targetAfter)) continue;
          }

          selected.push(candidate);
          tempByCourse.set(candidate.fromId, donorAfter);
          tempByCourse.set(target.id, targetAfter);
          tempLoads.set(candidate.fromId, (tempLoads.get(candidate.fromId) || 0) - 1);
          tempLoads.set(target.id, (tempLoads.get(target.id) || 0) + 1);

          if (!violationStillPresent(violation, targetAfter)) break;
        }

        const targetAfterPlan = tempByCourse.get(target.id) || [];
        if (selected.length && !violationStillPresent(violation, targetAfterPlan)) {
          for (const candidate of selected) {
            assignments.set(candidate.person.id, target.id);
            loads.set(candidate.fromId, (loads.get(candidate.fromId) || 0) - 1);
            loads.set(target.id, (loads.get(target.id) || 0) + 1);
          }
          changed = true;
          break;
        }
      }

      // 2) Falls Verstärken nicht geht, die zu kleine Gruppe vollständig aus dem Kurs
      // entfernen. Die Zielkurse dürfen durch diese Reparatur keine harten Regeln
      // verschlechtern. Die Zielgruppe im ursprünglichen Kurs wird als Ganzes bewertet,
      // damit eine 0-oder-mindestens-N-Regel nicht an einem Zwischenstand scheitert.
      const members = violation.members.filter((person) => !person.fixed);
      if (members.length === violation.members.length && (loads.get(target.id) || 0) - members.length >= effectiveMinimum(target)) {
        const targetBeforePeople = byCourse.get(target.id) || [];
        const targetFinalPeople = targetBeforePeople.filter((person) => !violation.members.some((member) => member.id === person.id));
        const targetBeforeState = hardRuleStateForCourse(event, target, targetBeforePeople);
        const targetFinalState = hardRuleStateForCourse(event, target, targetFinalPeople);
        const targetHardOkay = mode === "hard"
          ? hardRuleStateImproves(targetBeforeState, targetFinalState)
          : moveWouldKeepCourseHardRules(event, target, targetFinalPeople);

        if (targetHardOkay) {
          const planned = [];
          const tempLoads = new Map(loads);
          const tempByCourse = new Map([...byCourse.entries()].map(([id, people]) => [id, [...people]]));
          tempByCourse.set(target.id, [...targetFinalPeople]);
          tempLoads.set(target.id, (tempLoads.get(target.id) || 0) - members.length);
          let feasible = true;

          for (const person of members) {
            const destinations = [...openSet]
              .map((id) => courseMap.get(id))
              .filter((course) => course && course.id !== target.id)
              .filter((course) => (tempLoads.get(course.id) || 0) < course.max)
              .filter((course) => courseEligible(person, course, lockSet, event.settings.allowOutside))
              .map((course) => {
                const existing = tempByCourse.get(course.id) || [];
                const after = [...existing, person];
                const prefDelta = preferenceCost(person, course) - preferenceCost(person, target);
                const beforeState = hardRuleStateForCourse(event, course, existing);
                const afterState = hardRuleStateForCourse(event, course, after);
                const hardValid = mode === "hard"
                  ? hardRuleStateNoWorse(beforeState, afterState)
                  : moveWouldKeepCourseHardRules(event, course, after);
                return { course, hardValid, prefDelta };
              })
              .filter((item) => item.hardValid)
              .sort((a, b) => a.prefDelta - b.prefDelta || a.course.id.localeCompare(b.course.id, "de"));

            const chosen = destinations[0];
            if (!chosen || (mode === "preferred" && chosen.prefDelta > preferredBudget)) { feasible = false; break; }
            planned.push({ person, toId: chosen.course.id });
            tempLoads.set(chosen.course.id, (tempLoads.get(chosen.course.id) || 0) + 1);
            tempByCourse.set(chosen.course.id, [...(tempByCourse.get(chosen.course.id) || []), person]);
          }

          if (feasible) {
            for (const move of planned) {
              assignments.set(move.person.id, move.toId);
              loads.set(move.toId, (loads.get(move.toId) || 0) + 1);
            }
            loads.set(target.id, (loads.get(target.id) || 0) - members.length);
            changed = true;
            break;
          }
        }
      }
    }

    if (!changed) {
      // Auch eine als verbindlich markierte Zusammensetzungsregel darf nicht dazu
      // führen, dass eine ansonsten mögliche Gesamtlösung verworfen wird.
      return violations;
    }
  }

  const remaining = violationProvider(event, openSet, courseMap, assignments, mode);
  return remaining;
}

function repairGradeFormConstraints(event, openSet, lockSet, courseMap, assignments, loads, targets, mode = "hard") {
  return repairFlexibleRules(
    event,
    openSet,
    lockSet,
    courseMap,
    assignments,
    loads,
    targets,
    mode,
    gradeFormConstraintViolations,
  );
}

function summarizeFlexibleRules(event, openSet, courseMap, assignments) {
  const hard = flexibleRuleViolations(event, openSet, courseMap, assignments, "hard");
  const preferred = flexibleRuleViolations(event, openSet, courseMap, assignments, "preferred");
  return { hard, preferred };
}

function summarizeGradeFormConstraints(event, openSet, courseMap, assignments) {
  const hard = gradeFormConstraintViolations(event, openSet, courseMap, assignments, "hard");
  const preferred = gradeFormConstraintViolations(event, openSet, courseMap, assignments, "preferred");
  return { hard, preferred };
}

function buildGradeGroupRepairContext(event, openSet, lockSet, courseMap) {
  const openCourses = [...openSet].map((id) => courseMap.get(id)).filter(Boolean);
  const gradeByPersonId = new Map();
  const groupKeyByPersonId = new Map();
  const cohortKeyByPersonId = new Map();
  const eligibleCourseIdsByPersonId = new Map();
  const preferenceCostsByPersonId = new Map();
  const hashTokensByPersonId = new Map();
  const movablePeople = [];
  const movableByGroup = new Map(GRADE_GROUPS.map((group) => [group.key, []]));

  for (const person of event.participants) {
    const grade = parseGrade(person.className);
    const groupKey = gradeGroupForGrade(grade)?.key || "";
    gradeByPersonId.set(person.id, grade);
    groupKeyByPersonId.set(person.id, groupKey);
    cohortKeyByPersonId.set(person.id, `${grade}\u0000${person.schoolForm}`);

    const eligibleCourseIds = new Set();
    const preferenceCosts = new Map([["", PREFERENCE_COST.unassigned]]);
    const hashTokens = new Map();
    for (const courseId of ["", ...openSet]) {
      hashTokens.set(courseId, {
        hashA: gradeGroupHashToken(person.id, courseId, "A"),
        hashB: gradeGroupHashToken(person.id, courseId, "B"),
      });
    }
    for (const course of openCourses) {
      if (courseEligible(person, course, lockSet, event.settings.allowOutside)) eligibleCourseIds.add(course.id);
      preferenceCosts.set(course.id, preferenceCost(person, course));
    }
    eligibleCourseIdsByPersonId.set(person.id, eligibleCourseIds);
    preferenceCostsByPersonId.set(person.id, preferenceCosts);
    hashTokensByPersonId.set(person.id, hashTokens);

    if (!person.fixed) {
      movablePeople.push(person);
      if (groupKey && movableByGroup.has(groupKey)) movableByGroup.get(groupKey).push(person);
    }
  }

  return {
    openCourses,
    gradeByPersonId,
    groupKeyByPersonId,
    cohortKeyByPersonId,
    eligibleCourseIdsByPersonId,
    preferenceCostsByPersonId,
    hashTokensByPersonId,
    movablePeople,
    movableByGroup,
    gradeLimitsByCourseId: new Map(openCourses.map((course) => [course.id, gradeLimitEntries(course)])),
    gradeFormHardMinimumByCourseId: new Map(openCourses.map((course) => [course.id, effectiveGradeFormConstraints(event, course).hardMin])),
    hardRules: (event.settings.rules || []).filter((item) => item.enabled && item.mode === "hard" && item.type !== "gradeForm"),
  };
}

function gradeGroupContextEligible(context, person, courseId) {
  return context.eligibleCourseIdsByPersonId.get(person.id)?.has(courseId) === true;
}

function nonGradeGroupHardValidForCourse(event, course, people, context = null) {
  if (!course) return true;
  if (people.length < effectiveMinimum(course) || people.length > course.max) return false;

  const gradeLimits = context?.gradeLimitsByCourseId.get(course.id) || gradeLimitEntries(course);
  if (!event.settings.gradeLimitsRelaxed && gradeLimits.length) {
    const gradeCounts = new Map();
    for (const person of people) {
      const grade = context?.gradeByPersonId.get(person.id) ?? parseGrade(person.className);
      if (Number.isFinite(grade)) gradeCounts.set(grade, (gradeCounts.get(grade) || 0) + 1);
    }
    for (const limit of gradeLimits) {
      const count = gradeCounts.get(limit.grade) || 0;
      if (limit.min !== null && count < limit.min) return false;
      if (limit.max !== null && count > limit.max) return false;
    }
  }

  const gradeFormMinimum = context?.gradeFormHardMinimumByCourseId.get(course.id)
    ?? effectiveGradeFormConstraints(event, course).hardMin;
  if (gradeFormMinimum) {
    const cohortCounts = new Map();
    for (const person of people) {
      const key = context?.cohortKeyByPersonId.get(person.id) || cohortKey(person);
      cohortCounts.set(key, (cohortCounts.get(key) || 0) + 1);
    }
    if ([...cohortCounts.values()].some((count) => count > 0 && count < gradeFormMinimum)) return false;
  }

  const hardRules = context?.hardRules || (event.settings.rules || []).filter((item) => item.enabled && item.mode === "hard");
  for (const rule of hardRules) {
    if (violationsForFlexibleRule(rule, course, people).length) return false;
  }
  return true;
}

function gradeGroupCourseMetrics(course, people, context = null) {
  if (!course?.gradeGroupRule?.enabled) return { violations: [], distance: 0, imbalance: 0 };
  if (!context) {
    const violations = gradeGroupViolationsForPeople(course, people);
    return {
      violations,
      distance: violations.reduce((sum, item) => sum + item.distance, 0),
      imbalance: gradeGroupImbalanceForPeople(course, people),
    };
  }

  const counts = new Map(GRADE_GROUPS.map((group) => [group.key, 0]));
  for (const person of people || []) {
    const groupKey = context.groupKeyByPersonId.get(person.id);
    if (counts.has(groupKey)) counts.set(groupKey, (counts.get(groupKey) || 0) + 1);
  }
  const summary = GRADE_GROUPS.map((group) => {
    const count = counts.get(group.key) || 0;
    return {
      key: group.key,
      label: group.label,
      count,
      groupSize: GRADE_GROUP_SIZE,
      remainder: count % GRADE_GROUP_SIZE,
    };
  });
  const violations = summary
    .filter((item) => item.remainder !== 0)
    .map((item) => ({
      kind: "debateModulo",
      course,
      ...item,
      distance: Math.min(item.remainder, GRADE_GROUP_SIZE - item.remainder),
    }));
  return {
    counts,
    violations,
    distance: violations.reduce((sum, item) => sum + item.distance, 0),
    imbalance: course.gradeGroupRule.balance ? Math.abs(summary[0].count - summary[1].count) : 0,
  };
}

function gradeGroupAssignmentState(event, openSet, courseMap, assignments, context = null, loads = null) {
  const byCourse = peopleByCourse(event, assignments);
  const violations = [];
  const courseMetrics = new Map();
  let distance = 0;
  let imbalance = 0;
  for (const courseId of openSet) {
    const course = courseMap.get(courseId);
    if (!course?.gradeGroupRule?.enabled) continue;
    const metrics = gradeGroupCourseMetrics(course, byCourse.get(courseId) || [], context);
    courseMetrics.set(courseId, metrics);
    violations.push(...metrics.violations);
    distance += metrics.distance;
    imbalance += metrics.imbalance;
  }
  const unassigned = event.participants.reduce((sum, person) => sum + (assignments.get(person.id) ? 0 : 1), 0);
  const stateLoads = loads
    ? new Map(loads)
    : new Map([...openSet].map((courseId) => [courseId, (byCourse.get(courseId) || []).length]));
  return { byCourse, loads: stateLoads, courseMetrics, violations, distance, imbalance, unassigned };
}

function assignmentPreferenceCost(person, courseId, courseMap) {
  if (!courseId) return PREFERENCE_COST.unassigned;
  const course = courseMap.get(courseId);
  return course ? preferenceCost(person, course) : PREFERENCE_COST.unassigned;
}

function gradeGroupAssignedCourse(state, personId) {
  return state.assignmentChanges.has(personId)
    ? state.assignmentChanges.get(personId) || ""
    : state.assignmentBase.get(personId) || "";
}

function gradeGroupHashToken(personId, courseId, salt) {
  return deterministicHash(`${salt}\u0000${personId}\u0000${courseId || ""}`);
}

function gradeGroupHashTokenForContext(context, personId, courseId, salt) {
  const cached = context?.hashTokensByPersonId.get(personId)?.get(courseId || "");
  if (cached) return salt === "A" ? cached.hashA : cached.hashB;
  return gradeGroupHashToken(personId, courseId, salt);
}

function gradeGroupInitialHash(event, assignments, context = null) {
  let hashA = 0;
  let hashB = 0;
  for (const person of event.participants) {
    const courseId = assignments.get(person.id) || "";
    hashA = (hashA ^ gradeGroupHashTokenForContext(context, person.id, courseId, "A")) >>> 0;
    hashB = (hashB ^ gradeGroupHashTokenForContext(context, person.id, courseId, "B")) >>> 0;
  }
  return { hashA, hashB };
}

function gradeGroupStateHashKey(state) {
  return `${state.hashA}:${state.hashB}`;
}

function gradeGroupStatesEqual(event, left, right) {
  return event.participants.every((person) => gradeGroupAssignedCourse(left, person.id) === gradeGroupAssignedCourse(right, person.id));
}

function gradeGroupSeenAtLowerCost(event, seen, state) {
  const key = gradeGroupStateHashKey(state);
  const bucket = seen.get(key) || [];
  const existing = bucket.find((entry) => gradeGroupStatesEqual(event, entry.state, state));
  if (existing) {
    if (existing.cost <= state.cost) return true;
    existing.cost = state.cost;
    existing.state = state;
    return false;
  }
  bucket.push({ cost: state.cost, state });
  seen.set(key, bucket);
  return false;
}

function gradeGroupCandidateState(event, openSet, courseMap, baseState, changes, preferenceDelta, context = null) {
  const assignmentChanges = new Map(baseState.assignmentChanges);
  const nextByCourse = new Map(baseState.byCourse);
  const nextLoads = new Map(baseState.loads);
  const affected = new Set();
  const clonedCourses = new Set();
  let hashA = baseState.hashA;
  let hashB = baseState.hashB;
  let unassigned = baseState.unassigned;

  const mutablePeople = (courseId) => {
    if (!clonedCourses.has(courseId)) {
      nextByCourse.set(courseId, [...(nextByCourse.get(courseId) || [])]);
      clonedCourses.add(courseId);
    }
    return nextByCourse.get(courseId);
  };

  for (const { person, toId } of changes) {
    const fromId = assignmentChanges.has(person.id)
      ? assignmentChanges.get(person.id) || ""
      : baseState.assignmentBase.get(person.id) || "";
    if (fromId === toId) continue;
    if (fromId) affected.add(fromId);
    if (toId) affected.add(toId);
    if (fromId) {
      const people = mutablePeople(fromId);
      const index = people.findIndex((item) => item.id === person.id);
      if (index >= 0) people.splice(index, 1);
      nextLoads.set(fromId, (nextLoads.get(fromId) || 0) - 1);
    }
    if (toId) {
      mutablePeople(toId).push(person);
      nextLoads.set(toId, (nextLoads.get(toId) || 0) + 1);
    }

    const originalId = baseState.assignmentBase.get(person.id) || "";
    if (toId === originalId) assignmentChanges.delete(person.id);
    else assignmentChanges.set(person.id, toId);
    if (!fromId && toId) unassigned -= 1;
    else if (fromId && !toId) unassigned += 1;
    hashA = (hashA ^ gradeGroupHashTokenForContext(context, person.id, fromId, "A") ^ gradeGroupHashTokenForContext(context, person.id, toId, "A")) >>> 0;
    hashB = (hashB ^ gradeGroupHashTokenForContext(context, person.id, fromId, "B") ^ gradeGroupHashTokenForContext(context, person.id, toId, "B")) >>> 0;
  }

  const courseMetrics = new Map(baseState.courseMetrics);
  let violations = baseState.violations.filter((violation) => !affected.has(violation.course.id));
  let distance = baseState.distance;
  let imbalance = baseState.imbalance;
  for (const courseId of affected) {
    const course = courseMap.get(courseId);
    const people = nextByCourse.get(courseId) || [];
    if (!nonGradeGroupHardValidForCourse(event, course, people, context)) return null;
    const before = courseMetrics.get(courseId) || { violations: [], distance: 0, imbalance: 0 };
    const after = gradeGroupCourseMetrics(course, people, context);
    distance += after.distance - before.distance;
    imbalance += after.imbalance - before.imbalance;
    violations = [...violations, ...after.violations];
    if (course?.gradeGroupRule?.enabled) courseMetrics.set(courseId, after);
    else courseMetrics.delete(courseId);
  }

  return {
    assignmentBase: baseState.assignmentBase,
    assignmentChanges,
    hashA,
    hashB,
    cost: baseState.cost + preferenceDelta,
    byCourse: nextByCourse,
    loads: nextLoads,
    courseMetrics,
    violations,
    distance,
    imbalance,
    unassigned,
  };
}

function gradeGroupMoveDelta(person, fromId, toId, courseMap, context = null) {
  if (context) {
    const costs = context.preferenceCostsByPersonId.get(person.id);
    const fromCost = costs?.get(fromId || "") ?? assignmentPreferenceCost(person, fromId, courseMap);
    const toCost = costs?.get(toId || "") ?? assignmentPreferenceCost(person, toId, courseMap);
    return toCost - fromCost;
  }
  return assignmentPreferenceCost(person, toId, courseMap) - assignmentPreferenceCost(person, fromId, courseMap);
}

function gradeGroupActionsForState(event, openSet, lockSet, courseMap, state, context) {
  const plans = [];
  const loads = state.loads;
  const openCourses = context.openCourses;
  const focusedViolations = [...state.violations]
    .sort((a, b) => b.distance - a.distance || a.course.id.localeCompare(b.course.id, "de") || a.key.localeCompare(b.key, "de"));

  for (const violation of focusedViolations) {
    const target = violation.course;
    const groupKey = violation.key;
    const targetPeople = state.byCourse.get(target.id) || [];
    const targetMetrics = state.courseMetrics.get(target.id) || gradeGroupCourseMetrics(target, targetPeople, context);
    const targetCounts = targetMetrics.counts;
    const targetDistance = targetMetrics.distance;
    const sekICount = targetCounts.get("sekI") || 0;
    const sekIICount = targetCounts.get("sekII") || 0;
    const localDistanceAfter = (outGroup, inGroup) => {
      const afterSekI = Math.max(0, sekICount - (outGroup === "sekI" ? 1 : 0)) + (inGroup === "sekI" ? 1 : 0);
      const afterSekII = Math.max(0, sekIICount - (outGroup === "sekII" ? 1 : 0)) + (inGroup === "sekII" ? 1 : 0);
      const sekIRemainder = afterSekI % GRADE_GROUP_SIZE;
      const sekIIRemainder = afterSekII % GRADE_GROUP_SIZE;
      return Math.min(sekIRemainder, GRADE_GROUP_SIZE - sekIRemainder)
        + Math.min(sekIIRemainder, GRADE_GROUP_SIZE - sekIIRemainder);
    };
    const members = targetPeople
      .filter((person) => !person.fixed && context.groupKeyByPersonId.get(person.id) === groupKey)
      .sort((a, b) => a.id.localeCompare(b.id, "de"));

    // Einzelne Person aus der zu reparierenden Jahrgangsgruppe in einen anderen
    // zulässigen Kurs verschieben. Ein Ziel ohne Kurs wird bewusst nicht erzeugt:
    // Teilbarkeit darf keine bestehende Zuteilung entfernen.
    for (const person of members.slice(0, 36)) {
      const destinations = openCourses
        .filter((course) => course.id !== target.id)
        .filter((course) => (loads.get(course.id) || 0) < course.max)
        .filter((course) => gradeGroupContextEligible(context, person, course.id))
        .map((course) => ({
          toId: course.id,
          delta: gradeGroupMoveDelta(person, target.id, course.id, courseMap, context),
        }))
        .sort((a, b) => a.delta - b.delta || a.toId.localeCompare(b.toId, "de"))
        .slice(0, 4);
      for (const destination of destinations) {
        plans.push({
          changes: [{ person, toId: destination.toId }],
          delta: destination.delta,
          estimatedDelta: localDistanceAfter(groupKey, null) - targetDistance,
        });
      }
    }

    // Passende Person aus einem anderen Kurs in die zu reparierende Gruppe holen.
    if ((loads.get(target.id) || 0) < target.max) {
      const outsiders = (context.movableByGroup.get(groupKey) || [])
        .filter((person) => gradeGroupAssignedCourse(state, person.id) !== target.id)
        .filter((person) => gradeGroupContextEligible(context, person, target.id))
        .map((person) => {
          const fromId = gradeGroupAssignedCourse(state, person.id);
          return { person, fromId, delta: gradeGroupMoveDelta(person, fromId, target.id, courseMap, context) };
        })
        .sort((a, b) => a.delta - b.delta || a.person.id.localeCompare(b.person.id, "de"))
        .slice(0, 48);

      for (const item of outsiders) {
        plans.push({
          changes: [{ person: item.person, toId: target.id }],
          delta: item.delta,
          estimatedDelta: localDistanceAfter(null, groupKey) - targetDistance,
        });
      }
    }

    // Bei voller bzw. exakt belegter Durchführung kann ein Tausch beide
    // Jahrgangsgruppen in einem atomaren Schritt korrigieren.
    const swapInsiders = targetPeople.filter((person) => !person.fixed).slice(0, 28);
    const swapOutsiders = context.movablePeople
      .filter((person) => gradeGroupAssignedCourse(state, person.id) !== target.id)
      .filter((person) => gradeGroupContextEligible(context, person, target.id))
      .map((person) => {
        const fromId = gradeGroupAssignedCourse(state, person.id);
        return { person, fromId, deltaToTarget: gradeGroupMoveDelta(person, fromId, target.id, courseMap, context) };
      })
      .sort((a, b) => a.deltaToTarget - b.deltaToTarget || a.person.id.localeCompare(b.person.id, "de"))
      .slice(0, 36);

    for (const inside of swapInsiders) {
      const insideGroup = context.groupKeyByPersonId.get(inside.id) || "other";
      for (const outside of swapOutsiders) {
        const outsideGroup = context.groupKeyByPersonId.get(outside.person.id) || "other";
        if (insideGroup === outsideGroup) continue;
        const estimatedDelta = localDistanceAfter(insideGroup, outsideGroup) - targetDistance;
        if (estimatedDelta >= 0) continue;
        if (outside.fromId) {
          const donor = courseMap.get(outside.fromId);
          if (!donor || !gradeGroupContextEligible(context, inside, donor.id)) continue;
        }
        const delta = gradeGroupMoveDelta(inside, target.id, outside.fromId, courseMap, context)
          + gradeGroupMoveDelta(outside.person, outside.fromId, target.id, courseMap, context);
        plans.push({
          changes: [
            { person: inside, toId: outside.fromId },
            { person: outside.person, toId: target.id },
          ],
          delta,
          estimatedDelta,
        });
      }
    }
  }

  const actions = [];
  const orderedPlans = plans.sort((a, b) => a.estimatedDelta - b.estimatedDelta || a.delta - b.delta).slice(0, 260);
  for (const plan of orderedPlans) {
    const candidate = gradeGroupCandidateState(event, openSet, courseMap, state, plan.changes, plan.delta, context);
    if (!candidate || candidate.distance > state.distance + 1) continue;
    actions.push(candidate);
    if (actions.length >= 80) break;
  }
  return actions.sort(compareGradeGroupStates);
}

function compareGradeGroupStates(a, b) {
  return a.unassigned - b.unassigned
    || a.violations.length - b.violations.length
    || a.distance - b.distance
    || a.cost - b.cost
    || a.imbalance - b.imbalance;
}

function repairGradeGroups(event, openSet, lockSet, courseMap, assignments, loads) {
  const enabled = [...openSet].some((courseId) => courseMap.get(courseId)?.gradeGroupRule?.enabled);
  if (!enabled) return;

  const context = buildGradeGroupRepairContext(event, openSet, lockSet, courseMap);
  const initialAnalysis = gradeGroupAssignmentState(event, openSet, courseMap, assignments, context, loads);
  if (!initialAnalysis.violations.length) return;

  const assignmentBase = new Map(assignments);
  const initial = {
    assignmentBase,
    assignmentChanges: new Map(),
    cost: 0,
    ...gradeGroupInitialHash(event, assignmentBase, context),
    ...initialAnalysis,
  };
  const maxDepth = Math.min(18, Math.max(6, initial.violations.length * 3 + initial.distance * 2));
  const beamWidth = 40;
  let frontier = [initial];
  const seen = new Map();
  gradeGroupSeenAtLowerCost(event, seen, initial);
  let solution = null;
  let bestFallback = initial;

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const bestAtDepth = [...frontier].sort(compareGradeGroupStates)[0];
    if (bestAtDepth && compareGradeGroupStates(bestAtDepth, bestFallback) < 0) bestFallback = bestAtDepth;
    const complete = frontier
      .filter((state) => state.distance === 0)
      .sort(compareGradeGroupStates)[0];
    if (complete) { solution = complete; break; }
    if (depth === maxDepth) break;

    const next = [];
    for (const state of frontier) {
      for (const candidate of gradeGroupActionsForState(event, openSet, lockSet, courseMap, state, context)) {
        if (gradeGroupSeenAtLowerCost(event, seen, candidate)) continue;
        next.push(candidate);
      }
    }
    frontier = next
      .sort(compareGradeGroupStates)
      .slice(0, beamWidth);
    if (!frontier.length) break;
  }

  // Ist keine exakte Teilbarkeit erreichbar, wird die beste gefundene vollständige
  // Zuteilung übernommen und später mit einem konkreten Hinweis ausgegeben.
  solution ||= bestFallback;

  assignments.clear();
  for (const person of event.participants) assignments.set(person.id, gradeGroupAssignedCourse(solution, person.id));
  for (const courseId of loads.keys()) loads.set(courseId, 0);
  for (const courseId of assignments.values()) if (courseId && loads.has(courseId)) loads.set(courseId, (loads.get(courseId) || 0) + 1);
}

const TRADEOFF_WISH_COST = Object.freeze([0, 1, 5, 15, 30]);

function assignmentWishMetrics(event, courseMap, assignments) {
  let penalty = 0;
  let unassigned = 0;
  for (const person of event.participants) {
    const courseId = assignments.get(person.id) || "";
    const course = courseId ? courseMap.get(courseId) : null;
    if (!course) {
      unassigned += 1;
      continue;
    }
    if (person.fixed === course.id) continue;
    penalty += TRADEOFF_WISH_COST[rankBucket(person, course)] ?? TRADEOFF_WISH_COST[4];
  }
  return { wishPenalty: penalty, unassigned };
}

function distributionRuleMetrics(event, openSet, courseMap, assignments) {
  const groupedPeople = peopleByCourse(event, assignments);
  const minimumViolations = courseMinimumViolations(event, openSet, courseMap, assignments);
  const gradeViolations = courseGradeLimitViolations(event, openSet, courseMap, assignments);
  const groupState = gradeGroupAssignmentState(event, openSet, courseMap, assignments);
  const gradeForm = summarizeGradeFormConstraints(event, openSet, courseMap, assignments);
  const flexible = summarizeFlexibleRules(event, openSet, courseMap, assignments);
  const hardGradeFormDeviation = gradeForm.hard.reduce((sum, violation) => sum + Math.max(1, violation.min - violation.count), 0);
  const preferredGradeFormDeviation = gradeForm.preferred.reduce((sum, violation) => sum + Math.max(1, violation.min - violation.count), 0);
  const hardFlexibleDeviation = flexible.hard.reduce((sum, violation) => sum + Math.max(1, violation.min - violation.count), 0);
  const preferredFlexibleDeviation = flexible.preferred.reduce((sum, violation) => sum + Math.max(1, violation.min - violation.count), 0);
  const gradeDeviation = gradeViolations.reduce((sum, violation) => sum + (
    violation.kind === "gradeMax" ? violation.count - violation.max : violation.min - violation.count
  ), 0);
  const imbalance = [...openSet].reduce((sum, courseId) => {
    const course = courseMap.get(courseId);
    if (!course) return sum;
    return sum + gradeGroupImbalanceForPeople(course, groupedPeople.get(courseId) || []);
  }, 0);
  const hardViolationCount = gradeViolations.length + groupState.violations.length + gradeForm.hard.length + flexible.hard.length;
  const preferredViolationCount = gradeForm.preferred.length + flexible.preferred.length;
  const hardDeviation = gradeDeviation + groupState.distance + hardGradeFormDeviation + hardFlexibleDeviation;
  const preferredDeviation = preferredGradeFormDeviation + preferredFlexibleDeviation + imbalance;
  const courseMinimumDeviation = minimumViolations.reduce((sum, violation) => sum + violation.distance, 0);

  return {
    courseMinimumViolationCount: minimumViolations.length,
    courseMinimumDeviation,
    hardViolationCount,
    preferredViolationCount,
    hardDeviation,
    preferredDeviation,
    // Innerhalb der Regel-Seite zählen „Vorrangig“ und konkrete
    // Jahrgangsgrenzen stärker als bevorzugte Verteilungsziele.
    rulePenalty: hardViolationCount * 6 + hardDeviation * 4 + preferredViolationCount * 2 + preferredDeviation,
  };
}

// Lokaler Anteil derselben Regelbewertung, die distributionRuleMetrics für die
// gesamte Verteilung verwendet. Da sämtliche Zusammensetzungsregeln
// kursbezogen sind, kann die Globalsuche damit die Wirkung einer möglichen
// Zuordnung auf Abgabe- und Zielkurs gemeinsam abschätzen.
function courseDistributionMetrics(event, course, people) {
  const minimumDeviation = Math.max(0, courseMinimumGoal(course) - people.length);
  const gradeViolations = gradeLimitViolationsForPeople(course, people);
  const gradeDeviation = gradeViolations.reduce((sum, violation) => sum + (
    violation.kind === "gradeMax" ? violation.count - violation.max : violation.min - violation.count
  ), 0);
  const groupMetrics = gradeGroupCourseMetrics(course, people);
  const gradeFormHard = gradeFormConstraintViolationsForPeople(event, course, people, "hard");
  const gradeFormPreferred = gradeFormConstraintViolationsForPeople(event, course, people, "preferred");
  const flexibleHard = [];
  const flexiblePreferred = [];
  for (const rule of (event.settings.rules || []).filter((item) => item.enabled && item.type !== "gradeForm")) {
    const target = rule.mode === "hard" ? flexibleHard : flexiblePreferred;
    target.push(...violationsForFlexibleRule(rule, course, people));
  }

  const hardGradeFormDeviation = gradeFormHard.reduce((sum, violation) => sum + Math.max(1, violation.min - violation.count), 0);
  const preferredGradeFormDeviation = gradeFormPreferred.reduce((sum, violation) => sum + Math.max(1, violation.min - violation.count), 0);
  const hardFlexibleDeviation = flexibleHard.reduce((sum, violation) => sum + Math.max(1, violation.min - violation.count), 0);
  const preferredFlexibleDeviation = flexiblePreferred.reduce((sum, violation) => sum + Math.max(1, violation.min - violation.count), 0);
  const hardViolationCount = gradeViolations.length + groupMetrics.violations.length + gradeFormHard.length + flexibleHard.length;
  const preferredViolationCount = gradeFormPreferred.length + flexiblePreferred.length;
  const hardDeviation = gradeDeviation + groupMetrics.distance + hardGradeFormDeviation + hardFlexibleDeviation;
  const preferredDeviation = preferredGradeFormDeviation + preferredFlexibleDeviation + groupMetrics.imbalance;

  return {
    minimumDeviation,
    rulePenalty: hardViolationCount * 6 + hardDeviation * 4 + preferredViolationCount * 2 + preferredDeviation,
  };
}

// Eine vollständige globale Neuberechnung mit regelbewussten Kantenkosten.
// Jede mögliche Person-Kurs-Zuordnung erhält neben ihrer Wunschqualität den
// gemeinsamen marginalen Effekt auf alle Jahrgangs-, Kohorten-, Gruppen- und
// flexiblen Regeln. Untere Kursgrenzen, Kapazitäten, feste Setzungen,
// Sperrungen und Zugangsbedingungen bleiben direkt im Flussnetz verankert.
function rebuildWithGlobalRuleSearch(event, openSet, lockSet, courseMap, assignments, loads, targets, explorationRound = 0) {
  const courses = [...openSet].map((courseId) => courseMap.get(courseId)).filter(Boolean);
  const movablePeople = event.participants.filter((person) => !person.fixed);
  if (!movablePeople.length || !courses.length) return false;

  const currentByCourse = peopleByCourse(event, assignments);
  const baseMetrics = new Map(courses.map((course) => [
    course.id,
    courseDistributionMetrics(event, course, currentByCourse.get(course.id) || []),
  ]));
  const removalMetrics = new Map();
  for (const person of movablePeople) {
    const fromId = assignments.get(person.id) || "";
    if (!fromId || !courseMap.has(fromId)) continue;
    const course = courseMap.get(fromId);
    const after = (currentByCourse.get(fromId) || []).filter((item) => item.id !== person.id);
    removalMetrics.set(person.id, courseDistributionMetrics(event, course, after));
  }

  const ruleWeight = Math.max(0, Math.min(100, Number(event.settings.gradePreferenceWeight) || 0));
  const wishScale = (100 - ruleWeight) * 100;
  const ruleScale = ruleWeight * 100;
  // Im regulären Lauf erzwingt die untere Flussgrenze das Kursminimum bereits
  // exakt. Eine zusätzliche personenbezogene Mindeststrafe würde koordinierte
  // Ketten blockieren (eine Person verlässt einen Kurs, während eine andere ihn
  // im selben Flusszug wieder auffüllt). Nur im ausdrücklichen
  // Bestmöglich-Fallback bleibt das Mindestziel als weiche Leitplanke aktiv.
  const minimumScale = event.settings.courseMinimumsRelaxed ? 100_000_000 : 0;
  const unassignedCost = 5_000_000_000_000;
  const fixed = fixedLoads(event, courseMap);
  const currentUnassigned = movablePeople.reduce((sum, person) => sum + (assignments.get(person.id) ? 0 : 1), 0);

  const source = 0;
  const personStart = 1;
  const courseStart = personStart + movablePeople.length;
  const unassignedNode = courseStart + courses.length;
  const sink = unassignedNode + 1;
  const superSource = sink + 1;
  const superSink = superSource + 1;
  const flow = new MinCostMaxFlow(superSink + 1);
  const balance = Array(superSink + 1).fill(0);
  const assignmentEdges = [];
  let invalidBounds = false;

  const addBoundedEdge = (from, to, lower, upper, cost, meta = null) => {
    const lo = Math.max(0, Math.trunc(lower));
    const hi = Math.max(0, Math.trunc(upper));
    if (lo > hi) {
      invalidBounds = true;
      return null;
    }
    balance[from] -= lo;
    balance[to] += lo;
    return flow.addEdge(from, to, hi - lo, cost, meta);
  };

  movablePeople.forEach((person, personIndex) => {
    const personNode = personStart + personIndex;
    addBoundedEdge(source, personNode, 1, 1, 0);
    const fromId = assignments.get(person.id) || "";
    const fromBase = fromId ? baseMetrics.get(fromId) : null;
    const fromAfter = fromId ? removalMetrics.get(person.id) : null;
    const choices = [];

    courses.forEach((course, courseIndex) => {
      if (!courseEligible(person, course, lockSet, event.settings.allowOutside)) return;
      let minimumDelta = 0;
      let ruleDelta = 0;
      if (course.id !== fromId) {
        if (fromBase && fromAfter) {
          minimumDelta += fromAfter.minimumDeviation - fromBase.minimumDeviation;
          ruleDelta += fromAfter.rulePenalty - fromBase.rulePenalty;
        }
        const targetBase = baseMetrics.get(course.id);
        const targetAfter = courseDistributionMetrics(
          event,
          course,
          [...(currentByCourse.get(course.id) || []), person],
        );
        minimumDelta += targetAfter.minimumDeviation - targetBase.minimumDeviation;
        ruleDelta += targetAfter.rulePenalty - targetBase.rulePenalty;
      }
      const wishPenalty = TRADEOFF_WISH_COST[rankBucket(person, course)] ?? TRADEOFF_WISH_COST[4];
      // Ein winziger Explorationsbonus öffnet koordinierte Ketten: Verbessert
      // ein Zug die Regeln deutlich, darf der im selben Fluss nötige neutrale
      // Auffüllzug den Gesamtzug nicht allein wegen zweier Stabilitätspunkte
      // blockieren. Gegenüber Wunsch- und Regelkosten ist dieser Wert
      // verschwindend klein; die echte Snapshot-Bewertung bleibt maßgeblich.
      const stability = course.id === fromId ? 0 : 10;
      const explorationBonus = ruleDelta < 0 ? -50 : 0;
      const tieBreaker = course.id === fromId
        ? 0
        : deterministicHash(`${explorationRound}\u0000${person.id}\u0000${course.id}`) % 10;
      choices.push({
        course,
        courseIndex,
        rawCost: minimumDelta * minimumScale + ruleDelta * ruleScale + wishPenalty * wishScale + stability + explorationBonus + tieBreaker,
      });
    });

    let unassignedRuleDelta = 0;
    let unassignedMinimumDelta = 0;
    if (fromBase && fromAfter) {
      unassignedMinimumDelta = fromAfter.minimumDeviation - fromBase.minimumDeviation;
      unassignedRuleDelta = fromAfter.rulePenalty - fromBase.rulePenalty;
    }
    const unassignedRawCost = unassignedCost
      + unassignedMinimumDelta * minimumScale
      + unassignedRuleDelta * ruleScale
      + (fromId ? 1 : 0);
    const minimumRawCost = Math.min(unassignedRawCost, ...choices.map((choice) => choice.rawCost));

    for (const choice of choices) {
      const edge = addBoundedEdge(
        personNode,
        courseStart + choice.courseIndex,
        0,
        1,
        Math.max(0, Math.round(choice.rawCost - minimumRawCost)),
        { personId: person.id, courseId: choice.course.id },
      );
      if (edge) assignmentEdges.push(edge);
    }
    addBoundedEdge(
      personNode,
      unassignedNode,
      0,
      1,
      Math.max(0, Math.round(unassignedRawCost - minimumRawCost)),
    );
  });

  courses.forEach((course, courseIndex) => {
    const fixedLoad = fixed.get(course.id) || 0;
    const available = Math.max(0, course.max - fixedLoad);
    const required = Math.max(0, effectiveMinimum(course) - fixedLoad);
    if (required > available) invalidBounds = true;
    addBoundedEdge(courseStart + courseIndex, sink, required, required, 0);
    for (let seat = 1; seat <= Math.max(0, available - required); seat += 1) {
      const resultingLoad = fixedLoad + required + seat;
      const target = targets.get(course.id) || 0;
      const penalty = Math.round(Math.max(0, Number(event.settings.balanceWeight) || 0) * Math.abs(resultingLoad - target));
      addBoundedEdge(courseStart + courseIndex, sink, 0, 1, penalty);
    }
  });
  addBoundedEdge(unassignedNode, sink, 0, currentUnassigned, 0);
  addBoundedEdge(sink, source, movablePeople.length, movablePeople.length, 0);
  if (invalidBounds) return false;

  let requiredFlow = 0;
  for (let node = 0; node <= sink; node += 1) {
    if (balance[node] > 0) {
      flow.addEdge(superSource, node, balance[node], 0);
      requiredFlow += balance[node];
    } else if (balance[node] < 0) {
      flow.addEdge(node, superSink, -balance[node], 0);
    }
  }
  const outcome = flow.run(superSource, superSink, requiredFlow);
  if (outcome.flow !== requiredFlow) return false;

  const rebuiltAssignments = new Map(event.participants.map((person) => [person.id, person.fixed || ""]));
  for (const edge of assignmentEdges) {
    if (edge.initialCap - edge.cap > 0) rebuiltAssignments.set(edge.meta.personId, edge.meta.courseId);
  }
  const rebuiltLoads = new Map([...courseMap.keys()].map((courseId) => [courseId, 0]));
  for (const courseId of rebuiltAssignments.values()) {
    if (courseId && rebuiltLoads.has(courseId)) rebuiltLoads.set(courseId, (rebuiltLoads.get(courseId) || 0) + 1);
  }
  const snapshot = { assignments: rebuiltAssignments, loads: rebuiltLoads };
  if (!initialAssignmentIsValid(event, openSet, lockSet, courseMap, snapshot)) return false;
  restoreAssignmentSnapshot(snapshot, assignments, loads);
  return true;
}

function globalNeighborhoodState(event, openSet, courseMap, snapshot) {
  const byCourse = peopleByCourse(event, snapshot.assignments);
  const localMetrics = new Map();
  let minimumDeviation = 0;
  let rulePenalty = 0;
  for (const courseId of openSet) {
    const course = courseMap.get(courseId);
    if (!course) continue;
    const metrics = courseDistributionMetrics(event, course, byCourse.get(courseId) || []);
    localMetrics.set(courseId, metrics);
    minimumDeviation += metrics.minimumDeviation;
    rulePenalty += metrics.rulePenalty;
  }
  return {
    assignmentBase: new Map(snapshot.assignments),
    assignmentChanges: new Map(),
    byCourse,
    localMetrics,
    minimumDeviation,
    rulePenalty,
    wishPenalty: assignmentWishMetrics(event, courseMap, snapshot.assignments).wishPenalty,
    depth: 0,
  };
}

function globalNeighborhoodCourseId(state, personId) {
  return state.assignmentChanges.has(personId)
    ? state.assignmentChanges.get(personId) || ""
    : state.assignmentBase.get(personId) || "";
}

function globalNeighborhoodKey(state) {
  return [...state.assignmentChanges.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "de", { numeric: true }))
    .map(([personId, courseId]) => `${personId}\u0000${courseId}`)
    .join("\u0001");
}

function globalNeighborhoodScore(state, weight) {
  // Ein vorübergehend leerer Mindestplatz erhält ungefähr das Gewicht einer
  // typischen harten Regelabweichung. Dadurch darf die Suche einen Kurs in
  // einem Zwischenzustand leeren, wenn der nächste Mehrkurs-Schritt ihn wieder
  // sinnvoll auffüllt. Als Endergebnis bleiben Kursmindestziele unverändert
  // vorrangig.
  const temporaryMinimumPenalty = state.minimumDeviation * 10;
  return weight * (state.rulePenalty + temporaryMinimumPenalty)
    + (100 - weight) * state.wishPenalty;
}

function compareGlobalNeighborhoodStates(left, right, weight) {
  const score = globalNeighborhoodScore(left, weight) - globalNeighborhoodScore(right, weight);
  if (score) return score;
  return left.minimumDeviation - right.minimumDeviation
    || left.rulePenalty - right.rulePenalty
    || left.wishPenalty - right.wishPenalty
    || left.depth - right.depth
    || globalNeighborhoodKey(left).localeCompare(globalNeighborhoodKey(right), "de");
}

function applyGlobalNeighborhoodAction(event, openSet, lockSet, courseMap, state, moves) {
  const affected = new Set();
  const normalizedMoves = [];
  for (const move of moves) {
    const fromId = globalNeighborhoodCourseId(state, move.person.id);
    const toId = move.toId || "";
    if (!fromId || !toId || fromId === toId) return null;
    const target = courseMap.get(toId);
    if (!target || !openSet.has(toId) || move.person.fixed) return null;
    if (!courseEligible(move.person, target, lockSet, event.settings.allowOutside)) return null;
    affected.add(fromId);
    affected.add(toId);
    normalizedMoves.push({ person: move.person, fromId, toId });
  }

  const byCourse = new Map(state.byCourse);
  for (const courseId of affected) byCourse.set(courseId, [...(state.byCourse.get(courseId) || [])]);
  for (const move of normalizedMoves) {
    const people = byCourse.get(move.fromId) || [];
    const index = people.findIndex((person) => person.id === move.person.id);
    if (index < 0) return null;
    people.splice(index, 1);
  }
  for (const move of normalizedMoves) byCourse.get(move.toId).push(move.person);
  for (const courseId of affected) {
    const course = courseMap.get(courseId);
    if (!course || (byCourse.get(courseId) || []).length > course.max) return null;
  }

  const localMetrics = new Map(state.localMetrics);
  let minimumDeviation = state.minimumDeviation;
  let rulePenalty = state.rulePenalty;
  for (const courseId of affected) {
    const before = state.localMetrics.get(courseId) || { minimumDeviation: 0, rulePenalty: 0 };
    const after = courseDistributionMetrics(event, courseMap.get(courseId), byCourse.get(courseId) || []);
    localMetrics.set(courseId, after);
    minimumDeviation += after.minimumDeviation - before.minimumDeviation;
    rulePenalty += after.rulePenalty - before.rulePenalty;
  }

  const assignmentChanges = new Map(state.assignmentChanges);
  let wishPenalty = state.wishPenalty;
  for (const move of normalizedMoves) {
    const fromCourse = courseMap.get(move.fromId);
    const toCourse = courseMap.get(move.toId);
    wishPenalty -= TRADEOFF_WISH_COST[rankBucket(move.person, fromCourse)] ?? TRADEOFF_WISH_COST[4];
    wishPenalty += TRADEOFF_WISH_COST[rankBucket(move.person, toCourse)] ?? TRADEOFF_WISH_COST[4];
    if ((state.assignmentBase.get(move.person.id) || "") === move.toId) assignmentChanges.delete(move.person.id);
    else assignmentChanges.set(move.person.id, move.toId);
  }

  return {
    assignmentBase: state.assignmentBase,
    assignmentChanges,
    byCourse,
    localMetrics,
    minimumDeviation,
    rulePenalty,
    wishPenalty,
    depth: state.depth + 1,
  };
}

function globalNeighborhoodActions(event, openSet, lockSet, courseMap, state) {
  const violationMembers = new Map();
  const targetCourseIds = new Set();
  const addViolation = (violation) => {
    targetCourseIds.add(violation.course.id);
    for (const person of violation.members || []) if (!person.fixed) violationMembers.set(person.id, person);
  };

  for (const courseId of openSet) {
    const course = courseMap.get(courseId);
    const people = state.byCourse.get(courseId) || [];
    if (!course) continue;
    if (people.length < courseMinimumGoal(course)) targetCourseIds.add(courseId);
    for (const violation of gradeLimitViolationsForPeople(course, people)) addViolation(violation);
    for (const violation of gradeGroupViolationsForPeople(course, people)) addViolation(violation);
    for (const violation of gradeFormConstraintViolationsForPeople(event, course, people)) addViolation(violation);
    for (const rule of (event.settings.rules || []).filter((item) => item.enabled && item.type !== "gradeForm")) {
      for (const violation of violationsForFlexibleRule(rule, course, people)) addViolation(violation);
    }
  }

  const openCourses = [...openSet].map((courseId) => courseMap.get(courseId)).filter(Boolean);
  const actions = new Map();
  const addSingle = (person, toId) => {
    const fromId = globalNeighborhoodCourseId(state, person.id);
    if (!fromId || fromId === toId) return;
    const target = courseMap.get(toId);
    if (!target || !courseEligible(person, target, lockSet, event.settings.allowOutside)) return;
    const key = `${person.id}>${toId}`;
    if (!actions.has(key)) actions.set(key, [{ person, toId }]);
  };

  // Mitglieder verletzter Gruppen dürfen jeden eigenen zulässigen Kurs als
  // Ziel prüfen. Das deckt sowohl Verstärken als auch vollständiges Entfernen
  // einer zu kleinen Gruppe ab.
  for (const person of violationMembers.values()) {
    for (const course of openCourses) addSingle(person, course.id);
  }

  // Kurse mit einer Regel- oder Mindestabweichung erhalten zusätzlich die
  // jeweils günstigsten potenziellen Verstärkungen aus allen anderen Kursen.
  for (const targetId of targetCourseIds) {
    const target = courseMap.get(targetId);
    if (!target) continue;
    const candidates = event.participants
      .filter((person) => !person.fixed && globalNeighborhoodCourseId(state, person.id) !== targetId)
      .filter((person) => courseEligible(person, target, lockSet, event.settings.allowOutside))
      .map((person) => {
        const from = courseMap.get(globalNeighborhoodCourseId(state, person.id));
        const delta = (TRADEOFF_WISH_COST[rankBucket(person, target)] ?? TRADEOFF_WISH_COST[4])
          - (TRADEOFF_WISH_COST[rankBucket(person, from)] ?? TRADEOFF_WISH_COST[4]);
        return { person, delta };
      })
      .sort((a, b) => a.delta - b.delta || a.person.id.localeCompare(b.person.id, "de", { numeric: true }))
      .slice(0, 30);
    for (const candidate of candidates) addSingle(candidate.person, targetId);
  }

  // Ist ein Zielkurs voll, wird derselbe globale Schritt auch als echter
  // Platztausch angeboten. Die Suche darf anschließend weitere Kurse in den
  // Folgetiefen koordinieren.
  for (const [key, moves] of [...actions.entries()]) {
    const move = moves[0];
    const targetPeople = state.byCourse.get(move.toId) || [];
    const target = courseMap.get(move.toId);
    if (!target || targetPeople.length < target.max) continue;
    const fromId = globalNeighborhoodCourseId(state, move.person.id);
    const donor = courseMap.get(fromId);
    if (!donor) continue;
    for (const other of targetPeople.filter((person) => !person.fixed).slice(0, 30)) {
      if (!courseEligible(other, donor, lockSet, event.settings.allowOutside)) continue;
      actions.set(`${key}|${other.id}>${fromId}`, [move, { person: other, toId: fromId }]);
    }
  }

  return [...actions.values()].slice(0, 250);
}

function materializeGlobalNeighborhoodSnapshot(event, courseMap, state, label) {
  const assignments = new Map(state.assignmentBase);
  for (const [personId, courseId] of state.assignmentChanges) assignments.set(personId, courseId);
  const loads = new Map(event.workshops.map((course) => [course.id, 0]));
  for (const courseId of assignments.values()) {
    if (courseId && courseMap.has(courseId)) loads.set(courseId, (loads.get(courseId) || 0) + 1);
  }
  return { label, assignments, loads };
}

function searchGlobalRuleNeighborhood(event, openSet, lockSet, courseMap, seedSnapshot) {
  const weight = Math.max(0, Math.min(100, Number(event.settings.gradePreferenceWeight) || 0));
  const beamWidth = event.settings.qualityMode === "fast" ? 8 : event.settings.qualityMode === "thorough" ? 20 : 12;
  const maxDepth = event.settings.qualityMode === "fast" ? 4 : event.settings.qualityMode === "thorough" ? 6 : 5;
  const initial = globalNeighborhoodState(event, openSet, courseMap, seedSnapshot);
  const initialActions = globalNeighborhoodActions(event, openSet, lockSet, courseMap, initial);
  // Sehr breite Regelbilder werden bereits vom globalen Kostenfluss und der
  // spezialisierten Reparaturkette bearbeitet. Die Tiefensuche ist für die
  // kleinen, gekoppelten Restkonflikte gedacht; bei hunderten gleichzeitigen
  // Aktionsmöglichkeiten würde sie nur redundante Rechenzeit erzeugen.
  if (initialActions.length > 180) return [];
  let frontier = [initial];
  const seen = new Set([globalNeighborhoodKey(initial)]);
  const snapshots = [];

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const next = [];
    for (const state of frontier) {
      const actions = depth === 1 && state === initial
        ? initialActions
        : globalNeighborhoodActions(event, openSet, lockSet, courseMap, state);
      for (const action of actions) {
        const candidate = applyGlobalNeighborhoodAction(event, openSet, lockSet, courseMap, state, action);
        if (!candidate) continue;
        const key = globalNeighborhoodKey(candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(candidate);
      }
    }
    if (!next.length) break;
    next.sort((a, b) => compareGlobalNeighborhoodStates(a, b, weight));
    frontier = next.slice(0, beamWidth);
    for (const state of frontier) {
      if (state.minimumDeviation !== 0) continue;
      snapshots.push(materializeGlobalNeighborhoodSnapshot(event, courseMap, state, `Globale Regelkoordination ${depth}`));
    }
    if (frontier.some((state) => state.minimumDeviation === 0 && state.rulePenalty === 0)) break;
  }
  return snapshots;
}

function restoreAssignmentSnapshot(snapshot, assignments, loads) {
  assignments.clear();
  for (const [personId, courseId] of snapshot.assignments) assignments.set(personId, courseId);
  for (const courseId of loads.keys()) loads.set(courseId, snapshot.loads.get(courseId) || 0);
}

function distributionStateFingerprint(event, assignments) {
  const assignmentsKey = event.participants
    .map((person) => `${person.id}\u0000${assignments.get(person.id) || ""}`)
    .join("\u0001");
  const relaxedCourses = event.workshops
    .filter((course) => course._courseMinimumsRelaxed)
    .map((course) => course.id)
    .sort((a, b) => a.localeCompare(b, "de"))
    .join("\u0001");
  return `${event.settings.gradeLimitsRelaxed ? "1" : "0"}\u0002${relaxedCourses}\u0002${assignmentsKey}`;
}

function selectDistributionSnapshot(event, openSet, courseMap, snapshots) {
  const weight = Math.max(0, Math.min(100, Number(event.settings.gradePreferenceWeight) || 0));
  const analyzed = snapshots.map((snapshot, index) => ({
    ...snapshot,
    index,
    ...assignmentWishMetrics(event, courseMap, snapshot.assignments),
    ...distributionRuleMetrics(event, openSet, courseMap, snapshot.assignments),
  }));
  const minimumUnassigned = Math.min(...analyzed.map((snapshot) => snapshot.unassigned));
  const completeFirst = analyzed.filter((snapshot) => snapshot.unassigned === minimumUnassigned);
  const minimumCourseDeficit = Math.min(...completeFirst.map((snapshot) => snapshot.courseMinimumDeviation));
  const minimumFirst = completeFirst.filter((snapshot) => snapshot.courseMinimumDeviation === minimumCourseDeficit);
  const wishes = minimumFirst.map((snapshot) => snapshot.wishPenalty);
  const rules = minimumFirst.map((snapshot) => snapshot.rulePenalty);
  const minWish = Math.min(...wishes);
  const maxWish = Math.max(...wishes);
  const minRule = Math.min(...rules);
  const maxRule = Math.max(...rules);
  const normalized = (value, min, max) => max === min ? 0 : (value - min) / (max - min);

  return minimumFirst.sort((a, b) => {
    const aScore = (100 - weight) * normalized(a.wishPenalty, minWish, maxWish)
      + weight * normalized(a.rulePenalty, minRule, maxRule);
    const bScore = (100 - weight) * normalized(b.wishPenalty, minWish, maxWish)
      + weight * normalized(b.rulePenalty, minRule, maxRule);
    if (aScore !== bScore) return aScore - bScore;
    if (weight >= 50) {
      return a.rulePenalty - b.rulePenalty || a.wishPenalty - b.wishPenalty || b.index - a.index;
    }
    return a.wishPenalty - b.wishPenalty || a.rulePenalty - b.rulePenalty || a.index - b.index;
  })[0];
}

function optimizeEventSingle(raw) {
  const { event, errors, warnings } = validateEvent(raw);
  if (errors.length) return { ok: false, errors, warnings };

  try {
    const courseMap = new Map(event.workshops.map((course) => [course.id, course]));
    const personMap = new Map(event.participants.map((person) => [person.id, person]));
    const lockSet = new Set(event.locks.filter((l) => l.personId && l.workshopId).map((l) => `${l.personId}\u0000${l.workshopId}`));
    const openSet = determineOpenCourses(event, lockSet, courseMap);
    const assignments = new Map();
    const loads = new Map(event.workshops.map((course) => [course.id, 0]));

    for (const person of event.participants) {
      if (person.fixed) {
        assignments.set(person.id, person.fixed);
        loads.set(person.fixed, (loads.get(person.fixed) || 0) + 1);
      }
    }

    const fixed = fixedLoads(event, courseMap);
    const targets = calculateTargets(event, openSet, courseMap, fixed);
    const initialAssignmentMethod = assignInitialWithSafetyComparison(
      event,
      openSet,
      lockSet,
      courseMap,
      assignments,
      loads,
      targets,
    );
    const distributionSnapshots = [];
    const keepDistributionSnapshot = (label) => distributionSnapshots.push({
      label,
      assignments: new Map(assignments),
      loads: new Map(loads),
    });
    const runDistributionStage = (label, repair) => {
      const before = { assignments: new Map(assignments), loads: new Map(loads) };
      const beforeFingerprint = distributionStateFingerprint(event, assignments);
      try {
        repair();
        keepDistributionSnapshot(label);
        return distributionStateFingerprint(event, assignments) !== beforeFingerprint;
      } catch {
        // Zusammensetzungsregeln sind bestmögliche Ziele. Scheitert ein
        // Reparaturschritt, bleibt die letzte vollständige zulässige Verteilung
        // als Kandidat erhalten; die Abweichung wird später konkret ausgewiesen.
        restoreAssignmentSnapshot(before, assignments, loads);
        return false;
      }
    };

    keepDistributionSnapshot("Wünsche");
    const distributionStages = [
      ["Jahrgang + Bildungsgang", () => repairGradeFormConstraints(event, openSet, lockSet, courseMap, assignments, loads, targets, "hard")],
      ["Jahrgangsgrenzen", () => repairCourseGradeLimits(event, openSet, lockSet, courseMap, assignments, loads, targets)],
      ["Vorrangige Regeln", () => repairFlexibleRules(event, openSet, lockSet, courseMap, assignments, loads, targets, "hard")],
      ["Jahrgang + Bildungsgang", () => repairGradeFormConstraints(event, openSet, lockSet, courseMap, assignments, loads, targets, "preferred")],
      ["Bevorzugte Regeln", () => repairFlexibleRules(event, openSet, lockSet, courseMap, assignments, loads, targets, "preferred")],
      ["Jahrgangsgruppen", () => repairGradeGroups(event, openSet, lockSet, courseMap, assignments, loads)],
    ];
    const seenDistributionStates = new Set([distributionStateFingerprint(event, assignments)]);
    const maxDistributionRounds = 8;

    for (let round = 0; round < maxDistributionRounds; round += 1) {
      let roundChanged = false;
      for (const [label, repair] of distributionStages) {
        if (runDistributionStage(label, repair)) roundChanged = true;
      }

      const metrics = distributionRuleMetrics(event, openSet, courseMap, assignments);
      if (metrics.hardViolationCount === 0 && metrics.preferredViolationCount === 0) break;

      const fingerprint = distributionStateFingerprint(event, assignments);
      if (!roundChanged || seenDistributionStates.has(fingerprint)) break;
      seenDistributionStates.add(fingerprint);
    }

    // Die lokalen Reparaturstufen liefern mehrere gute Ausgangspunkte. Von der
    // nach dem Prozentregler aktuell besten Variante aus erzeugt dieser Pass
    // vollständige kursübergreifende Neuverteilungen. Alle Regelarten wirken
    // dabei gleichzeitig auf dieselbe Kostenmatrix; mehrgliedrige
    // Verschiebungsketten müssen daher nicht mehr als einzelne lokale Schritte
    // zufällig in der richtigen Reihenfolge entstehen.
    const globalSeed = selectDistributionSnapshot(event, openSet, courseMap, distributionSnapshots);
    restoreAssignmentSnapshot(globalSeed, assignments, loads);
    const globalSeen = new Set(distributionSnapshots.map((snapshot) => distributionStateFingerprint(event, snapshot.assignments)));
    const maxGlobalRounds = event.settings.qualityMode === "fast" ? 6 : 8;
    let globalRuleSearchCandidates = 0;
    for (let round = 0; round < maxGlobalRounds; round += 1) {
      const beforeMetrics = distributionRuleMetrics(event, openSet, courseMap, assignments);
      if (beforeMetrics.rulePenalty === 0) break;
      const beforeFingerprint = distributionStateFingerprint(event, assignments);
      if (!rebuildWithGlobalRuleSearch(event, openSet, lockSet, courseMap, assignments, loads, targets, round)) break;
      const fingerprint = distributionStateFingerprint(event, assignments);
      if (fingerprint === beforeFingerprint || globalSeen.has(fingerprint)) continue;
      globalSeen.add(fingerprint);
      globalRuleSearchCandidates += 1;
      keepDistributionSnapshot(`Globale Regelsuche ${round + 1}`);
    }

    const neighborhoodSeed = selectDistributionSnapshot(event, openSet, courseMap, distributionSnapshots);
    const neighborhoodSnapshots = searchGlobalRuleNeighborhood(event, openSet, lockSet, courseMap, neighborhoodSeed);
    let globalRuleCoordinationCandidates = 0;
    for (const snapshot of neighborhoodSnapshots) {
      const fingerprint = distributionStateFingerprint(event, snapshot.assignments);
      if (globalSeen.has(fingerprint)) continue;
      if (!initialAssignmentIsValid(event, openSet, lockSet, courseMap, snapshot)) continue;
      globalSeen.add(fingerprint);
      distributionSnapshots.push(snapshot);
      globalRuleCoordinationCandidates += 1;
    }

    const selectedDistribution = selectDistributionSnapshot(event, openSet, courseMap, distributionSnapshots);
    restoreAssignmentSnapshot(selectedDistribution, assignments, loads);

    const finalPeopleByCourse = peopleByCourse(event, assignments);
    const finalCourseMinimumViolations = courseMinimumViolations(event, openSet, courseMap, assignments);
    const finalGradeLimitViolations = courseGradeLimitViolations(event, openSet, courseMap, assignments);
    const finalGradeGroupViolations = gradeGroupAssignmentState(event, openSet, courseMap, assignments).violations;
    const gradeFormSummary = summarizeGradeFormConstraints(event, openSet, courseMap, assignments);
    const finalGradeFormViolations = [...gradeFormSummary.hard, ...gradeFormSummary.preferred];
    const ruleSummary = summarizeFlexibleRules(event, openSet, courseMap, assignments);
    const allRuleViolations = [...ruleSummary.hard, ...ruleSummary.preferred];
    const courseRuleHints = new Map();
    const addCourseHint = (courseId, message) => {
      if (!courseRuleHints.has(courseId)) courseRuleHints.set(courseId, []);
      const hints = courseRuleHints.get(courseId);
      if (!hints.includes(message)) hints.push(message);
    };
    const deviationMessages = [];

    for (const violation of finalCourseMinimumViolations) {
      const detail = `Mindestbelegung: ${violation.count} statt mindestens ${violation.min} (Abweichung −${violation.distance})`;
      addCourseHint(violation.course.id, detail);
      deviationMessages.push(`${violation.course.name}${violation.course.session ? ` – Gruppe ${violation.course.session}` : ""}: ${detail}`);
    }
    for (const violation of finalGradeLimitViolations) {
      const bound = violation.kind === "gradeMax" ? `höchstens ${violation.max}` : `mindestens ${violation.min}`;
      const detail = `Jg. ${violation.grade}: ${violation.count} statt ${bound}`;
      addCourseHint(violation.course.id, detail);
      deviationMessages.push(`${violation.course.name}${violation.course.session ? ` – Gruppe ${violation.course.session}` : ""}: ${detail}`);
    }
    for (const violation of finalGradeGroupViolations) {
      const detail = `${violation.label}: ${violation.count}; Gruppengröße ${violation.groupSize}, Abweichung ${violation.distance}`;
      addCourseHint(violation.course.id, detail);
      deviationMessages.push(`${violation.course.name}${violation.course.session ? ` – Gruppe ${violation.course.session}` : ""}: ${detail}`);
    }
    for (const violation of finalGradeFormViolations) {
      const detail = `${violation.label}: ${violation.count} statt mindestens ${violation.min}`;
      addCourseHint(violation.course.id, detail);
      deviationMessages.push(`${violation.course.name}${violation.course.session ? ` – Gruppe ${violation.course.session}` : ""}: ${detail}`);
    }
    for (const violation of allRuleViolations) {
      const detail = `${violation.label}: ${violation.count} statt mindestens ${violation.min}`;
      addCourseHint(violation.course.id, detail);
      deviationMessages.push(`${violation.course.name}${violation.course.session ? ` – Gruppe ${violation.course.session}` : ""}: ${detail}`);
    }

    if (deviationMessages.length) {
      const details = deviationMessages.slice(0, 10);
      const more = deviationMessages.length > details.length ? `; ${deviationMessages.length - details.length} weitere Abweichung(en)` : "";
      warnings.push(`Bestmögliche Zuteilung mit ${deviationMessages.length} Regelabweichung(en): ${details.join("; ")}${more}. Kein Schüler wurde allein zur Einhaltung dieser Regeln aus einer zulässigen Zuteilung entfernt.`);
    }

    const unassignedDiagnoses = new Map(event.participants
      .filter((person) => !(assignments.get(person.id) || ""))
      .map((person) => [person.id, unassignedDiagnosis(event, person, openSet, courseMap, lockSet, loads)]));

    const participantResults = event.participants.map((person) => {
      const courseId = assignments.get(person.id) || "";
      const course = courseId ? courseMap.get(courseId) : null;
      const type = rankLabel(person, course);
      const noteParts = [];
      const diagnosis = unassignedDiagnoses.get(person.id) || null;
      if (type === "Nicht zugeteilt") {
        noteParts.push(diagnosis?.reason || "Kein zulässiger Platz verfügbar");
        if (diagnosis?.suggestions?.[0]?.text) noteParts.push(`Vorschlag: ${diagnosis.suggestions[0].text}`);
      }
      else if (type === "Kein Wunsch") noteParts.push("Außerhalb der vier Wünsche");
      const ruleHints = courseId ? courseRuleHints.get(courseId) || [] : [];
      if (ruleHints.length) noteParts.push(`Zugeordnet mit Regelhinweis: ${ruleHints.join("; ")}`);
      return {
        personId: person.id,
        firstName: person.firstName,
        lastName: person.lastName,
        className: person.className,
        schoolForm: person.schoolForm,
        workshopId: courseId,
        offerId: course?.offerId || "",
        workshopName: course ? `${course.name}${course.session ? ` – Gruppe ${course.session}` : ""}` : "",
        courseTypeName: course?.name || "",
        session: course?.session || "",
        type,
        note: noteParts.join(" · "),
        unassignedReason: diagnosis?.reason || "",
        unassignedSuggestion: diagnosis?.suggestions?.[0]?.text || "",
        unassignedSuggestions: diagnosis?.suggestions || [],
      };
    });
    const unassignedPeople = participantResults.filter((person) => person.type === "Nicht zugeteilt");
    const unassignedCount = unassignedPeople.length;
    if (unassignedCount) {
      warnings.push(`${unassignedCount} Schüler konnten nicht zugeteilt werden. Die vollständigen Gründe und Vorschläge stehen im Ergebnis unter „Unzugeteilte Schüler – Diagnose & Vorschläge“:`);
      for (const person of unassignedPeople) {
        warnings.push(`${person.personId} – ${person.firstName} ${person.lastName} (Klasse ${person.className}): ${person.unassignedReason} Vorschlag: ${person.unassignedSuggestion}`);
      }
    }

    const courseResults = event.workshops.map((course) => {
      const open = openSet.has(course.id);
      const load = loads.get(course.id) || 0;
      const target = open ? targets.get(course.id) || 0 : 0;
      const min = open ? courseMinimumGoal(course) : 0;
      return {
        ...course,
        open,
        effectiveMin: min,
        target,
        load,
        deviation: open ? load - target : 0,
        cohortMinEffective: open ? effectiveCohortMinimum(event, course) : 0,
        cohorts: open ? cohortSummaryForCourse(event, course, assignments, personMap) : [],
        gradeLimitSummary: open ? gradeLimitEntries(course).map((limit) => ({
          ...limit,
          count: [...assignments.entries()].reduce((sum, [personId, assignedCourse]) => {
            if (assignedCourse !== course.id) return sum;
            const person = personMap.get(personId);
            return sum + (person && parseGrade(person.className) === limit.grade ? 1 : 0);
          }, 0),
        })) : [],
        gradeGroupSummary: open ? gradeGroupSummaryForPeople(course, finalPeopleByCourse.get(course.id) || []) : [],
        gradeGroupImbalance: open ? gradeGroupImbalanceForPeople(course, finalPeopleByCourse.get(course.id) || []) : 0,
        status: open
          ? (load < min ? "Findet statt – Mindestziel unterschritten" : "Findet statt")
          : "Entfällt (optional)",
      };
    });

    for (const course of courseResults) {
      const courseViolations = allRuleViolations.filter((item) => item.course.id === course.id);
      const minimumViolations = finalCourseMinimumViolations.filter((item) => item.course.id === course.id);
      const groupViolations = finalGradeGroupViolations.filter((item) => item.course.id === course.id);
      const courseGradeViolations = finalGradeLimitViolations.filter((item) => item.course.id === course.id);
      const courseGradeFormViolations = finalGradeFormViolations.filter((item) => item.course.id === course.id);
      course.ruleHardViolations = courseViolations.filter((item) => item.rule.mode === "hard").length
        + groupViolations.length
        + courseGradeViolations.length
        + courseGradeFormViolations.filter((item) => item.rule.mode === "hard").length;
      course.rulePreferredViolations = courseViolations.filter((item) => item.rule.mode === "preferred").length
        + courseGradeFormViolations.filter((item) => item.rule.mode === "preferred").length
        + minimumViolations.length;
      course.courseMinimumViolationCount = minimumViolations.length;
      course.courseMinimumDeviation = minimumViolations.reduce((sum, item) => sum + item.distance, 0);
      course.capacityViolationCount = 0;
      course.capacityDeviation = 0;
      course.ruleDeviations = course.ruleHardViolations + course.rulePreferredViolations;
      course.ruleStatus = course.ruleDeviations ? "Bestmögliche Abweichung" : "Regeln erfüllt";
      course.ruleHints = courseRuleHints.get(course.id) || [];
      course.ruleDetails = courseViolations.map((item) => ({
        mode: item.rule.mode, type: item.rule.type, min: item.min, label: item.label, count: item.count,
      }));
    }

    const counts = new Map();
    for (const result of participantResults) counts.set(result.type, (counts.get(result.type) || 0) + 1);
    const openCourses = courseResults.filter((course) => course.open);
    const meanDeviation = openCourses.length
      ? openCourses.reduce((sum, course) => sum + Math.abs(course.deviation), 0) / openCourses.length
      : 0;

    const badWishByCourse = openCourses.map((course) => {
      const rows = participantResults.filter((person) => person.workshopId === course.id);
      return {
        courseId: course.id,
        third: rows.filter((person) => person.type === "Drittwunsch").length,
        fourth: rows.filter((person) => person.type === "Viertwunsch").length,
      };
    });
    const maxThirdPerCourse = badWishByCourse.length ? Math.max(...badWishByCourse.map((item) => item.third)) : 0;
    const maxFourthPerCourse = badWishByCourse.length ? Math.max(...badWishByCourse.map((item) => item.fourth)) : 0;
    const thirdConcentration = badWishByCourse.reduce((sum, item) => sum + item.third * item.third, 0);
    const fourthConcentration = badWishByCourse.reduce((sum, item) => sum + item.fourth * item.fourth, 0);
    const gradeGroupImbalance = openCourses.reduce((sum, course) => sum + (course.gradeGroupImbalance || 0), 0);
    const hardRuleViolations = courseResults.reduce((sum, course) => sum + (course.ruleHardViolations || 0), 0);
    const preferredRuleViolations = courseResults.reduce((sum, course) => sum + (course.rulePreferredViolations || 0), 0);
    const ruleViolationCount = hardRuleViolations + preferredRuleViolations;
    const gradeLimitDeviation = finalGradeLimitViolations.reduce((sum, violation) => sum + (
      violation.kind === "gradeMax" ? violation.count - violation.max : violation.min - violation.count
    ), 0);
    const gradeGroupDeviation = finalGradeGroupViolations.reduce((sum, violation) => sum + violation.distance, 0);
    const gradeFormDeviation = finalGradeFormViolations.reduce((sum, violation) => sum + Math.max(1, violation.min - violation.count), 0);
    const flexibleRuleDeviation = allRuleViolations.reduce((sum, violation) => sum + Math.max(1, violation.min - violation.count), 0);
    const courseMinimumDeviation = finalCourseMinimumViolations.reduce((sum, violation) => sum + violation.distance, 0);
    const ruleDeviationScore = courseMinimumDeviation + gradeLimitDeviation + gradeGroupDeviation + gradeFormDeviation + flexibleRuleDeviation;

    return {
      ok: true,
      event,
      warnings,
      participantResults,
      courseResults,
      stats: {
        participants: event.participants.length,
        workshops: event.workshops.length,
        openCourses: openCourses.length,
        first: counts.get("Erstwunsch") || 0,
        second: counts.get("Zweitwunsch") || 0,
        third: counts.get("Drittwunsch") || 0,
        fourth: counts.get("Viertwunsch") || 0,
        fixed: counts.get("Feste Setzung") || 0,
        outside: counts.get("Kein Wunsch") || 0,
        unassigned: counts.get("Nicht zugeteilt") || 0,
        capacityDeviation: 0,
        gradePreferenceWeight: event.settings.gradePreferenceWeight,
        initialAssignmentMethod,
        globalRuleSearchCandidates,
        globalRuleCoordinationCandidates,
        globalRuleSearchUsed: selectedDistribution.label.startsWith("Globale Regel"),
        distributionChoice: selectedDistribution.label,
        wishTradeoffPenalty: selectedDistribution.wishPenalty,
        ruleTradeoffPenalty: selectedDistribution.rulePenalty,
        meanDeviation,
        gradeGroupImbalance,
        preferredRuleViolations,
        hardRuleViolations,
        ruleViolationCount,
        ruleDeviationScore,
        courseMinimumDeviation,
        courseMinimumViolations: finalCourseMinimumViolations.length,
        gradeLimitDeviation,
        gradeGroupDeviation,
        maxThirdPerCourse,
        maxFourthPerCourse,
        thirdConcentration,
        fourthConcentration,
        largeCourseSpread: (() => {
          const threshold = Math.max(0, Number(event.settings.balanceThreshold) || 0);
          const loadsLarge = openCourses
            .filter((course) => threshold <= 0 || course.max > threshold)
            .map((course) => course.load);
          return loadsLarge.length ? Math.max(...loadsLarge) - Math.min(...loadsLarge) : 0;
        })(),
      },
      personMap,
      courseMap,
    };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)], warnings };
  }
}


function qualityRunCount(mode) {
  if (mode === "fast") return 1;
  if (mode === "thorough") return 24;
  return 6;
}

function deterministicHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function variantForQualityRun(raw, runIndex) {
  if (runIndex === 0) return raw;
  const participants = [...(raw?.participants ?? [])].sort((a, b) => {
    const ha = deterministicHash(`${runIndex}|${a?.id ?? ""}|${a?.lastName ?? ""}`);
    const hb = deterministicHash(`${runIndex}|${b?.id ?? ""}|${b?.lastName ?? ""}`);
    return ha - hb || String(a?.id ?? "").localeCompare(String(b?.id ?? ""), "de", { numeric: true });
  });
  const workshops = [...(raw?.workshops ?? [])];
  if (runIndex % 3 === 1) workshops.reverse();
  else if (runIndex % 3 === 2) workshops.sort((a, b) => deterministicHash(`${runIndex}|${a?.id ?? ""}`) - deterministicHash(`${runIndex}|${b?.id ?? ""}`));
  return { ...raw, participants, workshops };
}

function qualityTieTuple(result, weight) {
  const s = result?.stats ?? {};
  const wishesFirst = [-(s.wishTradeoffPenalty ?? 0), -(s.ruleTradeoffPenalty ?? 0)];
  const rulesFirst = [-(s.ruleTradeoffPenalty ?? 0), -(s.wishTradeoffPenalty ?? 0)];
  return [
    ...(weight >= 50 ? rulesFirst : wishesFirst),
    -(s.outside ?? 0),
    -(s.fourth ?? 0),
    -(s.third ?? 0),
    s.first ?? 0,
    s.second ?? 0,
    -(s.maxFourthPerCourse ?? 0),
    -(s.fourthConcentration ?? 0),
    -(s.maxThirdPerCourse ?? 0),
    -(s.thirdConcentration ?? 0),
    -(s.largeCourseSpread ?? 0),
    -(s.meanDeviation ?? 0),
  ];
}

function selectBestQualityResult(candidates, rawWeight, rawBalanceWeight = 0) {
  if (!candidates.length) return null;
  const weight = Math.max(0, Math.min(100, Number.isFinite(Number(rawWeight)) ? Number(rawWeight) : 50));
  const balanceWeight = Math.max(0, Math.min(100, Number(rawBalanceWeight) || 0));
  const minimumUnassigned = Math.min(...candidates.map((candidate) => candidate.stats?.unassigned ?? 0));
  const completeFirst = candidates.filter((candidate) => (candidate.stats?.unassigned ?? 0) === minimumUnassigned);
  const minimumCourseDeficit = Math.min(...completeFirst.map((candidate) => candidate.stats?.courseMinimumDeviation ?? 0));
  const eligible = completeFirst.filter((candidate) => (candidate.stats?.courseMinimumDeviation ?? 0) === minimumCourseDeficit);
  const wishValues = eligible.map((candidate) => candidate.stats?.wishTradeoffPenalty ?? 0);
  const ruleValues = eligible.map((candidate) => candidate.stats?.ruleTradeoffPenalty ?? 0);
  const minWish = Math.min(...wishValues);
  const maxWish = Math.max(...wishValues);
  const minRule = Math.min(...ruleValues);
  const maxRule = Math.max(...ruleValues);
  const balanceValues = completeFirst.map((candidate) => (candidate.stats?.largeCourseSpread ?? 0) * 2 + (candidate.stats?.meanDeviation ?? 0));
  const minBalance = Math.min(...balanceValues);
  const maxBalance = Math.max(...balanceValues);
  const normalized = (value, min, max) => max === min ? 0 : (value - min) / (max - min);

  return eligible.sort((a, b) => {
    const aWish = a.stats?.wishTradeoffPenalty ?? 0;
    const bWish = b.stats?.wishTradeoffPenalty ?? 0;
    const aRule = a.stats?.ruleTradeoffPenalty ?? 0;
    const bRule = b.stats?.ruleTradeoffPenalty ?? 0;
    const aBalance = (a.stats?.largeCourseSpread ?? 0) * 2 + (a.stats?.meanDeviation ?? 0);
    const bBalance = (b.stats?.largeCourseSpread ?? 0) * 2 + (b.stats?.meanDeviation ?? 0);
    const aScore = (100 - weight) * normalized(aWish, minWish, maxWish)
      + weight * normalized(aRule, minRule, maxRule)
      + balanceWeight * normalized(aBalance, minBalance, maxBalance);
    const bScore = (100 - weight) * normalized(bWish, minWish, maxWish)
      + weight * normalized(bRule, minRule, maxRule)
      + balanceWeight * normalized(bBalance, minBalance, maxBalance);
    if (aScore !== bScore) return aScore - bScore;
    const aTuple = qualityTieTuple(a, weight);
    const bTuple = qualityTieTuple(b, weight);
    for (let index = 0; index < aTuple.length; index += 1) {
      if (aTuple[index] !== bTuple[index]) return bTuple[index] - aTuple[index];
    }
    return 0;
  })[0];
}

export function optimizeEvent(raw) {
  const mode = ["fast", "standard", "thorough"].includes(raw?.settings?.qualityMode)
    ? raw.settings.qualityMode
    : "standard";
  const runs = qualityRunCount(mode);
  const started = Date.now();
  const candidates = [];
  let firstFailure = null;
  let successfulRuns = 0;
  let attemptedRuns = 0;

  for (let run = 0; run < runs; run += 1) {
    attemptedRuns += 1;
    const candidate = optimizeEventSingle(variantForQualityRun(raw, run));
    if (!candidate.ok) {
      if (!firstFailure) firstFailure = candidate;
      continue;
    }
    successfulRuns += 1;
    candidate._qualityRun = run + 1;
    candidates.push(candidate);
  }

  // Wenn harte Jahrgangs-Minima bereits die Vorprüfung unmöglich machen,
  // folgt ein eigener Bestmöglich-Durchlauf. Alle übrigen Kapazitäten,
  // Sperrungen, festen Setzungen und harten Regeln bleiben verbindlich.
  if (!candidates.length && raw?.settings?.gradeLimitsRelaxed !== true) {
    const relaxedRaw = {
      ...raw,
      settings: { ...(raw?.settings || {}), gradeLimitsRelaxed: true },
    };
    for (let run = 0; run < runs; run += 1) {
      attemptedRuns += 1;
      const candidate = optimizeEventSingle(variantForQualityRun(relaxedRaw, run));
      if (!candidate.ok) continue;
      successfulRuns += 1;
      candidate._qualityRun = run + 1;
      candidates.push(candidate);
    }
  }

  // Bleibt die Berechnung allein wegen nicht gleichzeitig erreichbarer
  // Kursmindestzahlen ohne Ergebnis, folgt automatisch ein Bestmöglich-Lauf.
  // Maximalbelegungen, Kurszugang, Sperrungen und feste Setzungen bleiben dabei
  // unverändert verbindlich.
  const currentMinimumUnassigned = candidates.length
    ? Math.min(...candidates.map((candidate) => candidate.stats?.unassigned ?? 0))
    : Number.POSITIVE_INFINITY;
  if (currentMinimumUnassigned > 0 && raw?.settings?.courseMinimumsRelaxed !== true) {
    const relaxedRaw = {
      ...raw,
      settings: { ...(raw?.settings || {}), courseMinimumsRelaxed: true },
    };
    for (let run = 0; run < runs; run += 1) {
      attemptedRuns += 1;
      const candidate = optimizeEventSingle(variantForQualityRun(relaxedRaw, run));
      if (!candidate.ok) continue;
      successfulRuns += 1;
      candidate._qualityRun = run + 1;
      candidates.push(candidate);
    }
  }

  const best = selectBestQualityResult(candidates, raw?.settings?.gradePreferenceWeight, raw?.settings?.balanceWeight);
  if (!best) return firstFailure || optimizeEventSingle(raw);
  const selectedRun = best._qualityRun || 1;
  delete best._qualityRun;
  best.quality = {
    mode,
    runsTried: attemptedRuns,
    successfulRuns,
    selectedRun,
    elapsedMs: Date.now() - started,
  };
  return best;
}
