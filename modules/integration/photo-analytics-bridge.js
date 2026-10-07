/**
 * Teacher Utility Suite - Photo & Analytics Bridge
 * Connects student passport photo processing with client-side Scoreboard & Mark Analytics.
 * Handles filename parsing, student admission number lookup, marks workbook ingestion,
 * and renders analytical scoreboard cards alongside compressed passport photos.
 */
(function (root) {
  "use strict";

  // In-memory data store for the client-side session
  const store = {
    // Registered processed photos: Map<normalizedAdmno, photoRecord>
    photos: new Map(),
    // Registered student analytics records: Map<normalizedAdmno, studentRecord>
    students: new Map(),
    // Name fallback index: Map<normalizedName, studentRecord>
    studentsByName: new Map(),
    // Raw workbook structure and configuration
    structure: null,
    scoreboardStructure: null,
    houses: null,
    configuration: {
      examName: "Pre Mid Term Exam",
      academicYear: "2026–27",
      maximumMarks: 80,
      passMark: 33
    },
    isMarksLoaded: false,
    marksFilename: "",
    // Event listeners for state changes
    listeners: new Set()
  };

  /**
   * Normalizes an admission number for reliable lookup
   * Handles string trimming, case-insensitivity, and stripping leading zeroes for purely numeric ADMNOs
   */
  function normalizeAdmission(adm) {
    if (adm == null) return "";
    let clean = String(adm).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    // If all digits, strip leading zeroes: e.g. "0101" -> "101"
    if (/^\d+$/.test(clean)) {
      clean = String(parseInt(clean, 10));
    }
    return clean;
  }

  /**
   * Normalizes a student name for fallback lookup
   */
  function normalizeName(name) {
    if (!name) return "";
    return String(name).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  /**
   * Parses admission number and student name from an image filename
   * Supports: "1234 Student Name.jpg", "1234_Student_Name.jpg", "ADM101 John Doe.png", "101.jpg"
   */
  function parsePhotoFilename(filename) {
    if (!filename) return { admissionNumber: "", studentName: "" };
    const base = filename.substring(0, filename.lastIndexOf('.')) || filename;
    const trimmed = base.trim();

    // Check for delimiter between leading admission code and student name: space, underscore, or hyphen
    const match = trimmed.match(/^([A-Za-z0-9]+)[\s_\-]+(.+)$/);
    if (match) {
      return {
        admissionNumber: match[1].trim(),
        studentName: match[2].replace(/^[\s_\-]+/, '').trim()
      };
    }

    // Check if filename is just an admission number (e.g. "1234.jpg" or "ADM101.jpg")
    return {
      admissionNumber: trimmed,
      studentName: trimmed
    };
  }

  /**
   * Register a processed compressed passport photo
   */
  function registerProcessedPhoto(admissionNumber, photoData) {
    const key = normalizeAdmission(admissionNumber);
    if (key) {
      store.photos.set(key, {
        admissionNumber,
        ...photoData
      });
    }
    notifyListeners();
  }

  /**
   * Get photo record or URL for a given admission number
   */
  function getStudentPhoto(admissionNumber) {
    const key = normalizeAdmission(admissionNumber);
    return store.photos.get(key) || null;
  }

  function getStudentPhotoUrl(admissionNumber) {
    const record = getStudentPhoto(admissionNumber);
    return record ? record.objectUrl : null;
  }

  /**
   * Ingest a Marks Consolidation workbook (.xlsx) into the client-side store
   */
  async function ingestMarksWorkbook(file, config = {}) {
    const XLSX = root.XLSX;
    const ResultCore = root.ResultAnalyticsCore || root.AcadPulseResultCore;
    const ScoreboardGen = root.ScoreboardGenerator;
    const Page3Core = root.ResultAnalyticsPage3 || root.AcadPulsePage3Analytics;

    if (!XLSX?.read) throw new Error("Local XLSX reader not found.");
    if (!ResultCore) throw new Error("Result Analytics Core transformer not found.");

    const arrayBuffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
    const workbook = await XLSX.read(arrayBuffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });

    // Detect structure for both modules
    const resultStructure = ResultCore.detectResultStructure(rawRows);
    let sbStructure = null;
    try {
      if (ScoreboardGen?.detectStructure) {
        sbStructure = ScoreboardGen.detectStructure(rawRows);
      }
    } catch (_) {
      // Scoreboard structure might differ slightly if House is formatted differently
    }

    // Set configuration
    const mergedConfig = {
      examName: config.examName || "Consolidated Examination",
      academicYear: config.academicYear || "2026–27",
      maximumMarks: Number(config.maximumMarks) || 80,
      passMark: Number(config.passMark) || 33
    };

    // Derive student mark analytics
    const derivedStudents = ResultCore.deriveStudents(resultStructure, mergedConfig);

    // Build scoreboard data if possible
    let houses = {};
    if (ScoreboardGen?.buildScoreboard && sbStructure) {
      const maximums = Object.fromEntries(sbStructure.subjects.map(s => [s.name, mergedConfig.maximumMarks]));
      houses = ScoreboardGen.buildScoreboard(sbStructure, maximums);
    }

    // Populate registry
    store.students.clear();
    store.studentsByName.clear();

    derivedStudents.forEach(student => {
      // Compute detailed profile and points for each student
      let profile = null;
      if (Page3Core?.profileFor) {
        profile = Page3Core.profileFor(student, derivedStudents, resultStructure.subjects, mergedConfig);
      }

      // Find scoreboard points for this student
      let scoreboardData = null;
      if (houses) {
        for (const [houseName, houseStudents] of Object.entries(houses)) {
          const match = houseStudents.find(s => normalizeAdmission(s.admission) === normalizeAdmission(student.admission));
          if (match) {
            scoreboardData = {
              house: houseName,
              totalPoints: match.total,
              averagePoints: match.average,
              results: match.results
            };
            break;
          }
        }
      }

      const compositeRecord = {
        student,
        profile,
        scoreboardData,
        subjects: resultStructure.subjects
      };

      const admKey = normalizeAdmission(student.admission);
      if (admKey) store.students.set(admKey, compositeRecord);

      const nameKey = normalizeName(student.name);
      if (nameKey) store.studentsByName.set(nameKey, compositeRecord);
    });

    store.structure = resultStructure;
    store.scoreboardStructure = sbStructure;
    store.houses = houses;
    store.configuration = mergedConfig;
    store.isMarksLoaded = true;
    store.marksFilename = file.name || "consolidated_marks.xlsx";

    notifyListeners();

    return {
      studentCount: derivedStudents.length,
      subjects: resultStructure.subjects,
      classes: resultStructure.classes,
      houses: Object.keys(houses)
    };
  }

  /**
   * Look up a student by admission number (with name fallback)
   */
  function lookupStudent(admissionNumber, studentName = "") {
    const admKey = normalizeAdmission(admissionNumber);
    if (admKey && store.students.has(admKey)) {
      return store.students.get(admKey);
    }
    const nameKey = normalizeName(studentName);
    if (nameKey && store.studentsByName.has(nameKey)) {
      return store.studentsByName.get(nameKey);
    }
    return null;
  }

  /**
   * Helper to format numbers cleanly
   */
  const fmt = (val, dec = 1) => val == null ? "—" : Number(val).toFixed(dec);

  /**
   * Renders the integrated analytical scoreboard card HTML
   * This is designed to render alongside the compressed, date-stamped passport photo card.
   */
  function renderScoreboardHTML(admissionNumber, fallbackName = "") {
    const studentData = lookupStudent(admissionNumber, fallbackName);

    if (!store.isMarksLoaded) {
      return `
        <div class="p-3 bg-amber-50/70 border border-amber-200/60 rounded-lg text-xs text-amber-800 flex items-start gap-2.5">
          <svg class="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          <div>
            <strong class="font-semibold block mb-0.5">Marks Data Not Ingested</strong>
            <span>Upload a Marks Consolidation file (.xlsx) above to link this student's analytical scoreboard.</span>
          </div>
        </div>
      `;
    }

    if (!studentData) {
      return `
        <div class="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 flex items-start gap-2.5">
          <svg class="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
          <div>
            <span class="font-medium text-gray-700">No match for ADMNO: <b>${escapeHtml(admissionNumber || "N/A")}</b></span>
            <p class="text-[11px] text-gray-400 mt-0.5">Ensure photo filename starts with the admission number (e.g. "${admissionNumber || '101'} Name.jpg").</p>
          </div>
        </div>
      `;
    }

    const { student, profile, scoreboardData, subjects } = studentData;
    const isPass = student.result === "PASS";
    const isFail = student.result === "FAIL";
    const statusBg = isPass ? "bg-emerald-500 text-white" : isFail ? "bg-rose-500 text-white" : "bg-amber-500 text-white";
    const statusBorder = isPass ? "border-emerald-200 bg-emerald-50 text-emerald-800" : isFail ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-800";

    // Build subject mini-row badges
    const subjectBadges = subjects.map((sub, i) => {
      const mark = student.marks[i];
      const max = store.configuration.maximumMarks;
      const pct = max ? (mark / max * 100) : 0;
      const pass = mark >= store.configuration.passMark && mark > 0;
      const isAbsent = mark === 0;
      const badgeCls = isAbsent ? "bg-gray-100 text-gray-600" : pass ? "bg-emerald-50 text-emerald-700 border-emerald-200/60" : "bg-rose-50 text-rose-700 border-rose-200/60";
      
      // Points if available
      const pts = scoreboardData?.results?.[i]?.points;
      const ptsText = pts !== null && pts !== undefined ? ` · ${pts}pts` : "";

      return `
        <div class="flex items-center justify-between text-[11px] py-1 px-1.5 rounded border ${badgeCls}">
          <span class="font-medium truncate max-w-[85px]">${escapeHtml(sub.name)}</span>
          <span class="font-bold ml-1">${mark} <span class="text-[9px] font-normal opacity-75">(${fmt(pct, 0)}%${ptsText})</span></span>
        </div>
      `;
    }).join("");

    const houseName = scoreboardData?.house || student.house || "House of Scholars";
    const housePoints = scoreboardData?.totalPoints !== undefined ? `${scoreboardData.totalPoints} pts` : "—";

    return `
      <div class="mt-2.5 pt-2.5 border-t border-gray-100 text-xs flex flex-col gap-2">
        <!-- Top Scoreboard Meta -->
        <div class="flex items-center justify-between gap-1.5 flex-wrap">
          <div class="flex items-center gap-1.5">
            <span class="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide ${statusBg}">
              ${student.result || "N/A"}
            </span>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/50">
              ${escapeHtml(student.className)}
            </span>
            ${houseName ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200/50 truncate max-w-[110px]" title="${escapeHtml(houseName)}">${escapeHtml(houseName)}</span>` : ""}
          </div>
          <span class="text-[11px] font-bold text-gray-700">
            ${student.totalMarks} <span class="text-gray-400 font-normal">/ ${store.configuration.maximumMarks * subjects.length}</span>
            <span class="text-emerald-700 font-extrabold">(${fmt(student.percentage)}%)</span>
          </span>
        </div>

        <!-- KPI Mini Stats -->
        <div class="grid grid-cols-3 gap-1 bg-gray-50/80 p-1.5 rounded border border-gray-100 text-center">
          <div>
            <span class="text-[9px] text-gray-400 block uppercase">Rank</span>
            <strong class="text-xs font-bold text-gray-800">#${profile?.rank || "—"}</strong>
          </div>
          <div>
            <span class="text-[9px] text-gray-400 block uppercase">House Pts</span>
            <strong class="text-xs font-bold text-purple-800">${housePoints}</strong>
          </div>
          <div>
            <span class="text-[9px] text-gray-400 block uppercase">Passed</span>
            <strong class="text-xs font-bold text-emerald-700">${profile?.passedSubjects || 0}/${subjects.length}</strong>
          </div>
        </div>

        <!-- Subject Mini Scoreboard -->
        <div class="grid grid-cols-2 gap-1 mt-0.5">
          ${subjectBadges}
        </div>

        ${profile?.strongest ? `
          <div class="text-[10.5px] text-gray-500 flex items-center justify-between pt-1 border-t border-gray-100/80">
            <span>Top: <b class="text-emerald-700">${escapeHtml(profile.strongest.subject)}</b> (${fmt(profile.strongest.percentage, 0)}%)</span>
            ${profile.failedSubjects > 0 ? `<span class="text-rose-600 font-medium">Support: ${profile.failedSubjects} subject(s)</span>` : `<span class="text-emerald-600 font-medium">All Passed</span>`}
          </div>
        ` : ""}
      </div>
    `;
  }

  function escapeHtml(val) {
    return String(val ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function addChangeListener(fn) {
    store.listeners.add(fn);
    return () => store.listeners.delete(fn);
  }

  function notifyListeners() {
    store.listeners.forEach(fn => {
      try { fn(store); } catch (e) { console.error("Error in Bridge listener", e); }
    });
  }

  /**
   * Generates a sample marks workbook dataset in memory for instant demo/testing
   */
  function createSampleWorkbookData() {
    return [
      ["Roll No", "ADMNO", "Student Name", "Science", "Maths", "English", "Social", "Class & Section", "Gender", "House"],
      [1, "1234", "John Doe", 74, 68, 70, 65, "Class 10-A", "Boy", "House of Phoenix"],
      [2, "1001", "Asha Sharma", 78, 79, 75, 76, "Class 10-A", "Girl", "House of Blue"],
      [3, "1002", "Rahul Verma", 62, 58, 64, 55, "Class 10-A", "Boy", "House of Emerald"],
      [4, "1003", "Priya Nair", 79, 78, 76, 77, "Class 10-A", "Girl", "House of Phoenix"],
      [5, "1004", "Ben Thomas", 45, 28, 52, 40, "Class 10-A", "Boy", "House of Blue"],
      [6, "1005", "Fatima Khan", 75, 72, 70, 71, "Class 10-A", "Girl", "House of Emerald"],
      [7, "1006", "David Miller", 0, 45, 50, 48, "Class 10-A", "Boy", "House of Phoenix"]
    ];
  }

  async function loadSampleMarks() {
    const XLSX = root.XLSX;
    if (!XLSX) throw new Error("XLSX component not ready");
    const sampleRows = createSampleWorkbookData();
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sampleRows);
    XLSX.utils.book_append_sheet(wb, ws, "Marks Consolidation");
    const arrayBuffer = await XLSX.write(wb);
    return ingestMarksWorkbook(arrayBuffer, {
      examName: "Pre Mid Term Examination",
      academicYear: "2026–27",
      maximumMarks: 80,
      passMark: 33
    });
  }

  const api = {
    store,
    parsePhotoFilename,
    normalizeAdmission,
    normalizeName,
    registerProcessedPhoto,
    getStudentPhoto,
    getStudentPhotoUrl,
    ingestMarksWorkbook,
    lookupStudent,
    renderScoreboardHTML,
    addChangeListener,
    loadSampleMarks,
    createSampleWorkbookData
  };

  if (typeof module !== "undefined") module.exports = api;
  root.PhotoAnalyticsBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
