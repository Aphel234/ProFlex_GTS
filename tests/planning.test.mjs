import test from "node:test";
import assert from "node:assert/strict";
import { assignmentDifference, buildBottleneckRecommendations, buildDemandStats } from "../src/planning.js";

const event = {
  workshops: [
    { id: "B1", offerId: "B", name: "Basketball", gradeFrom: 7, gradeTo: 12, schoolForm: "Alle", min: 1, max: 2 },
    { id: "J1", offerId: "J", name: "Juniorlehrer", gradeFrom: 7, gradeTo: 12, schoolForm: "Alle", min: 3, max: 6 },
  ],
  participants: [
    { id: "P1", className: "8a", schoolForm: "Regional", wishes: ["B", "J", "", ""] },
    { id: "P2", className: "8b", schoolForm: "Regional", wishes: ["B", "", "", ""] },
    { id: "P3", className: "9a", schoolForm: "Regional", wishes: ["B", "", "", ""] },
  ],
  locks: [],
};

test("Nachfrageübersicht zählt Wunschpositionen, Kapazität und kritische Nachfrage", () => {
  const stats = buildDemandStats(event);
  const basketball = stats.find((offer) => offer.offerId === "B");
  const junior = stats.find((offer) => offer.offerId === "J");
  assert.deepEqual(basketball.rankCounts, [3, 0, 0, 0]);
  assert.equal(basketball.totalDemand, 3);
  assert.equal(basketball.capacity, 2);
  assert.equal(basketball.criticalDemand, 2);
  assert.equal(basketball.status, "over");
  assert.equal(junior.eligibleDemand, 1);
  assert.equal(junior.status, "under");
});

test("Engpassanalyse empfiehlt Kapazitätserhöhung und Anpassung einer Mindestgröße", () => {
  const demand = buildDemandStats(event, { participantResults: [], stats: { unassigned: 1 } });
  const recommendations = buildBottleneckRecommendations(event, { stats: { unassigned: 1 } }, demand);
  assert.ok(recommendations.some((item) => item.type === "capacity" && item.offerId === "B"));
  assert.ok(recommendations.some((item) => item.type === "minimum" && item.offerId === "J"));
});

test("Lösungsvergleich zählt geänderte Zuordnungen", () => {
  const a = { participantResults: [{ personId: "P1", workshopId: "A" }, { personId: "P2", workshopId: "B" }] };
  const b = { participantResults: [{ personId: "P1", workshopId: "B" }, { personId: "P2", workshopId: "B" }] };
  assert.equal(assignmentDifference(a, b), 1);
});
