import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function testApi() {
  const source = await readFile(new URL("../public/assets/survey-import.js", import.meta.url), "utf8");
  const window = { addEventListener() {} };
  vm.runInNewContext(source, { window, document: {}, console, setTimeout, clearTimeout });
  return window.__proflexSurveyImportTest;
}

test("Umfrageformat mit kombiniertem Namen, Zeitstempel und drei Wünschen wird erkannt", async () => {
  const api = await testApi();
  const rows = [
    ["Name", "Übermittelt", "Q1: Klasse", "Q2: Erstwunsch", "Q3: Zweitwunsch", "Q4: Drittwunsch"],
    ["Richter, Oliver", "2026-10-30 12:55:59", "8b", "a", "b", "c"],
  ];
  assert.equal(api.headerIndex(rows, true), 0);
  assert.deepEqual({ ...api.splitCombinedName(rows[1][0]) }, { firstName: "Oliver", lastName: "Richter", uncertain: false });
  assert.equal(api.wishSlotFromHeader("Q2: Erstwunsch"), 1);
  assert.equal(api.wishSlotFromHeader("Q4: Drittwunsch"), 3);
  assert.equal(api.parseClass("8b").schoolForm, "Regional");
});

test("Eine vierte Wunschspalte ist nicht erforderlich", async () => {
  const api = await testApi();
  assert.equal(api.headerIndex([["Vorname", "Nachname", "Klasse", "Wunsch 1", "Wunsch 2", "Wunsch 3"]], true), 0);
});

test("Bei optionaler Klasse genügt eine Namens- und Wunschstruktur", async () => {
  const api = await testApi();
  assert.equal(api.headerIndex([["Vorname", "Nachname", "Erstwunsch"]], false), 0);
});
