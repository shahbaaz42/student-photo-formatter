(function (root) {
  "use strict";

  const round2 = value => {
    const number = Number(value);
    const scaled = number * 100;
    const adjustment = Number.EPSILON * Math.max(1, Math.abs(scaled));
    return Math.round(scaled + adjustment) / 100;
  };

  function filterPopulation(students, filters = {}) {
    const hasClass = filters.className !== undefined && filters.className !== null && filters.className !== "";
    const hasGender = filters.gender !== undefined && filters.gender !== null && filters.gender !== "";
    return students.filter(student =>
      (!hasClass || student.className === filters.className) &&
      (!hasGender || student.gender === filters.gender)
    );
  }

  function rankPopulation(students) {
    const ordered = [...students].sort((a, b) => b.totalMarks - a.totalMarks || String(a.name).localeCompare(String(b.name)) || a.sourceIndex - b.sourceIndex);
    let prior = null;
    let rank = 0;
    return ordered.map((student, index) => {
      if (student.totalMarks !== prior) rank = index + 1;
      prior = student.totalMarks;
      return { student, rank };
    });
  }

  function subjectStatus(mark, passMark) {
    if (mark === 0) return "ABSENT";
    return mark >= passMark ? "PASS" : "FAIL";
  }

  function presentAverage(students, subjectIndex) {
    const values = students.map(student => student.marks[subjectIndex]).filter(mark => mark > 0);
    if (!values.length) return null;
    return round2(values.reduce((sum, mark) => sum + mark, 0) / values.length);
  }

  function profileFor(student, population, subjects, configuration) {
    if (!student) return null;
    const maximum = Number(configuration.maximumMarks);
    const passMark = Number(configuration.passMark);
    const ranked = rankPopulation(population);
    const rankEntry = ranked.find(entry => String(entry.student.admission) === String(student.admission));
    const lowerCount = population.filter(item => item.totalMarks < student.totalMarks).length;
    const percentile = population.length <= 1 ? 100 : round2(lowerCount / (population.length - 1) * 100);
    const subjectRows = subjects.map((subject, index) => {
      const mark = student.marks[index];
      const average = presentAverage(population, index);
      return {
        subject: subject.name,
        mark,
        percentage: round2(mark / maximum * 100),
        status: subjectStatus(mark, passMark),
        populationAverage: average,
        difference: mark > 0 && average != null ? round2(mark - average) : null
      };
    });
    const presentRows = subjectRows.filter(row => row.mark > 0);
    const strongest = presentRows.length ? [...presentRows].sort((a, b) => b.percentage - a.percentage || a.subject.localeCompare(b.subject))[0] : null;
    const lowest = presentRows.length ? [...presentRows].sort((a, b) => a.percentage - b.percentage || a.subject.localeCompare(b.subject))[0] : null;
    const failed = subjectRows.filter(row => row.status === "FAIL");
    const absent = subjectRows.filter(row => row.status === "ABSENT");
    const aboveAverage = subjectRows.filter(row => row.difference != null && row.difference > 0).length;
    const belowAverage = subjectRows.filter(row => row.difference != null && row.difference < 0).length;
    return {
      admission: student.admission,
      roll: student.roll,
      name: student.name,
      className: student.className,
      gender: student.gender,
      house: student.house || "",
      result: student.result,
      totalMarks: student.totalMarks,
      maximumTotal: maximum * subjects.length,
      percentage: student.percentage,
      rank: rankEntry ? rankEntry.rank : null,
      populationSize: population.length,
      percentile,
      passedSubjects: subjectRows.filter(row => row.status === "PASS").length,
      failedSubjects: failed.length,
      absentSubjects: absent.length,
      strongest,
      lowest,
      failedSubjectNames: failed.map(row => row.subject),
      absentSubjectNames: absent.map(row => row.subject),
      aboveAverage,
      belowAverage,
      subjectRows
    };
  }

  function parseRange(range) {
    if (!range) return null;
    const match = String(range).match(/^(\d+)-(\d+)$/);
    if (!match) return null;
    return { low: Number(match[1]), high: Number(match[2]) };
  }

  function selections(value) {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
    return String(value ?? "").split("|").map(item => item.trim()).filter(Boolean);
  }

  function inAnyRange(value, ranges) {
    return ranges.some(range => value >= range.low && (range.high >= 100 ? value <= range.high : value < range.high));
  }

  function detailedRows(population, subjects, configuration, filters = {}) {
    const maximum = Number(configuration.maximumMarks);
    const resultSelections = selections(filters.result);
    const subjectSelections = selections(filters.subject);
    const ranges = selections(filters.markRange).map(parseRange).filter(Boolean);
    const subjectIndexes = subjectSelections.map(subjectName => subjects.findIndex(subject => subject.name === subjectName)).filter(index => index >= 0);
    const query = String(filters.query || "").trim().toLowerCase();

    return population.filter(student => {
      if (resultSelections.length && !resultSelections.includes(student.result)) return false;
      if (query && !String(student.name).toLowerCase().includes(query) && !String(student.admission).toLowerCase().includes(query)) return false;
      if (ranges.length) {
        if (subjectIndexes.length) {
          const matchesSelectedSubject = subjectIndexes.some(index => {
            const mark = student.marks[index];
            if (mark === 0) return false;
            return inAnyRange(round2(mark / maximum * 100), ranges);
          });
          if (!matchesSelectedSubject) return false;
        } else if (!inAnyRange(student.percentage, ranges)) return false;
      }
      return true;
    }).map(student => ({
      admission: student.admission,
      roll: student.roll,
      name: student.name,
      className: student.className,
      gender: student.gender,
      marks: student.marks,
      totalMarks: student.totalMarks,
      percentage: student.percentage,
      result: student.result
    }));
  }

  function analyze(students, subjects, configuration, globalFilters = {}, selectedAdmission = null, localFilters = {}) {
    const maximum = Number(configuration.maximumMarks);
    const pass = Number(configuration.passMark);
    if (!Number.isInteger(maximum) || maximum <= 0) throw new Error("Maximum Marks must be a positive whole number.");
    if (!Number.isInteger(pass) || pass <= 0 || pass > maximum) throw new Error("Pass Mark must be a positive whole number and not exceed Maximum Marks.");
    const population = filterPopulation(students, globalFilters);
    const selected = selectedAdmission == null ? population[0] || null : population.find(student => String(student.admission) === String(selectedAdmission)) || null;
    return {
      population,
      selected,
      profile: profileFor(selected, population, subjects, { maximumMarks: maximum, passMark: pass }),
      detailedRows: detailedRows(population, subjects, { maximumMarks: maximum, passMark: pass }, localFilters)
    };
  }

  const api = Object.freeze({
    round2,
    filterPopulation,
    rankPopulation,
    subjectStatus,
    presentAverage,
    profileFor,
    parseRange,
    selections,
    inAnyRange,
    detailedRows,
    analyze
  });

  if (typeof module !== "undefined") module.exports = api;
  root.ResultAnalyticsPage3 = api;
  root.AcadPulsePage3Analytics = api; // alias for backwards compatibility
})(typeof globalThis !== "undefined" ? globalThis : this);
