(function (root) {
  "use strict";
  if (typeof document === "undefined") return;

  const core = window.ResultAnalyticsCore || window.AcadPulseResultCore;
  const page2 = window.ResultAnalyticsPage2 || window.AcadPulsePage2Analytics;
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const format = value => value == null ? "—" : Number(Number(value).toFixed(2)).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const formatPct = value => value == null ? "—" : `${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const state = { students: [], subjects: [], configuration: null, structure: null };

  function mountPage2() {
    const dashboard = $("analyticsDashboard");
    if (!dashboard || $("analyticsPage2")) return dashboard;
    dashboard.insertAdjacentHTML("beforeend", `
      <section id="analyticsPage2" class="analytics-page2" hidden>
        <div class="dashboard-heading"><div><span class="eyebrow">PAGE 2 · SUBJECT &amp; CLASS PERFORMANCE</span><h2 id="page2Title">Result Analytics</h2><p id="page2Subtitle"></p></div><span class="local-badge">● Browser-local analysis</span></div>
        <div class="page2-shared-filter-note"><strong>Shared dashboard filters</strong><span>Class and Gender selections from Page 1 apply to every Page 2 visual.</span><b id="page2FilterCount" aria-live="polite"></b></div>
        <div id="page2Empty" class="message" hidden>No students match these filters.</div>
        <div class="page2-grid">
          <article class="dashboard-panel"><h3>Highest Mark by Subject <span>present students only</span></h3><div id="page2HighestChart"></div></article>
          <article class="dashboard-panel"><h3>Subject Topper(s) &amp; Class <span>ties preserved</span></h3><div class="page2-table-scroll topper-table-scroll"><table id="page2SubjectToppers"></table></div></article>
          <article class="dashboard-panel page2-wide"><h3>Subject Performance Summary <span>0 = ABSENT; distribution uses % of Maximum Marks</span></h3><div class="page2-table-scroll"><table id="page2SubjectSummary"></table></div></article>
          <article class="dashboard-panel"><h3>Students Requiring Support by Subject <span>present students below Pass Mark</span></h3><div id="page2SupportChart"></div></article>
          <article class="dashboard-panel"><h3>Overall Topper Summary <span>responds to shared filters</span></h3><div id="page2OverallTopper"></div></article>
          <article class="dashboard-panel page2-wide"><h3>Class Overall Performance Comparison</h3><div class="page2-table-scroll"><table id="page2ClassPerformance"></table></div></article>
          <article class="dashboard-panel page2-wide"><h3>Class × Subject Analysis</h3><p class="page2-note">All matrices recalculate from the currently filtered population. Average and Pass % exclude absent marks.</p><div class="matrix-grid">
            <div><h3>Average Mark Matrix</h3><div class="heat-legend"><span>Lowest</span><span class="legend-ramp"><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i></span><span>Highest</span></div><div class="page2-table-scroll"><table id="page2AverageMatrix"></table></div></div>
            <div><h3>Pass % Matrix</h3><div class="heat-legend"><span>Lowest</span><span class="legend-ramp"><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i></span><span>Highest</span></div><div class="page2-table-scroll"><table id="page2PassMatrix"></table></div></div>
            <div><h3>Failure Count Matrix</h3><div class="heat-legend failure"><span>Lowest</span><span class="legend-ramp"><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i></span><span>Highest</span></div><div class="page2-table-scroll"><table id="page2FailureMatrix"></table></div></div>
          </div></article>
        </div>
      </section>`);
    return dashboard;
  }

  function maxValue(items) { return items.reduce((maximum, item) => Math.max(maximum, Number(item.value) || 0), 1); }
  function barList(items, valueFormatter = format, maximum = null) {
    const max = maximum == null ? maxValue(items) : Math.max(1, maximum);
    return `<div class="page2-bars">${items.map(item => { const value = Number(item.value) || 0; const width = Math.max(value > 0 ? 2 : 0, Math.min(100, value / max * 100)); return `<div class="page2-bar-row"><span class="page2-bar-label">${escapeHtml(item.label)}</span><div class="page2-bar-track"><i style="width:${width}%"></i></div><strong>${escapeHtml(valueFormatter(item.value))}</strong></div>`; }).join("")}</div>`;
  }
  function topperLines(toppers) {
    if (!toppers.length) return "—";
    return `<div class="topper-inline">${toppers.map(topper => `<span><strong>${escapeHtml(topper.name)}</strong><small>— ${escapeHtml(topper.className)}</small></span>`).join("")}</div>`;
  }
  function distributionHistogram(distribution) {
    const bands = (page2 || window.ResultAnalyticsPage2).DISTRIBUTION_BANDS.map(band => band.label);
    const values = bands.map(band => Number(distribution[band]) || 0);
    const maximum = Math.max(1, ...values);
    return `<div class="mini-histogram" role="img" aria-label="Score distribution from 0 to 100 percent">${bands.map((band, index) => { const count = values[index]; const height = Math.max(count > 0 ? 8 : 2, count / maximum * 46); return `<div class="mini-histogram-bin" title="${escapeHtml(band)}: ${count} students"><span>${count}</span><i style="height:${height}px"></i></div>`; }).join("")}<div class="mini-histogram-axis"><span>0</span><span>50</span><span>100%</span></div></div>`;
  }
  function subjectSummaryTable(summary) { return `<thead><tr><th>Subject</th><th>Students</th><th>Present</th><th>Passed</th><th>Failed</th><th>Pass %</th><th>Average</th><th>Highest</th><th>Lowest</th><th>Absent</th><th class="distribution-heading">Score Distribution</th></tr></thead><tbody>${summary.map(item => `<tr><td class="name">${escapeHtml(item.subject)}</td><td>${item.studentCount}</td><td>${item.presentCount}</td><td>${item.passCount}</td><td>${item.failCount}</td><td>${formatPct(item.passPercentage)}</td><td>${format(item.averageMark)}</td><td>${format(item.highestMark)}</td><td>${format(item.lowestMark)}</td><td>${item.absentCount}</td><td class="distribution-cell">${distributionHistogram(item.distribution)}</td></tr>`).join("")}</tbody>`; }
  function classPerformanceTable(rows) { return `<thead><tr><th>Class</th><th>Students</th><th>Pass</th><th>Fail</th><th>Absent Result</th><th>Average Marks</th><th>Average %</th></tr></thead><tbody>${rows.map(row => `<tr><td class="name">${escapeHtml(row.className)}</td><td>${row.studentCount}</td><td>${row.passed}</td><td>${row.failed}</td><td>${row.absentResult}</td><td>${format(row.averageMarks)}</td><td>${formatPct(row.averagePercentage)}</td></tr>`).join("")}</tbody>`; }
  function heatClass(value, type, maxFailure) {
    if (value == null) return "heat-empty";
    if (type === "failure") { if (value === 0) return "heat-good"; const ratio = maxFailure ? value / maxFailure : 0; return ratio > .66 ? "heat-bad" : ratio > .33 ? "heat-mid" : "heat-light"; }
    const ratio = type === "average" ? value / Number(state.configuration.maximumMarks) * 100 : value;
    return ratio >= 90 ? "heat-good" : ratio >= 75 ? "heat-light" : ratio >= 60 ? "heat-mid" : "heat-bad";
  }
  function matrixTable(rows, type) {
    const subjectNames = state.subjects.map(subject => subject.name);
    const failureValues = type === "failure" ? rows.flatMap(row => subjectNames.map(subject => Number(row.values[subject]) || 0)) : [];
    const maxFailure = failureValues.reduce((maximum, value) => Math.max(maximum, value), 0);
    return `<thead><tr><th>Class</th>${subjectNames.map(subject => `<th>${escapeHtml(subject)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr><td class="name">${escapeHtml(row.className)}</td>${subjectNames.map(subject => { const value = row.values[subject]; const rendered = type === "pass" ? formatPct(value) : format(value); return `<td class="${heatClass(value, type, maxFailure)}">${rendered}</td>`; }).join("")}</tr>`).join("")}</tbody>`;
  }
  function overallTopperCards(toppers) {
    if (!toppers.length) return `<div class="page2-empty-card">No topper is available for this filtered population.</div>`;
    return `<div class="topper-cards">${toppers.map(topper => `<article class="topper-card"><span>Overall Topper</span><h4>${escapeHtml(topper.name)}</h4><p>${escapeHtml(topper.className)}</p><div><b>${format(topper.totalMarks)}</b><small>Total Marks</small></div><div><b>${formatPct(topper.percentage)}</b><small>Percentage</small></div><ul>${state.subjects.map(subject => `<li><span>${escapeHtml(subject.name)}</span><strong>${format(topper.subjectMarks[subject.name])}</strong></li>`).join("")}</ul></article>`).join("")}</div>`;
  }
  function sharedFilters() { return { className: $("analyticsClassFilter")?.value || "", gender: $("analyticsGenderFilter")?.value || "" }; }
  function render() {
    if (!state.students.length || !state.structure) return;
    const activePage2 = page2 || window.ResultAnalyticsPage2;
    const analysis = activePage2.analyze(state.students, state.subjects, state.configuration, sharedFilters());
    if ($("page2FilterCount")) $("page2FilterCount").textContent = `Showing ${analysis.population.length} of ${state.students.length} students`;
    if ($("page2Empty")) $("page2Empty").hidden = analysis.population.length > 0;
    if ($("page2HighestChart")) $("page2HighestChart").innerHTML = barList(analysis.subjectToppers.map(item => ({ label: item.subject, value: item.highestMark })), format, Number(state.configuration.maximumMarks));
    if ($("page2SupportChart")) $("page2SupportChart").innerHTML = barList(analysis.supportBySubject.map(item => ({ label: item.subject, value: item.count })), format);
    if ($("page2SubjectToppers")) $("page2SubjectToppers").innerHTML = `<thead><tr><th>Subject</th><th>Highest Mark</th><th>Topper(s) &amp; Class</th></tr></thead><tbody>${analysis.subjectToppers.map(item => `<tr><td class="name">${escapeHtml(item.subject)}</td><td>${format(item.highestMark)}</td><td class="topper-list">${topperLines(item.toppers)}</td></tr>`).join("")}</tbody>`;
    if ($("page2SubjectSummary")) $("page2SubjectSummary").innerHTML = subjectSummaryTable(analysis.subjectSummary);
    if ($("page2OverallTopper")) $("page2OverallTopper").innerHTML = overallTopperCards(analysis.overallToppers);
    if ($("page2ClassPerformance")) $("page2ClassPerformance").innerHTML = classPerformanceTable(analysis.classPerformance);
    if ($("page2AverageMatrix")) $("page2AverageMatrix").innerHTML = matrixTable(analysis.matrices.averages, "average");
    if ($("page2PassMatrix")) $("page2PassMatrix").innerHTML = matrixTable(analysis.matrices.passPercentages, "pass");
    if ($("page2FailureMatrix")) $("page2FailureMatrix").innerHTML = matrixTable(analysis.matrices.failureCounts, "failure");
  }
  async function preparePage2() {
    try {
      const activeCore = core || window.ResultAnalyticsCore;
      const file = $("analyticsFileInput")?.files?.[0];
      if (!file || !window.XLSX?.read || !activeCore) return;
      const fileBytes = await file.arrayBuffer();
      const workbook = await XLSX.read(fileBytes, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      state.structure = activeCore.detectResultStructure(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true }));
      state.configuration = { maximumMarks: $("analyticsMaximum")?.value || "100", passMark: $("analyticsPassMark")?.value || "33" };
      state.students = activeCore.deriveStudents(state.structure, state.configuration);
      state.subjects = state.structure.subjects;
      if ($("page2Title")) $("page2Title").textContent = $("analyticsExamName")?.value.trim() || "Result Analytics";
      if ($("page2Subtitle")) $("page2Subtitle").textContent = `${$("analyticsYear")?.value.trim() || ""} · ${state.subjects.length} subjects · Subject & class diagnostics`;
      if ($("analyticsPage2")) $("analyticsPage2").hidden = false;
      render();
    } catch (_) { if ($("analyticsPage2")) $("analyticsPage2").hidden = true; }
  }

  const dashboard = mountPage2();
  if (dashboard) {
    const initializePage2IfVisible = () => { if (!dashboard.hidden) preparePage2(); };
    new MutationObserver(initializePage2IfVisible).observe(dashboard, { attributes: true, attributeFilter: ["hidden"] });
    initializePage2IfVisible();
    $("analyticsClassFilter")?.addEventListener("change", render);
    $("analyticsGenderFilter")?.addEventListener("change", render);
    $("analyticsResetFilters")?.addEventListener("click", () => setTimeout(render, 0));
  }

  root.ResultAnalyticsPage2UI = {
    mountPage2,
    preparePage2,
    render,
    getState: () => state,
    setState: (newState) => Object.assign(state, newState)
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
