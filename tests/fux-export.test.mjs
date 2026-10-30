import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  FUX_COURSE_HEADERS,
  FUX_COURSE_SHEET,
  FUX_PARTICIPANT_HEADERS,
  FUX_PARTICIPANT_SHEET,
  buildFuxExportData,
  createFuxWorkbook,
  defaultFuxCourseConfig,
} from "../src/fux-export.js";
import { normalizeEvent } from "../src/optimizer.js";

const courses = [
  { id: "A", name: "Chor", gradeFrom: 7, gradeTo: 10 },
  { id: "B", name: "Schülerband", gradeFrom: 8, gradeTo: 10 },
];

const configs = {
  A: { courseId: "PF-01", courseName: "Chor", gradeRange: "7-10", hj1: true, hj2: true, teacher1: "AckP", teacher2: "", teacher3: "", remark: "" },
  B: { courseId: "PF-02", courseName: "Schülerband", gradeRange: "8-10", hj1: true, hj2: false, teacher1: "RicO", teacher2: "WünA", teacher3: "", remark: "" },
};

test("FuxNoten-Export erzeugt exakt die verlangten Blätter, Spalten und Zuordnungszeilen", async () => {
  const data = buildFuxExportData({
    courses,
    courseConfigs: configs,
    participantResults: [
      { personId: "P1", lastName: "Müller", firstName: "Emma", className: "8AG", workshopId: "A" },
      { personId: "P2", lastName: "Meyer", firstName: "Lena", className: "8AG", workshopId: "B" },
      { personId: "P3", lastName: "Ohne", firstName: "Olaf", className: "9BR", workshopId: "" },
    ],
  });

  assert.deepEqual(data.errors, []);
  assert.deepEqual(data.courseHeaders, FUX_COURSE_HEADERS);
  assert.deepEqual(data.participantHeaders, FUX_PARTICIPANT_HEADERS);
  assert.deepEqual(data.courseRows, [
    ["PF-01", "Chor", "7-10", "X", "X", "AckP", "", "", ""],
    ["PF-02", "Schülerband", "8-10", "X", "", "RicO", "WünA", "", ""],
  ]);
  assert.deepEqual(data.participantRows, [
    ["PF-01", "Müller", "Emma", "8AG", "X", "X"],
    ["PF-02", "Meyer", "Lena", "8AG", "X", ""],
  ]);
  assert.match(data.warnings.join(" "), /1 unzugeteilte Schüler/);

  const workbook = createFuxWorkbook(data);
  assert.equal(workbook.creator, "ProFlex / GTS / Angebotsmanager");
  const buffer = await workbook.xlsx.writeBuffer();
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer);
  assert.deepEqual(restored.worksheets.map((sheet) => sheet.name), [FUX_COURSE_SHEET, FUX_PARTICIPANT_SHEET]);
  assert.deepEqual(restored.getWorksheet(FUX_COURSE_SHEET).getRow(1).values.slice(1), FUX_COURSE_HEADERS);
  assert.deepEqual(restored.getWorksheet(FUX_PARTICIPANT_SHEET).getRow(1).values.slice(1), FUX_PARTICIPANT_HEADERS);
  assert.deepEqual(restored.getWorksheet(FUX_COURSE_SHEET).model.merges, []);
  assert.deepEqual(restored.getWorksheet(FUX_PARTICIPANT_SHEET).model.merges, []);
});

test("Individueller Halbjahreswechsel wird als zwei getrennte Schüler-Kurs-Zeilen exportiert", () => {
  const bothTerms = {
    ...configs,
    B: { ...configs.B, hj2: true },
  };
  const data = buildFuxExportData({
    courses,
    courseConfigs: bothTerms,
    participantResults: [{ personId: "P1", lastName: "Meyer", firstName: "Lena", className: "8AG", workshopId: "A" }],
    assignmentOverrides: { P1: { hj1WorkshopId: "A", hj2WorkshopId: "B" } },
  });
  assert.deepEqual(data.errors, []);
  assert.deepEqual(data.participantRows, [
    ["PF-01", "Meyer", "Lena", "8AG", "X", ""],
    ["PF-02", "Meyer", "Lena", "8AG", "", "X"],
  ]);
});

test("Doppelte Kurs-IDs und Zuordnungen zu inaktiven Halbjahreskursen blockieren den Export", () => {
  const duplicate = buildFuxExportData({
    courses,
    courseConfigs: { ...configs, B: { ...configs.B, courseId: "pf-01" } },
    participantResults: [],
  });
  assert.match(duplicate.errors.join(" "), /Kurs-ID pf-01 ist doppelt/);

  const inactive = buildFuxExportData({
    courses,
    courseConfigs: configs,
    participantResults: [{ personId: "P1", lastName: "Meyer", firstName: "Lena", className: "8AG", workshopId: "A" }],
    assignmentOverrides: { P1: { hj1WorkshopId: "A", hj2WorkshopId: "B" } },
  });
  assert.match(inactive.errors.join(" "), /PF-02 ist für HJ2 nicht aktiviert/);

  const withoutTeacher = buildFuxExportData({
    courses: [courses[0]],
    courseConfigs: { A: { ...configs.A, teacher1: "" } },
    participantResults: [],
  });
  assert.match(withoutTeacher.errors.join(" "), /Lehrer 1 fehlt/);
});

test("Fux-Kursdaten und Halbjahreswechsel bleiben beim Normalisieren des Projekts erhalten", () => {
  const event = normalizeEvent({
    name: "Fux",
    workshops: [{ id: "A", offerId: "A", name: "Chor", gradeFrom: 7, gradeTo: 10, schoolForm: "Alle", min: 1, max: 20, mode: "Pflicht" }],
    participants: [{ id: "P1", firstName: "Emma", lastName: "Müller", className: "8AG", schoolForm: "Regional", wishes: ["A"] }],
    fuxExport: {
      courses: { A: { ...defaultFuxCourseConfig(courses[0]), courseId: "PF-01", teacher1: "AckP" } },
      assignmentOverrides: { P1: { hj1WorkshopId: "A", hj2WorkshopId: "" } },
    },
  });
  assert.equal(event.fuxExport.courses.A.courseId, "PF-01");
  assert.equal(event.fuxExport.courses.A.teacher1, "AckP");
  assert.deepEqual(event.fuxExport.assignmentOverrides.P1, { hj1WorkshopId: "A", hj2WorkshopId: "" });
});
