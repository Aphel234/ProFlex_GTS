export function inferSchoolForm(className) {
  const value = String(className || "").trim();
  if (!value) return "";
  if (/reg(ional)?$/i.test(value) || /r$/i.test(value)) return "Regional";
  return /g/i.test(value) ? "Gymnasial" : "Regional";
}

export function uniqueWishes(wishes, length = 4) {
  const seen = new Set();
  const result = [];
  for (const raw of wishes || []) {
    const wish = String(raw || "").trim();
    if (!wish || seen.has(wish)) continue;
    seen.add(wish);
    result.push(wish);
  }
  return Array.from({ length }, (_, index) => result[index] || "");
}

export function enrollmentIssuesForParticipant(participant, event) {
  const issues = [...(participant?.enrollmentIssues || [])].filter(Boolean);
  const wishes = (participant?.wishes || []).map((wish) => String(wish || "").trim()).filter(Boolean);
  const positions = new Map();
  wishes.forEach((wish, index) => {
    if (!positions.has(wish)) positions.set(wish, []);
    positions.get(wish).push(index + 1);
  });
  for (const [wish, slots] of positions) {
    if (slots.length > 1) issues.push(`Angebot ${wish} wurde als Wunsch ${slots.join(" und ")} mehrfach eingetragen.`);
  }

  const unique = new Set(wishes);
  const expected = Math.max(1, Math.min(4, Number(event?.settings?.expectedWishes) || 3));
  if (unique.size < expected) issues.push(`Nur ${unique.size} von ${expected} erwarteten unterschiedlichen Wünschen eingetragen.`);

  const known = new Set((event?.workshops || []).map((offer) => offer.offerId));
  for (const wish of unique) if (!known.has(wish)) issues.push(`Unbekanntes Angebot: ${wish}.`);

  const className = String(participant?.className || "").trim();
  if (event?.settings?.classRequired && !/^\d{1,2}/.test(className)) issues.push("Klasse fehlt oder enthält keinen erkennbaren Jahrgang.");
  return [...new Set(issues)];
}

export function buildEnrollmentCheck(event) {
  const rows = (event?.participants || []).map((participant) => {
    const issues = enrollmentIssuesForParticipant(participant, event);
    return {
      personId: participant.id,
      firstName: participant.firstName,
      lastName: participant.lastName,
      className: participant.className,
      issues,
      status: issues.length ? "review" : "valid",
    };
  });
  return {
    rows,
    valid: rows.filter((row) => row.status === "valid").length,
    review: rows.filter((row) => row.status === "review").length,
    missingClass: rows.filter((row) => row.issues.some((issue) => issue.startsWith("Klasse fehlt"))).length,
    duplicateWishes: rows.filter((row) => row.issues.some((issue) => issue.includes("mehrfach eingetragen"))).length,
  };
}
