(function (root) {
  "use strict";

  const ADMISSION_ALIASES = ["admno", "admnno", "admissionno", "admissionnumber", "admissionnum", "admnnumber", "admn"];
  const METADATA_ALIASES = new Set(["rollno", "rollnumber", "roll", "sno", "serialnumber", ...ADMISSION_ALIASES, "studentname", "nameofthestudent", "name", "house", "class", "section", "gender", "sex"]);

  const normalizeHeader = value => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const findColumn = (headers, aliases) => headers.findIndex(h => aliases.includes(normalizeHeader(h)));

  function pointsForPercentage(percentage) {
    if (percentage === null || percentage === undefined || percentage === "" || !Number.isFinite(Number(percentage))) return null;
    const value = Number(percentage);
    if (value >= 95) return 5;
    if (value >= 81) return 3;
    if (value >= 61) return 2;
    return 0;
  }

  function percentageForMark(mark, maximum) {
    if (mark === null || mark === undefined || mark === "" || typeof mark === "boolean") return null;
    if (!Number.isFinite(Number(mark)) || !Number.isFinite(Number(maximum)) || Number(maximum) <= 0) return null;
    return Number(mark) / Number(maximum) * 100;
  }

  function normalizeHouse(value) {
    const clean = String(value ?? "").trim().replace(/\s+/g, " ");
    if (!clean) return "Unassigned";
    const core = clean.replace(/^house\s+of\s+/i, "").replace(/\s+house$/i, "").trim();
    return `House of ${core.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}`;
  }

  function detectStructure(rows) {
    if (!Array.isArray(rows) || rows.length < 2) throw new Error("The workbook does not contain a header and student rows.");
    const headerIndex = rows.findIndex(row => Array.isArray(row) && row.some(cell => ["studentname", "nameofthestudent", "name"].includes(normalizeHeader(cell))));
    if (headerIndex < 0) throw new Error("Could not find a Student Name column. Check the workbook headers.");
    const headers = rows[headerIndex].map(v => String(v ?? "").trim());
    const nameIndex = findColumn(headers, ["studentname", "nameofthestudent", "name"]);
    const houseIndex = findColumn(headers, ["house"]);
    if (houseIndex < 0) throw new Error("Could not find a House column.");
    const dataRows = rows.slice(headerIndex + 1).filter(row => String(row[nameIndex] ?? "").trim());
    const subjects = headers.map((name, index) => ({ name, index })).filter(({ name, index }) => name && !METADATA_ALIASES.has(normalizeHeader(name)) && dataRows.some(row => row[index] === 0 || (row[index] !== "" && row[index] != null && Number.isFinite(Number(row[index])))));
    if (!subjects.length) throw new Error("No numeric subject columns were detected.");
    return {
      headers,
      headerIndex,
      dataRows,
      subjects,
      columns: {
        name: nameIndex,
        house: houseIndex,
        roll: findColumn(headers, ["rollno", "rollnumber", "roll", "sno", "serialnumber"]),
        admission: findColumn(headers, ADMISSION_ALIASES)
      }
    };
  }

  function buildScoreboard(structure, maximums) {
    const houses = {};
    structure.dataRows.forEach((row, rowIndex) => {
      const house = normalizeHouse(row[structure.columns.house]);
      const results = structure.subjects.map(subject => {
        const raw = row[subject.index];
        const percentage = percentageForMark(raw, maximums[subject.name]);
        return {
          subject: subject.name,
          raw,
          percentage,
          points: pointsForPercentage(percentage),
          invalid: raw !== "" && raw != null && percentage === null
        };
      });
      const validPoints = results.filter(r => r.points !== null).map(r => r.points);
      const student = {
        roll: structure.columns.roll < 0 ? rowIndex + 1 : row[structure.columns.roll],
        admission: structure.columns.admission < 0 ? "" : row[structure.columns.admission],
        name: row[structure.columns.name],
        house,
        results,
        total: validPoints.reduce((a, b) => a + b, 0),
        average: validPoints.length ? validPoints.reduce((a, b) => a + b, 0) / validPoints.length : null
      };
      (houses[house] ||= []).push(student);
    });
    return houses;
  }

  function resetScoreboardState(state) {
    state.houses = null;
    state.maximums = null;
    state.generatedFor = null;
    return state;
  }

  const round2 = value => value == null ? null : Math.round((Number(value) + Number.EPSILON) * 100) / 100;

  function buildReportTitle(details, houseWise = false) {
    return [details.className, details.section, details.exam, houseWise ? "House" : null, "Scoreboard"].filter(Boolean).join("_").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
  }

  const SUITE_FOOTER = "Teacher Utility Suite · Scoreboard Generator";

  function houseStats(students) {
    const total = students.reduce((sum, student) => sum + student.total, 0);
    return {
      students: students.length,
      total,
      average: students.length ? round2(total / students.length) : 0
    };
  }

  function buildConsolidatedWorkbook(structure, houses, details, xlsx) {
    const wb = xlsx.utils.book_new(), rows = [], merges = [], styles = {}, rowHeights = [], subjectCount = structure.subjects.length, lastColumn = subjectCount * 2 + 4;
    const ref = (row, column) => {
      let name = "";
      for (let n = column + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode((n - 1) % 26 + 65) + name;
      return `${name}${row + 1}`;
    };
    const styleRow = (row, style, from = 0, to = lastColumn) => {
      for (let c = from; c <= to; c++) styles[ref(row, c)] = style;
    };
    const addMerged = (text, style, height = 22) => {
      const row = rows.length;
      rows.push([text]);
      merges.push({ s: { r: row, c: 0 }, e: { r: row, c: lastColumn } });
      styleRow(row, style);
      rowHeights[row] = { hpt: height };
    };

    addMerged("Teacher Utility Suite", "reportTitle", 28);
    addMerged("Scoreboard Generator", "subtitle", 18);
    addMerged(`${details.exam} – Scoreboard`, "reportHeading", 24);
    addMerged(`Class ${details.className} – Section ${details.section}`, "subtitle", 20);
    rows.push([]);

    for (const [house, students] of Object.entries(houses)) {
      addMerged(house, "houseHeading", 24);
      const headerRow = rows.length, top = ["Roll No", "Admission No", "Student Name"], sub = ["", "", ""];
      structure.subjects.forEach(subject => { top.push(subject.name, ""); sub.push("Percentage", "Points"); });
      top.push("Total Points", "Average Points"); sub.push("", "");
      rows.push(top, sub);
      [0, 1, 2, lastColumn - 1, lastColumn].forEach(c => merges.push({ s: { r: headerRow, c }, e: { r: headerRow + 1, c } }));
      structure.subjects.forEach((_, i) => merges.push({ s: { r: headerRow, c: 3 + i * 2 }, e: { r: headerRow, c: 4 + i * 2 } }));
      styleRow(headerRow, "tableHeader"); styleRow(headerRow + 1, "tableSubheader"); rowHeights[headerRow] = { hpt: 28 }; rowHeights[headerRow + 1] = { hpt: 22 };

      students.forEach(student => {
        const row = rows.length, values = [student.roll, student.admission, student.name];
        student.results.forEach(result => values.push(round2(result.percentage) ?? "", result.points ?? ""));
        values.push(student.total, round2(student.average) ?? "");
        rows.push(values);
        styles[ref(row, 2)] = "studentName";
        for (let c = 0; c <= lastColumn; c++) if (c !== 2) styles[ref(row, c)] = (c >= 3 && c < lastColumn - 1 && c % 2 === 1) || c === lastColumn ? "decimal" : "number";
      });

      const totals = houseStats(students), subjectTotals = structure.subjects.map((_, i) => students.reduce((sum, s) => sum + (s.results[i].points ?? 0), 0)), validCounts = structure.subjects.map((_, i) => students.filter(s => s.results[i].points !== null).length);
      let row = rows.length, values = ["Subject Total Points", "", "Student count", ...structure.subjects.flatMap((_, i) => ["", subjectTotals[i]]), totals.total, ""];
      rows.push(values); merges.push({ s: { r: row, c: 0 }, e: { r: row, c: 1 } }); styleRow(row, "totalRow");

      row = rows.length; values = ["Subject Average Points", "", students.length, ...structure.subjects.flatMap((_, i) => ["", validCounts[i] ? round2(subjectTotals[i] / validCounts[i]) : ""]), "", totals.average];
      rows.push(values); merges.push({ s: { r: row, c: 0 }, e: { r: row, c: 1 } }); styleRow(row, "averageRow");
      rows.push([], []);
    }

    addMerged("HOUSE SUMMARY", "summaryTitle", 26);
    const summaryHeader = rows.length;
    rows.push(["House", "Students", "Total Points", "Average Points per Student"]);
    merges.push({ s: { r: summaryHeader, c: 3 }, e: { r: summaryHeader, c: lastColumn } });
    styleRow(summaryHeader, "summaryHeader");

    Object.entries(houses).forEach(([house, students]) => {
      const row = rows.length, s = houseStats(students);
      rows.push([house, s.students, s.total, s.average]);
      merges.push({ s: { r: row, c: 3 }, e: { r: row, c: lastColumn } });
      styleRow(row, "summaryData");
    });

    rows.push([]);
    addMerged(SUITE_FOOTER, "developerCredit", 18);

    const ws = xlsx.utils.aoa_to_sheet(rows);
    ws["!merges"] = merges;
    ws["!styles"] = styles;
    ws["!rows"] = rowHeights;
    ws["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 28 }, ...structure.subjects.flatMap(() => [{ wch: 14 }, { wch: 10 }]), { wch: 14 }, { wch: 16 }];
    ws["!freeze"] = { xSplit: 3, ySplit: 5 };
    ws["!printArea"] = `A1:${ref(rows.length - 1, lastColumn)}`;
    ws["!pageSetup"] = { orientation: "landscape", fitToWidth: 1, fitToHeight: 0 };
    xlsx.utils.book_append_sheet(wb, ws, "Scoreboard");
    return wb;
  }

  const escapeHtml = value => String(value ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = value => value == null ? '<span class="blank">—</span>' : Number(value.toFixed(2)).toString();

  function printableReport(houses, structure, details, selectedHouse = null) {
    const entries = selectedHouse ? [selectedHouse] : Object.entries(houses);
    const table = (house, students) => {
      const totals = houseStats(students), subjectTotals = structure.subjects.map((_, i) => students.reduce((sum, s) => sum + (s.results[i].points ?? 0), 0));
      return `<section class="pdf-house"><h2>${escapeHtml(house)}</h2><p class="section-meta">Teacher Utility Suite · ${escapeHtml(details.exam)} · Class ${escapeHtml(details.className)} · Section ${escapeHtml(details.section)}</p><table><thead><tr><th rowspan="2">Roll No</th><th rowspan="2">Admission No</th><th rowspan="2">Student Name</th>${structure.subjects.map(s => `<th colspan="2">${escapeHtml(s.name)}</th>`).join("")}<th rowspan="2">Total Points</th><th rowspan="2">Average Points</th></tr><tr>${structure.subjects.map(() => "<th>Percentage</th><th>Points</th>").join("")}</tr></thead><tbody>${students.map(s => `<tr><td>${escapeHtml(s.roll)}</td><td>${escapeHtml(s.admission)}</td><td class="left">${escapeHtml(s.name)}</td>${s.results.map(r => `<td>${r.percentage == null ? "—" : round2(r.percentage)}</td><td>${r.points ?? "—"}</td>`).join("")}<td>${s.total}</td><td>${round2(s.average) ?? "—"}</td></tr>`).join("")}<tr class="total"><td colspan="3">Subject Total Points</td>${subjectTotals.map(v => `<td></td><td>${v}</td>`).join("")}<td>${totals.total}</td><td></td></tr><tr class="total"><td colspan="3">Subject Average Points · ${students.length} students</td>${subjectTotals.map((v, i) => { const n = students.filter(s => s.results[i].points !== null).length; return `<td></td><td>${n ? round2(v / n) : "—"}</td>`; }).join("")}<td></td><td>${totals.average}</td></tr></tbody></table></section>`;
    };
    const summary = !selectedHouse ? `<section class="pdf-house summary"><h2>HOUSE SUMMARY</h2><table><thead><tr><th>House</th><th>Students</th><th>Total Points</th><th>Average Points per Student</th></tr></thead><tbody>${Object.entries(houses).map(([h, s]) => { const x = houseStats(s); return `<tr><td class="left">${escapeHtml(h)}</td><td>${x.students}</td><td>${x.total}</td><td>${x.average}</td></tr>`; }).join("")}</tbody></table></section>` : "";
    return `<!doctype html><html><head><meta charset="utf-8"><title>${buildReportTitle(details, Boolean(selectedHouse))}</title><style>@page{size:landscape;margin:0}*{box-sizing:border-box}body{margin:0;padding:10mm 10mm 14mm;font:10px Arial,sans-serif;color:#142b25}header{text-align:center;margin-bottom:16px}h1{margin:0;font-size:22px}header p{margin:3px}.pdf-house{break-before:page;page-break-before:always}.pdf-house:first-of-type{break-before:auto;page-break-before:auto}h2{padding:7px;margin-bottom:3px;background:#d9eee5;text-align:center;font-size:14px}.section-meta{text-align:center;margin:0 0 7px;color:#52645d}table{width:100%;border-collapse:collapse;page-break-inside:auto}thead{display:table-header-group}tr{page-break-inside:avoid}th,td{border:1px solid #71817b;padding:4px;text-align:center}th{background:#142b25;color:white}.left{text-align:left}.total td{background:#edf4f1;font-weight:bold}.summary{font-size:11px}.print-footer{position:fixed;right:10mm;bottom:4mm;left:10mm;text-align:center;color:#60706a;font-size:8px}</style></head><body><header><h1>Teacher Utility Suite</h1><p>Scoreboard Generator</p><strong>${escapeHtml(details.exam)} – Scoreboard</strong><p>Class ${escapeHtml(details.className)} – Section ${escapeHtml(details.section)}</p></header><footer class="print-footer">${SUITE_FOOTER}</footer>${entries.map(([h, s]) => table(h, s)).join("")}${summary}<script>window.onload=()=>window.print()<\/script></body></html>`;
  }

  const api = {
    ADMISSION_ALIASES,
    METADATA_ALIASES,
    pointsForPercentage,
    percentageForMark,
    normalizeHouse,
    detectStructure,
    buildScoreboard,
    normalizeHeader,
    resetScoreboardState,
    round2,
    buildReportTitle,
    buildConsolidatedWorkbook,
    houseStats,
    printableReport,
    fmt,
    escapeHtml
  };

  if (typeof module !== "undefined") module.exports = api;
  root.ScoreboardGenerator = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
