import test from "node:test";
import assert from "node:assert/strict";
import { buildEnrollmentCheck, inferSchoolForm, uniqueWishes } from "../src/enrollment.js";
import { normalizeEvent, optimizeEvent, validateEvent } from "../src/optimizer.js";

function baseEvent(settings = {}) {
  return normalizeEvent({
    name: "Test",
    settings: { projectType: "school", classRequired: true, expectedWishes: 3, qualityMode: "fast", ...settings },
    workshops: [
      { id: "A-1", offerId: "A", name: "Angebot A", session: "A", gradeFrom: 7, gradeTo: 10, schoolForm: "Alle", min: 0, max: 10, mode: "Pflicht" },
      { id: "B-1", offerId: "B", name: "Angebot B", session: "A", gradeFrom: 7, gradeTo: 10, schoolForm: "Alle", min: 0, max: 10, mode: "Optional" },
      { id: "C-1", offerId: "C", name: "Angebot C", session: "A", gradeFrom: 7, gradeTo: 10, schoolForm: "Alle", min: 0, max: 10, mode: "Optional" },
    ],
    participants: [],
    locks: [],
  });
}

test("Klassen ohne G werden regional, Klassen mit G gymnasial erkannt", () => {
  assert.equal(inferSchoolForm("8b"), "Regional");
  assert.equal(inferSchoolForm("8bG"), "Gymnasial");
  assert.equal(inferSchoolForm("8bg"), "Gymnasial");
  assert.equal(inferSchoolForm("8G1"), "Gymnasial");
  assert.equal(inferSchoolForm(""), "");
});

test("Doppelte Wünsche werden für die Berechnung auf den ersten Treffer reduziert", () => {
  assert.deepEqual(uniqueWishes(["A", "A", "B", "A"]), ["A", "B", "", ""]);
});

test("Einwahlprüfung nennt Person und doppelte oder fehlende Wünsche", () => {
  const event = baseEvent();
  event.participants.push({
    id: "P1", firstName: "Emma", lastName: "Müller", className: "8b", schoolForm: "Regional",
    wishes: ["A", "A", "", ""], fixed: "", enrollmentIssues: [],
  });
  const check = buildEnrollmentCheck(event);
  assert.equal(check.review, 1);
  assert.equal(check.duplicateWishes, 1);
  assert.match(check.rows[0].issues.join(" "), /mehrfach eingetragen/);
  assert.match(check.rows[0].issues.join(" "), /1 von 3/);
});

test("Personen ohne Klasse können bei allgemeinen Veranstaltungen zugeteilt werden", () => {
  const event = baseEvent({ projectType: "general", classRequired: false, expectedWishes: 1 });
  event.participants.push({ id: "P1", firstName: "Alex", lastName: "Muster", className: "", schoolForm: "Regional", wishes: ["A", "", "", ""], fixed: "" });
  const validation = validateEvent(event);
  assert.deepEqual(validation.errors, []);
  const result = optimizeEvent(event);
  assert.equal(result.ok, true);
  assert.equal(result.stats.unassigned, 0);
  assert.equal(result.participantResults[0].workshopId, "A-1");
});

test("Fehlende Klasse im Schulprojekt warnt, bricht die gesamte Prüfung aber nicht ab", () => {
  const event = baseEvent({ classRequired: true, expectedWishes: 1 });
  event.participants.push({ id: "P1", firstName: "Alex", lastName: "Muster", className: "", schoolForm: "Regional", wishes: ["A", "", "", ""], fixed: "" });
  const validation = validateEvent(event);
  assert.equal(validation.errors.some((message) => message.includes("Klasse")), false);
  assert.equal(validation.warnings.some((message) => message.includes("Klasse fehlt")), true);
});

test("Alte Projekte mit Viertwünschen bleiben automatisch bei vier Wunschstufen", () => {
  const event = normalizeEvent({
    name: "Altprojekt",
    settings: {},
    workshops: [],
    participants: [{ id: "P1", firstName: "A", lastName: "B", className: "8a", wishes: ["A", "B", "C", "D"] }],
  });
  assert.equal(event.settings.expectedWishes, 4);
  assert.deepEqual(event.participants[0].wishes, ["A", "B", "C", "D"]);
});
