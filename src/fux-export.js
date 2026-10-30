import ExcelJS from "exceljs";

export const FUX_COURSE_SHEET = "ProFlex_Kurse";
export const FUX_PARTICIPANT_SHEET = "ProFlex_Teilnehmer";
export const FUX_COURSE_HEADERS = [
  "Kurs-ID", "Kursname", "Jahrgang", "HJ1", "HJ2",
  "Lehrer 1", "Lehrer 2", "Lehrer 3", "Bemerkung",
];
export const FUX_PARTICIPANT_HEADERS = [
  "Kurs-ID", "Nachname", "Vorname", "Klasse", "HJ1", "HJ2",
];

const text = (value) => String(value ?? "").trim();

export function fuxGradeRange(course) {
  const from = Number(course?.gradeFrom);
  const to = Number(course?.gradeTo);
  if (!Number.isFinite(from) && !Number.isFinite(to)) return "";
  if (!Number.isFinite(to) || from === to) return String(from);
  if (!Number.isFinite(from)) return String(to);
  return `${from}-${to}`;
}

export function nextFuxCourseId(configs = {}) {
  let highest = 0;
  for (const config of Object.values(configs || {})) {
    const match = text(config?.courseId).match(/^PF-(\d+)$/i);
    if (match) highest = Math.max(highest, Number(match[1]) || 0);
  }
  return `PF-${String(highest + 1).padStart(2, "0")}`;
}

export function defaultFuxCourseConfig(course, configs = {}) {
  return {
    courseId: nextFuxCourseId(configs),
    courseName: text(course?.name),
    gradeRange: fuxGradeRange(course),
    hj1: true,
    hj2: true,
    teacher1: "",
    teacher2: "",
    teacher3: "",
    remark: "",
  };
}

function normalizedCourseConfig(course, raw = {}) {
  return {
    courseId: text(raw.courseId),
    courseName: text(raw.courseName || course?.name),
    gradeRange: text(raw.gradeRange || fuxGradeRange(course)),
    hj1: raw.hj1 !== false,
    hj2: raw.hj2 !== false,
    teacher1: text(raw.teacher1),
    teacher2: text(raw.teacher2),
    teacher3: text(raw.teacher3),
    remark: text(raw.remark),
  };
}

