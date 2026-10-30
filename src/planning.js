function gradeFromClass(value) {
  const match = String(value || "").match(/^(\d{1,2})/);
  return match ? Number(match[1]) : Number.NaN;
}

function eligibleForCourse(event, person, course) {
  const grade = gradeFromClass(person.className);
  if (!Number.isFinite(grade) || grade < course.gradeFrom || grade > course.gradeTo) return false;
  if (course.schoolForm !== "Alle" && course.schoolForm !== person.schoolForm) return false;
  return !(event.locks || []).some((lock) => lock.personId === person.id && lock.workshopId === course.id);
}

function demandStatus(totalDemand, eligibleDemand, capacity, minimum) {
  if (minimum > 0 && eligibleDemand < minimum) return { key: "under", label: "zu wenig angewählt" };
  if (capacity > 0 && totalDemand > capacity) return { key: "over", label: "stark überfragt" };
  if (capacity > 0 && totalDemand >= capacity * 0.8) return { key: "tight", label: "gut ausgelastet" };
  return { key: "low", label: "Kapazität frei" };
}

export function buildDemandStats(event, result = null) {
  const offers = new Map();
  for (const course of event.workshops || []) {
    const offerId = course.offerId || course.id;
    if (!offers.has(offerId)) {
      offers.set(offerId, {
        offerId,
        name: course.name || offerId,
        sessions: [],
        capacity: 0,
        minimum: 0,
        rankCounts: [0, 0, 0, 0],
        totalDemand: 0,
        eligibleDemand: 0,
        criticalDemand: 0,
        assigned: 0,
        unmetDemand: 0,
      });
    }
    const offer = offers.get(offerId);
    offer.sessions.push(course.id);
    offer.capacity += Math.max(0, Number(course.max) || 0);
    offer.minimum += Math.max(0, Number(course.min) || 0);
  }

  for (const person of event.participants || []) {
    const uniqueWishes = [...new Set((person.wishes || []).filter(Boolean))];
    const eligibleWishes = uniqueWishes.filter((offerId) => {
      const offer = offers.get(offerId);
      return offer?.sessions.some((courseId) => {
        const course = (event.workshops || []).find((item) => item.id === courseId);
        return course && eligibleForCourse(event, person, course);
      });
    });
    uniqueWishes.forEach((offerId) => {
      const offer = offers.get(offerId);
      if (!offer) return;
      const rank = (person.wishes || []).findIndex((wish) => wish === offerId);
      if (rank >= 0 && rank < 4) offer.rankCounts[rank] += 1;
      offer.totalDemand += 1;
      if (eligibleWishes.includes(offerId)) offer.eligibleDemand += 1;
      if (eligibleWishes.length === 1 && eligibleWishes[0] === offerId) offer.criticalDemand += 1;
    });
  }

  if (result?.participantResults) {
    for (const row of result.participantResults) {
      const offer = offers.get(row.offerId);
      if (offer) offer.assigned += 1;
    }
  }

  return [...offers.values()].map((offer) => {
    const status = demandStatus(offer.totalDemand, offer.eligibleDemand, offer.capacity, offer.minimum);
    const pressure = offer.capacity > 0 ? offer.totalDemand / offer.capacity : (offer.totalDemand ? Number.POSITIVE_INFINITY : 0);
    return {
      ...offer,
      status: status.key,
      statusLabel: status.label,
      pressure,
      unmetDemand: Math.max(0, offer.totalDemand - offer.assigned),
      weightedPopularity: offer.rankCounts.reduce((sum, count, index) => sum + count * (4 - index), 0),
    };
  }).sort((a, b) => b.weightedPopularity - a.weightedPopularity || a.name.localeCompare(b.name, "de"));
}

export function buildBottleneckRecommendations(event, result, demandStats) {
  const recommendations = [];
  for (const offer of demandStats) {
    if (offer.status === "over") {
      const deficit = Math.max(1, offer.totalDemand - offer.capacity);
      const delta = Math.min(4, deficit);
      recommendations.push({
        id: `capacity:${offer.offerId}`,
        type: "capacity",
        severity: 100 + deficit,
        offerId: offer.offerId,
        title: `${offer.name}: Nachfrage über Kapazität`,
        message: `${offer.totalDemand} Schüler haben das Angebot gewählt, verfügbar sind ${offer.capacity} Plätze. ${offer.criticalDemand} Schüler sind besonders abhängig, weil dies ihr einziger zulässiger Wunsch ist.`,
        actionLabel: `Maximum um ${delta} erhöhen`,
        delta,
      });
    }
    if (offer.status === "under") {
      const missing = Math.max(1, offer.minimum - offer.eligibleDemand);
      recommendations.push({
        id: `minimum:${offer.offerId}`,
        type: "minimum",
        severity: 80 + missing,
        offerId: offer.offerId,
        title: `${offer.name}: Mindestgröße voraussichtlich nicht erreichbar`,
        message: `Nur ${offer.eligibleDemand} zulässige Anwähler treffen auf eine gesamte Mindestgröße von ${offer.minimum}. Empfehlung: Minimum senken oder Durchführung optional behandeln.`,
        actionLabel: "Mindestgrößen an Nachfrage anpassen",
        suggestedMinimum: offer.eligibleDemand,
      });
    }
  }

  const totalCapacity = (event.workshops || []).reduce((sum, course) => sum + Math.max(0, Number(course.max) || 0), 0);
  const participantCount = (event.participants || []).length;
  if (totalCapacity < participantCount) {
    recommendations.push({
      id: "global:capacity",
      type: "global",
      severity: 1000 + participantCount - totalCapacity,
      title: "Gesamtkapazität reicht nicht aus",
      message: `${participantCount} Schüler treffen auf nur ${totalCapacity} Plätze. Mindestens ${participantCount - totalCapacity} zusätzliche Plätze sind erforderlich.`,
      actionLabel: "",
    });
  }

  if (result?.stats?.unassigned > 0 && totalCapacity >= participantCount) {
    const free = Math.max(0, totalCapacity - participantCount);
    recommendations.push({
      id: "global:distribution",
      type: "global",
      severity: 900 + result.stats.unassigned,
      title: "Plätze vorhanden, aber ungünstig verteilt",
      message: `${result.stats.unassigned} Schüler sind unzugeteilt, obwohl insgesamt genügend Kapazität vorhanden ist. Freie Plätze liegen wahrscheinlich in wenig angewählten oder für diese Schüler unzulässigen Angeboten.`,
      actionLabel: "",
      free,
    });
  }
  return recommendations.sort((a, b) => b.severity - a.severity || a.title.localeCompare(b.title, "de"));
}

export function assignmentDifference(a, b) {
  const left = new Map((a?.participantResults || []).map((row) => [row.personId, row.workshopId || ""]));
  return (b?.participantResults || []).reduce((count, row) => count + (left.get(row.personId) !== (row.workshopId || "") ? 1 : 0), 0);
}
