(function (root) {
  "use strict";
  if (typeof document === "undefined") return;

  const core = window.ResultAnalyticsCore || window.AcadPulseResultCore;
  const page3 = window.ResultAnalyticsPage3 || window.AcadPulsePage3Analytics;
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = value => value == null ? "—" : Number(Number(value).toFixed(2)).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const pct = value => value == null ? "—" : `${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const state = { students: [], subjects: [], configuration: null, structure: null, selectedAdmission: "" };

  function mount() {
    const dashboard = $("analyticsDashboard");
    if (!dashboard || $("analyticsPage3")) return dashboard;
    dashboard.insertAdjacentHTML("beforeend", `
      <section id="analyticsPage3" class="analytics-page3" hidden>
        <div class="dashboard-heading"><div><span class="eyebrow">PAGE 3 · STUDENT EXPLORER</span><h2 id="page3Title">Student Explorer</h2><p>Individual performance, class comparison and detailed student filtering.</p></div><span class="local-badge">● Browser-local analysis</span></div>
        <div class="page3-toolbar">
          <label>Search Student<input id="page3StudentSearch" placeholder="Name or ADMNO"></label>
          <label>Select Student<select id="page3StudentSelect"></select></label>
          <span id="page3PopulationCount"></span>
        </div>
        <div id="page3Empty" class="message" hidden>No students match the shared Class/Gender filters.</div>

        <div class="page3-grid page3-top-grid">
          <article class="dashboard-panel" id="page3ProfilePanel"><h3>Student Profile</h3><div id="page3Profile"></div></article>
          <article class="dashboard-panel page3-span-2"><h3>Subject-wise Performance</h3><div class="page3-table-scroll"><table id="page3SubjectTable"></table></div></article>
          <article class="dashboard-panel"><h3>Key Insights</h3><div id="page3Insights"></div></article>
        </div>

        <div class="page3-grid page3-middle-grid">
          <article class="dashboard-panel page3-span-2"><h3>Student vs Filtered Population Average</h3><div id="page3Comparison"></div></article>
          <article class="dashboard-panel"><h3>Position in Filtered Population</h3><div id="page3Position"></div></article>
          <article class="dashboard-panel"><h3>Subject Status</h3><div id="page3Status"></div></article>
        </div>

        <article class="dashboard-panel page3-detail-panel">
          <div class="page3-detail-heading"><div><h3>Detailed Student Results</h3><p>Result, Subject and Mark Range filters apply only to this Page 3 table.</p></div><span id="page3DetailCount"></span></div>
          <div class="page3-local-filters">
            <label>Search<input id="page3DetailSearch" placeholder="Name or ADMNO"></label>
            <label>Result<select id="page3ResultFilter"><option value="">All</option><option>PASS</option><option>FAIL</option><option>ABSENT</option></select></label>
            <label>Subject<select id="page3SubjectFilter"><option value="">All</option></select></label>
            <label>Mark Range<select id="page3RangeFilter"><option value="">All</option>${Array.from({length:10},(_,i)=>`<option value="${i*10}-${i*10+10}">${i*10}-${i*10+10}%</option>`).join("")}</select></label>
          </div>
          <div class="page3-table-scroll"><table id="page3DetailTable"></table></div>
        </article>
      </section>`);
    return dashboard;
  }

  function sharedFilters() {
    return { className: $("analyticsClassFilter")?.value || "", gender: $("analyticsGenderFilter")?.value || "" };
  }

  function localFilters() {
    return {
      query: $("page3DetailSearch")?.value || "",
      result: $("page3ResultFilter")?.value || "",
      subject: $("page3SubjectFilter")?.value || "",
      markRange: $("page3RangeFilter")?.value || ""
    };
  }

  function optionLabel(student) {
    return `${student.name} (${student.admission}) · ${student.className}`;
  }

  function refreshStudentOptions(population) {
    const select = $("page3StudentSelect");
    if (!select) return;
    const query = $("page3StudentSearch")?.value.trim().toLowerCase() || "";
    const candidates = population.filter(student => !query || student.name.toLowerCase().includes(query) || String(student.admission).toLowerCase().includes(query));
    const prior = state.selectedAdmission;
    select.innerHTML = candidates.map(student => `<option value="${escapeHtml(student.admission)}">${escapeHtml(optionLabel(student))}</option>`).join("");
    const stillAvailable = candidates.some(student => String(student.admission) === String(prior));
    state.selectedAdmission = stillAvailable ? prior : (candidates[0] ? String(candidates[0].admission) : "");
    select.value = state.selectedAdmission;
  }

  function resultClass(result) {
    return result === "PASS" ? "is-pass" : result === "FAIL" ? "is-fail" : "is-absent";
  }

  function renderProfile(profile) {
    if (!profile) return `<div class="page3-placeholder">Select a student.</div>`;
    
    // Check if photo processor has loaded a photo for this student
    const photoUrl = window.PhotoAnalyticsBridge?.getStudentPhotoUrl?.(profile.admission);
    const photoMarkup = photoUrl ? `
      <div class="page3-profile-photo" style="margin-bottom: 12px; display: flex; align-items: center; gap: 12px;">
        <img src="${photoUrl}" alt="Photo of ${escapeHtml(profile.name)}" style="width: 64px; height: 80px; object-fit: cover; border-radius: 6px; border: 1px solid #d9ded8; box-shadow: 0 2px 6px rgba(0,0,0,0.06);">
        <div>
          <small style="color: #126148; font-weight: 700; font-size: 10px; display: block; text-transform: uppercase;">Linked Passport Photo</small>
          <span style="font-size: 11px; color: #66756f;">ADMNO #${escapeHtml(profile.admission)}</span>
        </div>
      </div>
    ` : "";

    return `<div class="page3-profile">
      ${photoMarkup}
      <div><h4>${escapeHtml(profile.name)}</h4><p>ADMNO <b>${escapeHtml(profile.admission)}</b></p><p>Class <b>${escapeHtml(profile.className)}</b></p><p>Gender <b>${escapeHtml(profile.gender || "—")}</b></p></div>
      <div class="page3-profile-result"><span class="${resultClass(profile.result)}">${escapeHtml(profile.result || "—")}</span><b>${fmt(profile.totalMarks)} / ${fmt(profile.maximumTotal)}</b><strong>${pct(profile.percentage)}</strong><small>Rank ${fmt(profile.rank)} / ${fmt(profile.populationSize)}</small></div>
      <div class="page3-profile-counts"><span><small>Passed</small><b>${profile.passedSubjects}</b></span><span><small>Failed</small><b>${profile.failedSubjects}</b></span><span><small>Absent</small><b>${profile.absentSubjects}</b></span></div>
    </div>`;
  }

  function renderSubjectTable(profile) {
    if (!profile) return "";
    return `<thead><tr><th>Subject</th><th>Mark</th><th>%</th><th>Status</th><th>Population Avg</th><th>Difference</th></tr></thead><tbody>${profile.subjectRows.map(row => `<tr><td class="name">${escapeHtml(row.subject)}</td><td>${fmt(row.mark)}</td><td>${pct(row.percentage)}</td><td><span class="page3-status ${resultClass(row.status)}">${row.status}</span></td><td>${fmt(row.populationAverage)}</td><td class="${row.difference == null ? "" : row.difference >= 0 ? "positive" : "negative"}">${row.difference == null ? "—" : `${row.difference > 0 ? "+" : ""}${fmt(row.difference)}`}</td></tr>`).join("")}</tbody>`;
  }

  function renderInsights(profile) {
    if (!profile) return "";
    const support = [...profile.failedSubjectNames, ...profile.absentSubjectNames];
    return `<div class="page3-insights">
      <div class="good"><small>Highest Present Subject</small><b>${profile.strongest ? `${escapeHtml(profile.strongest.subject)} (${pct(profile.strongest.percentage)})` : "—"}</b></div>
      <div class="warn"><small>Lowest Present Subject</small><b>${profile.lowest ? `${escapeHtml(profile.lowest.subject)} (${pct(profile.lowest.percentage)})` : "—"}</b></div>
      <div class="bad"><small>Support Areas</small><b>${support.length ? support.map(escapeHtml).join(", ") : "None"}</b></div>
      <div class="info"><small>Compared with Population Average</small><b>${profile.aboveAverage} above · ${profile.belowAverage} below</b></div>
    </div>`;
  }

  function renderComparison(profile) {
    if (!profile) return "";
    return `<div class="page3-comparison">${profile.subjectRows.map(row => {
      const studentWidth = Math.max(0, Math.min(100, row.percentage));
      const avgPct = row.populationAverage == null ? null : row.populationAverage / Number(state.configuration.maximumMarks) * 100;
      return `<div class="page3-comparison-row"><b>${escapeHtml(row.subject)}</b><div class="page3-dual-bars"><span class="student-bar" style="width:${studentWidth}%"></span>${avgPct == null ? "" : `<i style="left:${Math.max(0,Math.min(100,avgPct))}%"></i>`}</div><strong>${pct(row.percentage)}</strong><small>${row.populationAverage == null ? "Avg —" : `Avg ${fmt(row.populationAverage)}`}</small></div>`;
    }).join("")}<div class="page3-comparison-legend"><span><i class="student-key"></i>Student %</span><span><i class="avg-key"></i>Population average</span></div></div>`;
  }

  function renderPosition(profile) {
    if (!profile) return "";
    return `<div class="page3-position"><div><small>Rank</small><b>${fmt(profile.rank)} / ${fmt(profile.populationSize)}</b></div><div><small>Percentile</small><b>${pct(profile.percentile)}</b></div><div class="page3-percentile-track"><i style="width:${Math.max(0,Math.min(100,profile.percentile))}%"></i><span style="left:${Math.max(0,Math.min(100,profile.percentile))}%"></span></div><p>Relative to the currently filtered Class/Gender population.</p></div>`;
  }

  function renderStatus(profile) {
    if (!profile) return "";
    const total = Math.max(1, state.subjects.length);
    return `<div class="page3-status-summary"><div class="page3-status-bar"><i class="pass" style="width:${profile.passedSubjects/total*100}%"></i><i class="fail" style="width:${profile.failedSubjects/total*100}%"></i><i class="absent" style="width:${profile.absentSubjects/total*100}%"></i></div><b>${profile.passedSubjects} / ${state.subjects.length} passed</b><p><span>PASS ${profile.passedSubjects}</span><span>FAIL ${profile.failedSubjects}</span><span>ABSENT ${profile.absentSubjects}</span></p></div>`;
  }

  function renderDetail(rows) {
    if ($("page3DetailCount")) $("page3DetailCount").textContent = `Showing ${rows.length} students`;
    if ($("page3DetailTable")) $("page3DetailTable").innerHTML = `<thead><tr><th>#</th><th>ADMNO</th><th>Student Name</th><th>Class</th><th>Gender</th>${state.subjects.map(subject=>`<th>${escapeHtml(subject.name)}</th>`).join("")}<th>Total</th><th>%</th><th>Result</th></tr></thead><tbody>${rows.map((row,index)=>`<tr class="${String(row.admission)===String(state.selectedAdmission)?"selected-row":""}" data-admission="${escapeHtml(row.admission)}"><td>${index+1}</td><td>${escapeHtml(row.admission)}</td><td class="name">${escapeHtml(row.name)}</td><td>${escapeHtml(row.className)}</td><td>${escapeHtml(row.gender||"—")}</td>${row.marks.map(mark=>`<td>${fmt(mark)}</td>`).join("")}<td>${fmt(row.totalMarks)}</td><td>${pct(row.percentage)}</td><td><span class="page3-status ${resultClass(row.result)}">${escapeHtml(row.result||"—")}</span></td></tr>`).join("")}</tbody>`;
  }

  function render() {
    if (!state.students.length) return;
    const activePage3 = page3 || window.ResultAnalyticsPage3;
    let analysis = activePage3.analyze(state.students, state.subjects, state.configuration, sharedFilters(), state.selectedAdmission, localFilters());
    refreshStudentOptions(analysis.population);
    analysis = activePage3.analyze(state.students, state.subjects, state.configuration, sharedFilters(), state.selectedAdmission, localFilters());
    if ($("page3PopulationCount")) $("page3PopulationCount").textContent = `${analysis.population.length} students in shared filters`;
    if ($("page3Empty")) $("page3Empty").hidden = analysis.population.length > 0;
    if ($("page3Profile")) $("page3Profile").innerHTML = renderProfile(analysis.profile);
    if ($("page3SubjectTable")) $("page3SubjectTable").innerHTML = renderSubjectTable(analysis.profile);
    if ($("page3Insights")) $("page3Insights").innerHTML = renderInsights(analysis.profile);
    if ($("page3Comparison")) $("page3Comparison").innerHTML = renderComparison(analysis.profile);
    if ($("page3Position")) $("page3Position").innerHTML = renderPosition(analysis.profile);
    if ($("page3Status")) $("page3Status").innerHTML = renderStatus(analysis.profile);
    renderDetail(analysis.detailedRows);
  }

  async function prepare() {
    try {
      const activeCore = core || window.ResultAnalyticsCore;
      const file = $("analyticsFileInput")?.files?.[0];
      if (!file || !window.XLSX?.read || !activeCore) return;
      const workbook = await XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      state.structure = activeCore.detectResultStructure(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true }));
      state.configuration = { maximumMarks: $("analyticsMaximum")?.value || "100", passMark: $("analyticsPassMark")?.value || "33" };
      state.students = activeCore.deriveStudents(state.structure, state.configuration);
      state.subjects = state.structure.subjects;
      if ($("page3SubjectFilter")) $("page3SubjectFilter").innerHTML = `<option value="">All</option>${state.subjects.map(subject=>`<option value="${escapeHtml(subject.name)}">${escapeHtml(subject.name)}</option>`).join("")}`;
      if ($("page3Title")) $("page3Title").textContent = `${$("analyticsExamName")?.value.trim() || "Result Analytics"} · Student Explorer`;
      if ($("analyticsPage3")) $("analyticsPage3").hidden = false;
      render();
    } catch (_) {
      if ($("analyticsPage3")) $("analyticsPage3").hidden = true;
    }
  }

  const dashboard = mount();
  if (dashboard) {
    const maybePrepare = () => { if (!dashboard.hidden) prepare(); };
    new MutationObserver(maybePrepare).observe(dashboard, { attributes: true, attributeFilter: ["hidden"] });
    maybePrepare();

    $("analyticsClassFilter")?.addEventListener("change", () => { state.selectedAdmission = ""; render(); });
    $("analyticsGenderFilter")?.addEventListener("change", () => { state.selectedAdmission = ""; render(); });
    $("analyticsResetFilters")?.addEventListener("click", () => setTimeout(() => { state.selectedAdmission = ""; render(); }, 0));
    $("page3StudentSearch")?.addEventListener("input", render);
    $("page3StudentSelect")?.addEventListener("change", event => { state.selectedAdmission = event.target.value; render(); });
    ["page3DetailSearch", "page3ResultFilter", "page3SubjectFilter", "page3RangeFilter"].forEach(id => $(id)?.addEventListener(id === "page3DetailSearch" ? "input" : "change", render));
    $("page3DetailTable")?.addEventListener("click", event => {
      const row = event.target.closest("tr[data-admission]");
      if (!row) return;
      state.selectedAdmission = row.dataset.admission;
      if ($("page3StudentSearch")) $("page3StudentSearch").value = "";
      render();
      $("analyticsPage3")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  root.ResultAnalyticsPage3UI = {
    mount,
    prepare,
    render,
    selectStudentByAdmission: (adm) => {
      state.selectedAdmission = String(adm);
      render();
    },
    getState: () => state,
    setState: (newState) => Object.assign(state, newState)
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
