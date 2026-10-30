function seededRandom(seed = 20260710) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function gradeFromClass(className) {
  return Number(String(className).match(/^\d+/)?.[0] || 0);
}

export function createSampleData() {
  const workshops = [
    { id: "W01", offerId: "W01", name: "Robotik", session: "A", cohortMin: 0, gradeFrom: 7, gradeTo: 12, schoolForm: "Alle", min: 0, max: 12, mode: "Pflicht" },
    { id: "W02", offerId: "W02", name: "Theater", session: "A", cohortMin: 0, gradeFrom: 7, gradeTo: 12, schoolForm: "Alle", min: 6, max: 14, mode: "Pflicht" },
    { id: "W03", offerId: "W03", name: "Kochen", session: "A", cohortMin: 0, gradeFrom: 7, gradeTo: 10, schoolForm: "Alle", min: 5, max: 12, mode: "Pflicht" },
    { id: "W04", offerId: "W04", name: "Fotografie", session: "A", cohortMin: 0, gradeFrom: 7, gradeTo: 12, schoolForm: "Alle", min: 0, max: 12, mode: "Pflicht" },
    { id: "W05", offerId: "W05", name: "Kreatives Schreiben", session: "A", cohortMin: 0, gradeFrom: 7, gradeTo: 12, schoolForm: "Alle", min: 0, max: 12, mode: "Pflicht" },
    { id: "W06", offerId: "W06", name: "Musikproduktion", session: "A", cohortMin: 0, gradeFrom: 7, gradeTo: 10, schoolForm: "Regional", min: 6, max: 12, mode: "Pflicht" },
    { id: "W07", offerId: "W07", name: "Sport & Bewegung", session: "A", cohortMin: 0, gradeFrom: 7, gradeTo: 12, schoolForm: "Alle", min: 0, max: 16, mode: "Pflicht" },
    { id: "W08", offerId: "W08", name: "Nachhaltigkeit", session: "A", cohortMin: 0, gradeFrom: 7, gradeTo: 10, schoolForm: "Gymnasial", min: 5, max: 12, mode: "Pflicht" },
    { id: "W09", offerId: "W09", name: "Mediengestaltung", session: "A", cohortMin: 0, gradeFrom: 9, gradeTo: 12, schoolForm: "Alle", min: 0, max: 14, mode: "Pflicht" },
    { id: "W10", offerId: "W10", name: "Drachenboot", session: "A", cohortMin: null, gradeFrom: 7, gradeTo: 7, schoolForm: "Regional", min: 3, max: 8, mode: "Pflicht" },
    { id: "W10B", offerId: "W10", name: "Drachenboot", session: "B", cohortMin: null, gradeFrom: 7, gradeTo: 7, schoolForm: "Regional", min: 3, max: 8, mode: "Pflicht" },
    { id: "W11", offerId: "W11", name: "Berufsorientierung", session: "A", cohortMin: 0, gradeFrom: 7, gradeTo: 10, schoolForm: "Regional", min: 6, max: 14, mode: "Pflicht" },
    { id: "W12", offerId: "W12", name: "Oberstufenlabor", session: "A", cohortMin: 0, gradeFrom: 11, gradeTo: 12, schoolForm: "Gymnasial", min: 5, max: 12, mode: "Pflicht" },
    { id: "W13", offerId: "W13", name: "Erste Hilfe", session: "A", cohortMin: 0, gradeFrom: 7, gradeTo: 12, schoolForm: "Alle", min: 0, max: 16, mode: "Pflicht" },
    { id: "W14", offerId: "W14", name: "Debattieren", session: "A", cohortMin: 0, gradeFrom: 9, gradeTo: 12, schoolForm: "Gymnasial", min: 4, max: 12, mode: "Pflicht" },
    { id: "W15", offerId: "W15", name: "Handwerk & Technik", session: "A", cohortMin: 0, gradeFrom: 7, gradeTo: 10, schoolForm: "Regional", min: 5, max: 14, mode: "Pflicht" },
  ];

  const firstNames = ["Anna", "Ben", "Clara", "David", "Emma", "Felix", "Greta", "Hasan", "Ida", "Jonas", "Klara", "Leon", "Mia", "Noah", "Olivia", "Paul", "Rania", "Samuel", "Tara", "Yusuf", "Amelie", "Bruno", "Celine", "Deniz", "Elena"];
  const lastNames = ["Becker", "Fischer", "Hoffmann", "Klein", "Wagner", "Braun", "Wolf", "Yilmaz", "Schmitt", "Richter", "Neumann", "Hartmann", "König", "Schwarz", "Zimmermann", "Krüger", "Saleh", "Lehmann", "Vogel", "Öztürk", "Koch", "Bauer", "Schulz", "Krause", "Werner"];
  const classes = ["7a", "7b", "8a", "8b", "9a", "9b", "10a", "10b", "11", "12"];
  const rnd = seededRandom();

  const participants = Array.from({ length: 100 }, (_, index) => {
    const className = classes[index % classes.length];
    const grade = gradeFromClass(className);
    const schoolForm = grade >= 11 ? "Gymnasial" : (Math.floor(index / classes.length) + index) % 2 ? "Gymnasial" : "Regional";
    return {
      id: `P${String(index + 1).padStart(3, "0")}`,
      firstName: firstNames[index % firstNames.length],
      lastName: lastNames[(index * 7 + Math.floor(index / firstNames.length)) % lastNames.length],
      className,
      schoolForm,
      wishes: ["", "", "", ""],
      fixed: "",
    };
  });

  const eligible = (person, course) => {
    const grade = gradeFromClass(person.className);
    return grade >= course.gradeFrom && grade <= course.gradeTo && (course.schoolForm === "Alle" || course.schoolForm === person.schoolForm);
  };

  // Reserve distinct participants for every effective mandatory minimum.
  const reserved = new Set();
  const courseOrder = ["W10", "W10B", "W12", "W06", "W11", "W15", "W08", "W14", "W03", "W02", "W01", "W04", "W05", "W07", "W09", "W13"];
  const courseMap = new Map(workshops.map((course) => [course.id, course]));
  const coreAssignments = [];
  for (const courseId of courseOrder) {
    const course = courseMap.get(courseId);
    const need = Math.max(course.min, 1);
    const candidates = participants.filter((person) => !reserved.has(person.id) && eligible(person, course));
    for (let i = 0; i < need; i += 1) {
      const person = candidates[i];
      if (!person) throw new Error(`Musterdaten konnten für ${courseId} nicht erzeugt werden.`);
      reserved.add(person.id);
      person.wishes[i % 2] = course.offerId;
      coreAssignments.push([person.id, courseId]);
    }
  }

  // Fill all remaining wish slots with eligible, non-duplicate courses.
  for (const person of participants) {
    const pool = [...new Set(workshops.filter((course) => eligible(person, course)).map((course) => course.offerId))];
    for (let slot = 0; slot < 4; slot += 1) {
      if (person.wishes[slot]) continue;
      const available = pool.filter((id) => !person.wishes.includes(id));
      const selected = available[Math.floor(rnd() * available.length)] || "";
      person.wishes[slot] = selected;
    }
  }

  // A few fixed assignments, chosen from the reserved core so feasibility remains guaranteed.
  for (const [personId, courseId] of coreAssignments.slice(0, 6)) {
    participants.find((person) => person.id === personId).fixed = courseId;
  }

  // Example locks that do not contradict fixed assignments.
  const locks = [];
  for (let i = 0; i < participants.length && locks.length < 20; i += 4) {
    const person = participants[i];
    const candidateOffer = person.wishes[3];
    const candidateCourse = workshops.find((course) => course.offerId === candidateOffer && eligible(person, course) && course.id !== person.fixed);
    if (candidateCourse) {
      locks.push({ personId: person.id, workshopId: candidateCourse.id, reason: "Beispielsperrung" });
    }
  }

  return {
    name: "Beispielveranstaltung",
    settings: { allowOutside: false, defaultMode: "Pflicht", balanceWeight: 10, balanceThreshold: 10, cohortMin: 0, rules: [{ id: "R1", type: "gradeForm", min: 2, mode: "preferred", enabled: true }] },
    workshops,
    participants,
    locks,
  };
}
