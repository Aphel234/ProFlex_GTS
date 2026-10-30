import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { optimizeEvent } from "../src/optimizer.js";

const participantCount = Math.max(8, Number(process.argv[2]) || 120);
const courseCount = Math.max(2, Number(process.argv[3]) || 12);
const qualityMode = process.argv[4] || "fast";
const courseMax = Math.ceil(participantCount / courseCount) + 4;

const workshops = Array.from({ length: courseCount }, (_, index) => ({
  id: `C${String(index + 1).padStart(2, "0")}`,
  offerId: `O${String(index + 1).padStart(2, "0")}`,
  name: `Kurs ${index + 1}`,
  session: "",
  gradeFrom: 8,
  gradeTo: 10,
  schoolForm: "Alle",
  min: 1,
  max: courseMax,
  mode: "Pflicht",
  cohortMin: 0,
  gradeLimits: {},
  gradeGroupRule: { enabled: true, balance: true },
}));

const participants = Array.from({ length: participantCount }, (_, index) => ({
  id: `P${String(index + 1).padStart(4, "0")}`,
  firstName: "Test",
  lastName: String(index + 1),
  className: index % 2 === 0 ? "8a" : "10a",
  schoolForm: "Regional",
  wishes: Array.from({ length: 4 }, (_, rank) => workshops[(index + rank * 5) % workshops.length].offerId),
  fixed: "",
}));

const event = {
  name: "Benchmark Jahrgangsgruppen",
  settings: {
    allowOutside: true,
    defaultMode: "Pflicht",
    balanceWeight: 10,
    balanceThreshold: 10,
    cohortMin: 0,
    qualityMode,
    gradePreferenceWeight: 100,
    rules: [],
  },
  workshops,
  participants,
  locks: [],
};

const started = performance.now();
const result = optimizeEvent(event);
const elapsedMs = performance.now() - started;
if (!result.ok) {
  console.error(result.errors?.join("\n") || "Benchmark fehlgeschlagen");
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    participantCount,
    courseCount,
    qualityMode,
    elapsedMs: Math.round(elapsedMs),
    qualityRuns: result.quality?.runsTried,
    unassigned: result.stats.unassigned,
    gradeGroupDeviation: result.stats.gradeGroupDeviation,
    ruleViolations: result.stats.ruleViolationCount,
    assignmentFingerprint: createHash("sha256")
      .update(result.participantResults.map((row) => `${row.personId}:${row.workshopId}`).sort().join("|"))
      .digest("hex"),
  }));
}
