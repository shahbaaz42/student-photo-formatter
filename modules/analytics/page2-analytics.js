(function (root) {
  "use strict";

  const DISTRIBUTION_BANDS = Object.freeze(Array.from({ length: 10 }, (_, index) => ({
    label: `${index * 10}-${index * 10 + 10}`,
    minimum: index * 10,
    maximum: index * 10 + 10
  })));

  const round2 = value => {
    const number = Number(value);
    const scaled = number * 100;
    const adjustment = Number.EPSILON * Math.max(1, Math.abs(scaled));
    return Math.round(scaled + adjustment) / 100;
  };
  const mean = values => values.length ? round2(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const compareToppers = (a, b) => String(a.name).localeCompare(String(b.name)) || String(a.className).localeCompare(String(b.className));

  function filterPopulation(students, filters = {}) {
    const hasClassFilter = filters.className !== undefined && filters.className !== null && filters.className !== "";
    const hasGenderFilter = filters.gender !== undefined && filters.gender !== null && filters.gender !== "";
    return students.filter(student =>
      (!hasClassFilter || student.className === filters.className) &&
      (!hasGenderFilter || student.gender === filters.gender)
    );
  }

  function distributionFor(marks, maximumMarks = 100) {
    const maximum = Number(maximumMarks);
    if (!Number.isFinite(maximum) || maximum <= 0) throw new Error("A positive Maximum Marks value is required.");
    const counts = Object.fromEntries(DISTRIBUTION_BANDS.map(band => [band.label, 0]));
    marks.filter(mark => mark > 0).forEach(mark => {
      const percentage = mark / maximum * 100;
      const index = percentage >= 100 ? 9 : Math.min(9, Math.floor(percentage / 10));
      counts[DISTRIBUTION_BANDS[index].label]++;
    });
    return counts;
  }

  function subjectPerformance(students, subjects, passMark, maximumMarks = 100) {
    return subjects.map((subject, subjectIndex) => {
      const marks = students.map(student => student.marks[subjectIndex]);
      const presentMarks = marks.filter(mark => mark > 0);
      const passCount = presentMarks.filter(mark => mark >= passMark).length;
      const failCount = presentMarks.length - passCount;
      const highestMark = presentMarks.length ? presentMarks.reduce((highest, mark) => mark > highest ? mark : highest, presentMarks[0]) : null;
      const lowestMark = presentMarks.length ? presentMarks.reduce((lowest, mark) => mark < lowest ? mark : lowest, presentMarks[0]) : null;
      const toppers = highestMark == null ? [] : students
        .filter(student => student.marks[subjectIndex] === highestMark)
        .map(student => ({ name: student.name, className: student.className }))
        .sort(compareToppers);
      return {
        subject: subject.name,
        studentCount: students.length,
        presentCount: presentMarks.length,
        absentCount: marks.length - presentMarks.length,
        passCount,
        failCount,
        passPercentage: presentMarks.length ? round2(passCount / presentMarks.length * 100) : null,
        averageMark: mean(presentMarks),
        highestMark,
        lowestMark,
        distribution: distributionFor(presentMarks, maximumMarks),
        toppers,
        supportCount: failCount
      };
    });
  }

  function overallToppers(students, subjects) {
    if (!students.length) return [];
    const highestTotal = students.reduce((highest, student) => student.totalMarks > highest ? student.totalMarks : highest, students[0].totalMarks);
    return students.filter(student => student.totalMarks === highestTotal).map(student => ({
      name: student.name,
      className: student.className,
      totalMarks: student.totalMarks,
      percentage: student.percentage,
      subjectMarks: Object.fromEntries(subjects.map((subject, index) => [subject.name, student.marks[index]]))
    })).sort(compareToppers);
  }

  function groupByClass(students) {
    const groups = new Map();
    students.forEach(student => {
      if (!groups.has(student.className)) groups.set(student.className, []);
      groups.get(student.className).push(student);
    });
    return groups;
  }

  function classOverallPerformance(students) {
    return [...groupByClass(students)].map(([className, classStudents]) => ({
      className,
      studentCount: classStudents.length,
      passed: classStudents.filter(student => student.result === "PASS").length,
      failed: classStudents.filter(student => student.result === "FAIL").length,
      absentResult: classStudents.filter(student => student.result === "ABSENT").length,
      averageMarks: mean(classStudents.map(student => student.totalMarks)),
      averagePercentage: mean(classStudents.map(student => student.percentage))
    }));
  }

  function classSubjectMatrices(students, subjects, passMark) {
    const averages = [], passPercentages = [], failureCounts = [];
    for (const [className, classStudents] of groupByClass(students)) {
      const averageEntries = [], passEntries = [], failureEntries = [];
      subjects.forEach((subject, index) => {
        const present = classStudents.map(student => student.marks[index]).filter(mark => mark > 0);
        const passed = present.filter(mark => mark >= passMark).length;
        averageEntries.push([subject.name, mean(present)]);
        passEntries.push([subject.name, present.length ? round2(passed / present.length * 100) : null]);
        failureEntries.push([subject.name, present.length - passed]);
      });
      averages.push({ className, values: Object.fromEntries(averageEntries) });
      passPercentages.push({ className, values: Object.fromEntries(passEntries) });
      failureCounts.push({ className, values: Object.fromEntries(failureEntries) });
    }
    return { averages, passPercentages, failureCounts };
  }

  function analyze(students, subjects, configuration, filters = {}) {
    const passMark = Number(configuration.passMark);
    const maximumMarks = Number(configuration.maximumMarks);
    if (!Number.isInteger(passMark) || passMark <= 0) throw new Error("Pass Mark must be a positive whole number.");
    if (!Number.isInteger(maximumMarks) || maximumMarks <= 0) throw new Error("Maximum Marks must be a positive whole number.");
    if (passMark > maximumMarks) throw new Error("Pass Mark cannot exceed Maximum Marks.");
    const population = filterPopulation(students, filters);
    const subjectSummary = subjectPerformance(population, subjects, passMark, maximumMarks);
    return {
      population,
      subjectSummary,
      subjectToppers: subjectSummary.map(({ subject, highestMark, toppers }) => ({ subject, highestMark, toppers })),
      overallToppers: overallToppers(population, subjects),
      supportBySubject: subjectSummary.map(({ subject, supportCount }) => ({ subject, count: supportCount })),
      classPerformance: classOverallPerformance(population),
      matrices: classSubjectMatrices(population, subjects, passMark)
    };
  }

  const api = {
    DISTRIBUTION_BANDS,
    filterPopulation,
    distributionFor,
    subjectPerformance,
    overallToppers,
    classOverallPerformance,
    classSubjectMatrices,
    analyze
  };

  if (typeof module !== "undefined") module.exports = api;
  root.ResultAnalyticsPage2 = api;
  root.AcadPulsePage2Analytics = api; // alias for backwards compatibility
})(typeof globalThis !== "undefined" ? globalThis : this);
