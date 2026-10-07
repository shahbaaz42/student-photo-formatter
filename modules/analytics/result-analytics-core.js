(function (root) {
  "use strict";

  const ALIASES = {
    roll: ["rollno", "rollnumber", "roll", "sno", "serialnumber"],
    admission: ["admno", "admnno", "admissionno", "admissionnumber", "admissionnum", "admnnumber", "admn"],
    name: ["studentname", "nameofthestudent", "name"],
    className: ["class", "classname", "grade", "gradeclass", "classsection", "classandsection"],
    section: ["section", "sec"],
    gender: ["gender", "sex"],
    house: ["house"]
  };
  const normalizeHeader = value => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const columnFor = (headers, aliases) => headers.findIndex(header => aliases.includes(normalizeHeader(header)));
  const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const joinRowNumbers = rows => rows.length < 2 ? String(rows[0]) : `${rows.slice(0, -1).join(", ")} & ${rows.at(-1)}`;

  function optionalMetadataWarnings(structure) {
    return [["gender", "Gender"], ["roll", "Roll No"]].map(([key, label]) => {
      const column = structure.columns[key];
      if (column < 0) return `${label} column is not available in this file.`;
      const rows = structure.dataRows.map((row, index) => !String(row[column] ?? "").trim() ? structure.dataRowNumbers[index] : null).filter(Boolean);
      return rows.length ? `${label} is missing in Excel ${rows.length === 1 ? "row" : "rows"} ${joinRowNumbers(rows)}.` : null;
    }).filter(Boolean);
  }

  function workbookRowError(excelRow) {
    const error = new Error(`Please check the details in Excel row ${excelRow}.`);
    error.code = "WORKBOOK_ROW_VALIDATION";
    error.excelRow = excelRow;
    return error;
  }

  function classMissingError(excelRow) {
    const error = new Error(`Class & Section is missing in Excel row ${excelRow}.`);
    error.code = "WORKBOOK_ROW_VALIDATION";
    error.excelRow = excelRow;
    return error;
  }

  function duplicateAdmissionError(firstRow, duplicateRow) {
    const error = new Error(`Duplicate ADMNO found in Excel rows ${firstRow} and ${duplicateRow}.`);
    error.code = "WORKBOOK_ROW_VALIDATION";
    error.excelRow = duplicateRow;
    error.conflictingExcelRows = [firstRow, duplicateRow];
    return error;
  }

  function duplicateSubjectError(subjectName) {
    const error = new Error(`Duplicate subject header found: "${subjectName}". Subject names must be unique.`);
    error.code = "WORKBOOK_STRUCTURE_VALIDATION";
    error.subject = subjectName;
    return error;
  }

  function createLatestLoadGuard() {
    let latestLoadId = 0;
    return Object.freeze({
      begin: () => ++latestLoadId,
      isCurrent: loadId => loadId === latestLoadId
    });
  }

  function detectResultStructure(rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error("The workbook is empty. Add a header row and student results.");
    const headerIndex = rows.findIndex(row => Array.isArray(row) && row.some(cell => ALIASES.name.includes(normalizeHeader(cell))));
    if (headerIndex < 0) throw new Error("Missing Student Name. Use a recognizable Student Name column heading.");
    const headers = rows[headerIndex].map(value => String(value ?? "").trim());
    const columns = Object.fromEntries(Object.entries(ALIASES).map(([key, aliases]) => [key, columnFor(headers, aliases)]));
    if (columns.admission < 0) throw new Error("Missing Admission Number. Add an Admission Number column to the workbook.");
    if (columns.className < 0) throw new Error("Missing Class & Section. Add a Class & Section column.");
    const subjects = headers.map((name, index) => ({ name, index })).filter(({ name, index }) => name && index > columns.name && index < columns.className);
    const studentRows = rows.map((row, index) => ({ row, excelRow: index + 1 })).slice(headerIndex + 1).filter(({ row }) =>
      Array.isArray(row) && String(row[columns.admission] ?? "").trim() !== ""
    );
    const dataRows = studentRows.map(entry => entry.row), dataRowNumbers = studentRows.map(entry => entry.excelRow);
    if (!dataRows.length) throw new Error("The workbook contains no student rows.");
    const invalidMetadataIndex = dataRows.findIndex(row => !String(row[columns.name] ?? "").trim() || !String(row[columns.className] ?? "").trim());
    if (invalidMetadataIndex >= 0) {
      const excelRow = dataRowNumbers[invalidMetadataIndex];
      if (!String(dataRows[invalidMetadataIndex][columns.className] ?? "").trim()) throw classMissingError(excelRow);
      throw workbookRowError(excelRow);
    }
    const admissionRows = new Map();
    dataRows.forEach((row, index) => {
      const admission = String(row[columns.admission]).trim();
      if (admissionRows.has(admission)) throw duplicateAdmissionError(admissionRows.get(admission), dataRowNumbers[index]);
      admissionRows.set(admission, dataRowNumbers[index]);
    });
    if (!subjects.length) throw new Error("No subject columns were detected.");
    const subjectNames = new Set();
    subjects.forEach(subject => {
      if (subjectNames.has(subject.name)) throw duplicateSubjectError(subject.name);
      subjectNames.add(subject.name);
    });
    const classes = [...new Set(dataRows.map(row => String(row[columns.className]).trim()))];
    return { headerIndex, headers, columns, subjects, dataRows, dataRowNumbers, classes };
  }

  function validateRules(maximumMarks, passMark) {
    const maximum = Number(maximumMarks), pass = Number(passMark);
    if (!Number.isInteger(maximum) || maximum <= 0) throw new Error("Maximum Marks must be a positive whole number.");
    if (!Number.isInteger(pass) || pass <= 0 || pass > maximum) throw new Error("Pass Mark must be a positive whole number and not exceed Maximum Marks.");
    return { maximumMarks: maximum, passMark: pass };
  }

  function deriveStudents(structure, configuration) {
    const rules = validateRules(configuration.maximumMarks, configuration.passMark);
    return structure.dataRows.map((row, sourceIndex) => {
      const excelRow = structure.dataRowNumbers?.[sourceIndex] ?? structure.headerIndex + sourceIndex + 2;
      if (!String(row[structure.columns.name] ?? "").trim()) throw workbookRowError(excelRow);
      if (!String(row[structure.columns.className] ?? "").trim()) throw classMissingError(excelRow);
      const marks = structure.subjects.map(subject => {
        const raw = row[subject.index];
        const normalized = typeof raw === "string" ? raw.trim() : raw;
        const mark = Number(normalized);
        if (normalized === "" || normalized == null || typeof normalized === "boolean" || !Number.isFinite(mark) || mark < 0 || mark > rules.maximumMarks) {
          throw workbookRowError(excelRow);
        }
        return Math.round(mark);
      });
      const totalMarks = marks.reduce((sum, mark) => sum + mark, 0);
      const failedSubjects = marks.filter(mark => mark < rules.passMark).length;
      const absentSubjects = marks.filter(mark => mark === 0).length;
      const hasNonZeroFail = marks.some(mark => mark > 0 && mark < rules.passMark);
      const allPass = marks.every(mark => mark >= rules.passMark);
      const result = allPass ? "PASS" : hasNonZeroFail ? "FAIL" : absentSubjects > 0 ? "ABSENT" : null;
      return {
        sourceIndex,
        roll: structure.columns.roll < 0 ? sourceIndex + 1 : row[structure.columns.roll],
        admission: structure.columns.admission < 0 ? "" : row[structure.columns.admission],
        name: String(row[structure.columns.name]).trim(),
        className: String(row[structure.columns.className]).trim(),
        section: structure.columns.section < 0 ? "" : String(row[structure.columns.section] ?? "").trim(),
        gender: structure.columns.gender < 0 ? "" : String(row[structure.columns.gender] ?? "").trim(),
        house: structure.columns.house < 0 ? "" : String(row[structure.columns.house] ?? "").trim(),
        marks,
        totalMarks,
        percentage: round2(totalMarks / (rules.maximumMarks * structure.subjects.length) * 100),
        failedSubjects,
        absentSubjects,
        result
      };
    });
  }

  function filterStudents(students, filters = {}) {
    return students.filter(student =>
      (!filters.className || filters.className === "All" || student.className === filters.className) &&
      (!filters.gender || filters.gender === "All" || student.gender === filters.gender)
    );
  }

  function percentageBand(percentage) {
    const value = Number(percentage);
    if (!Number.isFinite(value) || value < 0) return null;
    const start = value >= 100 ? 90 : Math.min(90, Math.floor(value / 10) * 10);
    return `${start}-${start + 10}`;
  }

  function rankStudents(students, direction = "desc", limit = 10) {
    const ordered = [...students].sort((a, b) => {
      const marksOrder = direction === "asc" ? a.totalMarks - b.totalMarks : b.totalMarks - a.totalMarks;
      return marksOrder || String(a.name).localeCompare(String(b.name)) || a.sourceIndex - b.sourceIndex;
    });
    let prior = null, rank = 0;
    return ordered.map((student, index) => {
      if (student.totalMarks !== prior) rank = index + 1;
      prior = student.totalMarks;
      return { ...student, rank };
    }).filter(student => student.rank <= limit);
  }

  function summarize(students, subjects) {
    const totalStudents = students.length;
    const passed = students.filter(student => student.result === "PASS").length;
    const present = students.filter(student => student.absentSubjects === 0).length;
    const average = key => totalStudents ? students.reduce((sum, student) => sum + student[key], 0) / totalStudents : 0;
    const subjectAverages = subjects.map((subject, index) => {
      const marks = students.map(student => student.marks[index]).filter(mark => mark > 0);
      return { subject: subject.name, value: marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : 0, count: marks.length };
    });
    const resultDistribution = ["PASS", "FAIL", "ABSENT"].map(result => ({ result, count: students.filter(s => s.result === result).length }));
    const ranges = Array.from({ length: 10 }, (_, index) => ({ label: `${index * 10}-${index * 10 + 10}`, count: 0 }));
    students.forEach(student => { const band = percentageBand(student.percentage); const range = ranges.find(item => item.label === band); if (range) range.count++; });
    return {
      totalStudents, passed, passPercentage: totalStudents ? passed / totalStudents * 100 : 0,
      present, presentPercentage: totalStudents ? present / totalStudents * 100 : 0,
      averageMarks: average("totalMarks"), averagePercentage: average("percentage"),
      subjectAverages, resultDistribution, ranges,
      top: rankStudents(students, "desc"), bottom: rankStudents(students, "asc")
    };
  }

  const api = {
    ALIASES,
    normalizeHeader,
    createLatestLoadGuard,
    detectResultStructure,
    validateRules,
    deriveStudents,
    optionalMetadataWarnings,
    filterStudents,
    percentageBand,
    rankStudents,
    summarize,
    round2,
    workbookRowError
  };

  if (typeof module !== "undefined") module.exports = api;
  root.ResultAnalyticsCore = api;
  root.AcadPulseResultCore = api; // backwards-compatibility alias
})(typeof globalThis !== "undefined" ? globalThis : this);