export function buildFuxExportData({ courses = [], participantResults = [], courseConfigs = {}, assignmentOverrides = {} } = {}) {
  const errors = [];
  const warnings = [];
  const normalizedCourses = courses.map((course) => ({
    course,
    config: normalizedCourseConfig(course, courseConfigs?.[course.id]),
  }));
  const courseByInternalId = new Map(normalizedCourses.map((entry) => [entry.course.id, entry]));
  const ids = new Map();

  if (!normalizedCourses.length) errors.push("Es findet kein Kurs statt, der exportiert werden kann.");

  for (const { course, config } of normalizedCourses) {
    const comparableId = config.courseId.toLocaleUpperCase("de");
    if (!config.courseId) errors.push(`${course.name || course.id}: Kurs-ID fehlt.`);
    else if (ids.has(comparableId)) errors.push(`Kurs-ID ${config.courseId} ist doppelt (${ids.get(comparableId)} und ${course.name || course.id}).`);
    else ids.set(comparableId, course.name || course.id);
    if (!config.courseName) errors.push(`${config.courseId || course.id}: Kursname fehlt.`);
    if (!config.gradeRange) errors.push(`${config.courseId || course.id}: Jahrgang fehlt.`);
    if (!config.hj1 && !config.hj2) errors.push(`${config.courseId || course.id}: Weder HJ1 noch HJ2 ist aktiviert.`);
    if (!config.teacher1) errors.push(`${config.courseId || course.id}: Lehrer 1 fehlt. Bitte Kürzel oder vollständigen Namen eintragen.`);
  }

  const coursesRows = normalizedCourses
    .map(({ config }) => [
      config.courseId,
      config.courseName,
      config.gradeRange,
      config.hj1 ? "X" : "",
      config.hj2 ? "X" : "",
      config.teacher1,
      config.teacher2,
      config.teacher3,
      config.remark,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "de", { numeric: true }));

  const assignments = new Map();
  let unassignedCount = 0;
  let withoutSemesterCount = 0;

  const addAssignment = (person, internalCourseId, semester) => {
    if (!internalCourseId) return;
    const entry = courseByInternalId.get(internalCourseId);
    if (!entry) {
      errors.push(`${person.firstName} ${person.lastName} (${person.className}): Der ${semester}-Kurs ${internalCourseId} ist nicht Teil des Exports.`);
      return;
    }
    if (!entry.config[semester.toLowerCase()]) {
      errors.push(`${person.firstName} ${person.lastName} (${person.className}): ${entry.config.courseId} ist für ${semester} nicht aktiviert.`);
      return;
    }
    const key = `${person.personId}\u0000${internalCourseId}`;
    if (!assignments.has(key)) {
      assignments.set(key, {
        courseId: entry.config.courseId,
        lastName: text(person.lastName),
        firstName: text(person.firstName),
        className: text(person.className),
        hj1: false,
        hj2: false,
      });
    }
    assignments.get(key)[semester.toLowerCase()] = true;
  };

  for (const person of participantResults) {
    const override = assignmentOverrides?.[person.personId];
    const defaultEntry = courseByInternalId.get(person.workshopId);
    const hj1CourseId = override && Object.hasOwn(override, "hj1WorkshopId")
      ? text(override.hj1WorkshopId)
      : (defaultEntry?.config.hj1 ? person.workshopId : "");
    const hj2CourseId = override && Object.hasOwn(override, "hj2WorkshopId")
      ? text(override.hj2WorkshopId)
      : (defaultEntry?.config.hj2 ? person.workshopId : "");

    if (!person.workshopId && !hj1CourseId && !hj2CourseId) unassignedCount += 1;
    if (!hj1CourseId && !hj2CourseId) withoutSemesterCount += 1;
    if ((hj1CourseId || hj2CourseId) && (!text(person.lastName) || !text(person.firstName) || !text(person.className))) {
      errors.push(`${person.personId || "Schüler ohne ID"}: Nachname, Vorname und Klasse müssen für den FuxNoten-Abgleich vollständig sein.`);
    }
    addAssignment(person, hj1CourseId, "HJ1");
    addAssignment(person, hj2CourseId, "HJ2");
  }

  if (unassignedCount) warnings.push(`${unassignedCount} unzugeteilte Schüler werden nicht in ProFlex_Teilnehmer exportiert.`);
  if (withoutSemesterCount > unassignedCount) warnings.push(`${withoutSemesterCount - unassignedCount} weitere Schüler haben weder für HJ1 noch für HJ2 eine Exportzuordnung.`);

  const participantRows = [...assignments.values()]
    .map((row) => [
      row.courseId,
      row.lastName,
      row.firstName,
      row.className,
      row.hj1 ? "X" : "",
      row.hj2 ? "X" : "",
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "de", { numeric: true })
      || String(a[1]).localeCompare(String(b[1]), "de")
      || String(a[2]).localeCompare(String(b[2]), "de")
      || String(a[3]).localeCompare(String(b[3]), "de", { numeric: true }));

  return {
    courseHeaders: [...FUX_COURSE_HEADERS],
    participantHeaders: [...FUX_PARTICIPANT_HEADERS],
    courseRows: coursesRows,
    participantRows,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    stats: {
      courses: coursesRows.length,
      participantAssignments: participantRows.length,
      unassigned: unassignedCount,
      overrides: Object.keys(assignmentOverrides || {}).length,
    },
  };
}

export function createFuxWorkbook(exportData) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ProFlex / GTS / Angebotsmanager";
  const courses = workbook.addWorksheet(FUX_COURSE_SHEET);
  courses.addRow(exportData.courseHeaders);
  exportData.courseRows.forEach((row) => courses.addRow(row));
  const participants = workbook.addWorksheet(FUX_PARTICIPANT_SHEET);
  participants.addRow(exportData.participantHeaders);
  exportData.participantRows.forEach((row) => participants.addRow(row));
  return workbook;
}
