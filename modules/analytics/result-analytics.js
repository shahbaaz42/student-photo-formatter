(function (root) {
  "use strict";
  if (typeof document === "undefined") return;

  const core = window.ResultAnalyticsCore || window.AcadPulseResultCore;
  const state = { structure: null, students: [], filename: "", configuration: null, loadGuard: core ? core.createLatestLoadGuard() : null };
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const format = value => Number(Number(value).toFixed(2)).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const formatPercentage = value => Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const showMessage = (id, text, success = false, placement = "") => {
    const box = $(id);
    if (!box) return;
    box.textContent = text;
    box.className = `message${placement ? ` ${placement}` : ""}${success ? " success" : ""}`;
    box.hidden = false;
  };
  const uploadMessage = (text, success = false) => showMessage("analyticsUploadMessage", text, success, "upload-message");
  const message = (text, success = false) => showMessage("analyticsMessage", text, success, "generate-message");

  const hideRequirements = () => { if ($("analyticsRequirements")) $("analyticsRequirements").hidden = true; };
  const showRequirementsAfter = messageId => {
    const requirements = $("analyticsRequirements");
    if (!requirements || !$(messageId)) return;
    $(messageId).insertAdjacentElement("afterend", requirements);
    requirements.hidden = false;
  };
  const clearWarnings = () => {
    if ($("analyticsWarnings")) $("analyticsWarnings").hidden = true;
    if ($("analyticsWarningLines")) $("analyticsWarningLines").textContent = "";
  };
  const showWarnings = warnings => {
    if (!$("analyticsWarningLines") || !$("analyticsWarnings")) return;
    $("analyticsWarningLines").innerHTML = warnings.map(warning => `<p>${escapeHtml(warning)}</p>`).join("");
    $("analyticsWarnings").hidden = !warnings.length;
  };

  async function loadWorkbook(file) {
    if (!state.loadGuard) state.loadGuard = core.createLatestLoadGuard();
    const loadId = state.loadGuard.begin();
    state.structure = null; state.students = []; state.filename = "";
    if ($("analyticsDashboard")) $("analyticsDashboard").hidden = true;
    if ($("analyticsFileSummary")) $("analyticsFileSummary").hidden = true;
    if ($("analyticsMessage")) $("analyticsMessage").hidden = true;
    if ($("analyticsUploadMessage")) $("analyticsUploadMessage").hidden = true;
    hideRequirements();
    clearWarnings();
    if ($("analyticsConfigCard")) $("analyticsConfigCard").classList.add("locked");
    if ($("analyticsGenerate")) $("analyticsGenerate").disabled = true;

    try {
      if (!file || !file.name.toLowerCase().endsWith(".xlsx")) throw new Error("Invalid workbook. Choose an .xlsx result workbook.");
      if (file.size > 10 * 1024 * 1024) throw new Error("The workbook exceeds the 10 MB limit.");
      if (!window.XLSX?.read) throw new Error("The local XLSX reader failed to initialize. Reload the page and try again.");
      const fileBytes = await file.arrayBuffer();
      if (!state.loadGuard.isCurrent(loadId)) return;
      const workbook = await XLSX.read(fileBytes, { type: "array" });
      if (!state.loadGuard.isCurrent(loadId)) return;
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const structure = core.detectResultStructure(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true }));
      if (!state.loadGuard.isCurrent(loadId)) return;
      state.structure = structure; state.filename = file.name;
      showWarnings(core.optionalMetadataWarnings(structure));
      if ($("analyticsFileSummary")) {
        $("analyticsFileSummary").innerHTML = `<div class="file-row"><div><strong>✓ ${escapeHtml(file.name)}</strong><small>${structure.dataRows.length} students · ${structure.subjects.length} dynamically detected subjects</small><small><b>${structure.classes.length} ${structure.classes.length === 1 ? "Class" : "Classes"} detected:</b> ${structure.classes.map(escapeHtml).join(", ")}</small></div></div><div class="detected">${structure.subjects.map(subject => `<span class="tag">${escapeHtml(subject.name)}</span>`).join("")}</div>`;
        $("analyticsFileSummary").hidden = false;
      }
      if ($("analyticsConfigCard")) $("analyticsConfigCard").classList.remove("locked");
      if ($("analyticsGenerate")) $("analyticsGenerate").disabled = false;
      uploadMessage("Workbook read locally. Confirm the exam rules, then generate the dashboard.", true);
    } catch (error) {
      if (!state.loadGuard.isCurrent(loadId)) return;
      state.structure = null;
      if ($("analyticsGenerate")) $("analyticsGenerate").disabled = true;
      uploadMessage(error.message);
      if (error.code === "WORKBOOK_ROW_VALIDATION") showRequirementsAfter("analyticsUploadMessage");
    }
  }

  function optionList(values) {
    return `<option value="">All</option>${[...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b)).map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
  }

  function invalidateGeneratedDashboard() {
    state.students = [];
    if ($("analyticsDashboard")) $("analyticsDashboard").hidden = true;
  }

  function generate() {
    invalidateGeneratedDashboard();
    hideRequirements();
    try {
      if (!state.structure) throw new Error("Upload a valid result workbook first.");
      const examName = $("analyticsExamName")?.value.trim() || "", academicYear = $("analyticsYear")?.value.trim() || "";
      if (!examName || !academicYear) throw new Error("Enter the Exam Name and Academic Year.");
      state.configuration = {
        examName,
        academicYear,
        maximumMarks: $("analyticsMaximum")?.value || "100",
        passMark: $("analyticsPassMark")?.value || "33"
      };
      state.students = core.deriveStudents(state.structure, state.configuration);
      if ($("analyticsClassFilter")) $("analyticsClassFilter").innerHTML = optionList(state.students.map(student => student.className));
      if ($("analyticsGenderFilter")) $("analyticsGenderFilter").innerHTML = optionList(state.students.map(student => student.gender));
      if ($("analyticsGenderFilterField")) $("analyticsGenderFilterField").hidden = !state.students.some(student => student.gender);
      if ($("dashboardTitle")) $("dashboardTitle").textContent = examName;
      if ($("dashboardSubtitle")) $("dashboardSubtitle").textContent = `${academicYear} · ${state.structure.subjects.length} subjects · Maximum ${format(state.configuration.maximumMarks)} · Pass mark ${format(state.configuration.passMark)}`;
      if ($("analyticsDashboard")) {
        $("analyticsDashboard").hidden = false;
        render();
        $("analyticsDashboard").scrollIntoView({ behavior: "smooth" });
      }
      message("Dashboard generated. Class and Gender filters update every visual immediately.", true);
    } catch (error) {
      message(error.message);
      if (error.code === "WORKBOOK_ROW_VALIDATION") showRequirementsAfter("analyticsMessage");
    }
  }

  function barChart(items, labelKey, valueKey, color = "#197052") {
    const width = 760, height = 280, left = 46, bottom = 50, top = 18, chartHeight = height - bottom - top;
    const max = Math.max(1, ...items.map(item => item[valueKey])), slot = (width - left - 12) / Math.max(1, items.length), barWidth = Math.min(56, slot * .62);
    const grid = [0, .25, .5, .75, 1].map(part => {
      const y = top + chartHeight * (1 - part);
      return `<line x1="${left}" y1="${y}" x2="${width - 8}" y2="${y}" stroke="#e3ebe7"/><text x="${left - 7}" y="${y + 4}" text-anchor="end" font-size="9" fill="#6d7d77">${format(max * part)}</text>`;
    }).join("");
    const bars = items.map((item, index) => {
      const value = item[valueKey], h = value / max * chartHeight, x = left + slot * index + (slot - barWidth) / 2, y = top + chartHeight - h;
      return `<g><title>${escapeHtml(item[labelKey])}: ${format(value)}</title><rect x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="4" fill="${color}"/><text x="${x + barWidth / 2}" y="${Math.max(12, y - 5)}" text-anchor="middle" font-size="9" font-weight="700" fill="#263d36">${format(value)}</text><text x="${x + barWidth / 2}" y="${height - 27}" text-anchor="middle" font-size="9" fill="#52655e" transform="rotate(-18 ${x + barWidth / 2} ${height - 27})">${escapeHtml(item[labelKey])}</text></g>`;
    }).join("");
    return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${grid}${bars}</svg>`;
  }

  function donutChart(items, total) {
    const colors = { PASS: "#239366", FAIL: "#d65745", ABSENT: "#e5a62f" }, radius = 70, circumference = 2 * Math.PI * radius;
    let offset = 0;
    const arcs = items.map(item => {
      const length = total ? item.count / total * circumference : 0;
      const arc = `<circle cx="105" cy="105" r="${radius}" fill="none" stroke="${colors[item.result]}" stroke-width="32" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 105 105)"><title>${item.result}: ${item.count} (${formatPercentage(total ? item.count / total * 100 : 0)}%)</title></circle>`;
      offset += length;
      return arc;
    }).join("");
    const legend = items.map(item => `<span><i style="background:${colors[item.result]}"></i><b>${item.result}</b> ${item.count} · ${formatPercentage(total ? item.count / total * 100 : 0)}%</span>`).join("");
    return `<div class="donut-layout"><svg viewBox="0 0 210 210" style="width:210px;min-height:210px">${arcs}<text x="105" y="100" text-anchor="middle" font-size="26" font-weight="800" fill="#142b25">${total}</text><text x="105" y="119" text-anchor="middle" font-size="10" fill="#6d7d77">STUDENTS</text></svg><div class="donut-legend">${legend}</div></div>`;
  }

  function renderChart(id, renderFn) {
    const container = $(id);
    if (!container) return;
    try {
      container.innerHTML = renderFn();
    } catch (_) {
      container.innerHTML = '<div class="chart-error">This chart could not be rendered. Workbook calculations remain available.</div>';
    }
  }

  function table(students, rankLabel) {
    return `<thead><tr><th>${rankLabel}</th><th>ADMNO</th><th>Student Name</th><th>Class</th><th>Total Marks</th><th>Percentage</th></tr></thead><tbody>${students.map(student => `<tr><td>${student.rank}</td><td>${escapeHtml(student.admission)}</td><td class="name" title="${escapeHtml(student.name)}">${escapeHtml(student.name)}</td><td>${escapeHtml(student.className)}</td><td>${format(student.totalMarks)}</td><td>${formatPercentage(student.percentage)}%</td></tr>`).join("")}</tbody>`;
  }

  function render() {
    if (!state.students.length || !state.structure) return;
    const filters = {
      className: $("analyticsClassFilter")?.value || "",
      gender: $("analyticsGenderFilter")?.value || ""
    };
    const students = core.filterStudents(state.students, filters);
    const summary = core.summarize(students, state.structure.subjects);
    if ($("analyticsEmpty")) $("analyticsEmpty").hidden = students.length > 0;
    if ($("filterCount")) $("filterCount").textContent = `Showing ${students.length} of ${state.students.length} students`;
    const cards = [
      ["Total Students", summary.totalStudents],
      ["Passed", summary.passed],
      ["Pass %", `${formatPercentage(summary.passPercentage)}%`],
      ["Present", summary.present],
      ["Present %", `${formatPercentage(summary.presentPercentage)}%`],
      ["Average Marks", format(summary.averageMarks)],
      ["Average %", `${formatPercentage(summary.averagePercentage)}%`]
    ];
    if ($("kpiGrid")) $("kpiGrid").innerHTML = cards.map(([label, value]) => `<article class="kpi-card"><small>${label}</small><strong>${value}</strong></article>`).join("");
    renderChart("subjectChart", () => barChart([...summary.subjectAverages].sort((a, b) => b.value - a.value), "subject", "value"));
    renderChart("resultChart", () => donutChart(summary.resultDistribution, summary.totalStudents));
    renderChart("rangeChart", () => barChart(summary.ranges, "label", "count", "#74a51f"));
    if ($("topStudents")) $("topStudents").innerHTML = table(summary.top, "Rank");
    if ($("supportStudents")) $("supportStudents").innerHTML = table(summary.bottom, "Sr. No");
  }

  function initListeners() {
    $("analyticsFileInput")?.addEventListener("change", event => loadWorkbook(event.target.files[0]));
    const dropzone = $("analyticsDropzone");
    if (dropzone) {
      ["dragenter", "dragover"].forEach(name => dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.add("drag"); }));
      ["dragleave", "drop"].forEach(name => dropzone.addEventListener(name, event => {
        event.preventDefault(); dropzone.classList.remove("drag");
        if (name === "drop" && event.dataTransfer.files?.length) {
          const input = $("analyticsFileInput");
          if (input) input.value = "";
          loadWorkbook(event.dataTransfer.files[0]);
        }
      }));
    }
    $("analyticsGenerate")?.addEventListener("click", generate);
    $("analyticsClassFilter")?.addEventListener("change", render);
    $("analyticsGenderFilter")?.addEventListener("change", render);
    $("analyticsResetFilters")?.addEventListener("click", () => {
      if ($("analyticsClassFilter")) $("analyticsClassFilter").value = "";
      if ($("analyticsGenderFilter")) $("analyticsGenderFilter").value = "";
      render();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initListeners);
  } else {
    initListeners();
  }

  root.ResultAnalyticsUI = {
    loadWorkbook,
    generate,
    render,
    getState: () => state,
    setState: (newState) => Object.assign(state, newState),
    barChart,
    donutChart
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
