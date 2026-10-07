const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

console.log("=== Running Teacher Utility Suite Verification Tests ===\n");

// -------------------------------------------------------------
// 1. SANITIZATION AUDIT
// -------------------------------------------------------------
console.log("1. Checking file sanitization (no proprietary telemetry, backend or internal data)...");

const suiteFiles = [
  "vendor/xlsx-reader.js",
  "modules/scoreboard/scoreboard.js",
  "modules/scoreboard/scoreboard.css",
  "modules/analytics/result-analytics-core.js",
  "modules/analytics/result-analytics.js",
  "modules/analytics/result-analytics.css",
  "modules/analytics/page2-analytics.js",
  "modules/analytics/page2-ui.js",
  "modules/analytics/page2-ui.css",
  "modules/analytics/page3-analytics.js",
  "modules/analytics/page3-ui.js",
  "modules/analytics/page3-ui.css",
  "modules/analytics/page3-filter-ui.js",
  "modules/analytics/page3-filter-ui.css",
  "modules/integration/photo-analytics-bridge.js",
  "student_photo_processor.html",
  "index.html"
];

const forbiddenPatterns = [
  { name: "Google Analytics Tag ID", pattern: /G-WNEYWX5WTY/ },
  { name: "Google Tag Manager URL", pattern: /googletagmanager\.com/ },
  { name: "AcadPulse Telemetry Hook", pattern: /AcadPulseAnalytics/ },
  { name: "Developer Email Credit", pattern: /shahbaaz\.education@gmail\.com/ },
  { name: "PostgreSQL Database Connection", pattern: /postgresql:\/\//i }
];

for (const relPath of suiteFiles) {
  const fullPath = path.resolve(__dirname, "..", relPath);
  assert.ok(fs.existsSync(fullPath), `File must exist: ${relPath}`);
  const content = fs.readFileSync(fullPath, "utf8");

  for (const { name, pattern } of forbiddenPatterns) {
    assert.ok(!pattern.test(content), `Sanitization violation: ${name} found in ${relPath}`);
  }
}
console.log("✓ All copied and created files are 100% sanitized.\n");

// -------------------------------------------------------------
// 2. SCOREBOARD GENERATOR MODULE TESTS
// -------------------------------------------------------------
console.log("2. Testing Scoreboard Generator data transformers & calculations...");

const Scoreboard = require("../modules/scoreboard/scoreboard.js");

// Points rules: 95+ -> 5, 81-94.99 -> 3, 61-80.99 -> 2, <61 -> 0
assert.equal(Scoreboard.pointsForPercentage(95), 5);
assert.equal(Scoreboard.pointsForPercentage(96.5), 5);
assert.equal(Scoreboard.pointsForPercentage(94.99), 3);
assert.equal(Scoreboard.pointsForPercentage(81), 3);
assert.equal(Scoreboard.pointsForPercentage(80.99), 2);
assert.equal(Scoreboard.pointsForPercentage(61), 2);
assert.equal(Scoreboard.pointsForPercentage(60.99), 0);
assert.equal(Scoreboard.pointsForPercentage(0), 0);
assert.equal(Scoreboard.pointsForPercentage(null), null);
assert.equal(Scoreboard.pointsForPercentage(""), null);

// Percentage calculation
assert.equal(Scoreboard.percentageForMark(40, 80), 50);
assert.equal(Scoreboard.percentageForMark(80, 80), 100);
assert.equal(Scoreboard.percentageForMark("Absent", 80), null);

// House normalization
assert.equal(Scoreboard.normalizeHouse(" BLUE "), "House of Blue");
assert.equal(Scoreboard.normalizeHouse("Red House"), "House of Red");
assert.equal(Scoreboard.normalizeHouse("HOUSE OF PHOENIX"), "House of Phoenix");

// Structure detection & Scoreboard build
const sampleRows = [
  ["Roll No", "ADMNO", "Student Name", "Science", "Maths", "House"],
  [1, "1234", "John Doe", 76, 72, "House of Blue"],
  [2, "1001", "Asha", 80, 78, "House of Blue"],
  [3, "1002", "Ben", 40, 50, "House of Red"]
];
const sbStructure = Scoreboard.detectStructure(sampleRows);
assert.deepEqual(sbStructure.subjects.map(s => s.name), ["Science", "Maths"]);
const houses = Scoreboard.buildScoreboard(sbStructure, { Science: 80, Maths: 80 });

assert.ok(houses["House of Blue"]);
assert.ok(houses["House of Red"]);
assert.equal(houses["House of Blue"].length, 2);
// John Doe: 76/80=95% (5pts), 72/80=90% (3pts) -> Total 8 pts
assert.equal(houses["House of Blue"][0].total, 8);
// Asha: 80/80=100% (5pts), 78/80=97.5% (5pts) -> Total 10 pts
assert.equal(houses["House of Blue"][1].total, 10);

const blueStats = Scoreboard.houseStats(houses["House of Blue"]);
assert.equal(blueStats.total, 18);
assert.equal(blueStats.average, 9);
console.log("✓ Scoreboard Generator module works correctly.\n");

// -------------------------------------------------------------
// 3. STUDENT MARK ANALYTICS CORE & PAGES 2-3 TESTS
// -------------------------------------------------------------
console.log("3. Testing Student Mark Analytics transformers (Pages 1, 2, 3)...");

const ResultCore = require("../modules/analytics/result-analytics-core.js");
const Page2 = require("../modules/analytics/page2-analytics.js");
const Page3 = require("../modules/analytics/page3-analytics.js");

const analyticsRows = [
  ["Roll Number", "ADMNO", "Student Name", "Physics", "Chemistry", "Class & Section", "Gender", "House"],
  [1, "1234", "John Doe", 75, 70, "10 A", "Boy", "Phoenix"],
  [2, "1001", "Asha", 80, 78, "10 A", "Girl", "Blue"],
  [3, "1002", "Charlie", 20, 60, "10 B", "Boy", "Emerald"],
  [4, "1003", "David", 0, 50, "10 B", "Boy", "Red"]
];

const resStructure = ResultCore.detectResultStructure(analyticsRows);
assert.deepEqual(resStructure.subjects.map(s => s.name), ["Physics", "Chemistry"]);
assert.equal(resStructure.columns.admission, 1);
assert.equal(resStructure.columns.className, 5);

const config = { maximumMarks: 80, passMark: 28 };
const derivedStudents = ResultCore.deriveStudents(resStructure, config);

assert.equal(derivedStudents.length, 4);
assert.equal(derivedStudents[0].result, "PASS");
assert.equal(derivedStudents[1].result, "PASS");
assert.equal(derivedStudents[2].result, "FAIL"); // Physics is 20 < 28
assert.equal(derivedStudents[3].result, "ABSENT"); // Physics is 0 (absent)

const summary = ResultCore.summarize(derivedStudents, resStructure.subjects);
assert.equal(summary.totalStudents, 4);
assert.equal(summary.passed, 2);
assert.equal(summary.passPercentage, 50);

// Page 2 Analysis
const p2Analysis = Page2.analyze(derivedStudents, resStructure.subjects, config);
assert.equal(p2Analysis.subjectSummary.length, 2);
assert.equal(p2Analysis.subjectSummary[0].highestMark, 80);
assert.equal(p2Analysis.classPerformance.length, 2); // 10 A and 10 B

// Page 3 Analysis
const p3Analysis = Page3.analyze(derivedStudents, resStructure.subjects, config, {}, "1234");
assert.ok(p3Analysis.profile);
assert.equal(p3Analysis.profile.name, "John Doe");
assert.equal(p3Analysis.profile.admission, "1234");
assert.equal(p3Analysis.profile.totalMarks, 145);
assert.equal(p3Analysis.profile.passedSubjects, 2);
console.log("✓ Student Mark Analytics core & multi-page transformers work accurately.\n");

// -------------------------------------------------------------
// 4. PHOTO-ANALYTICS BRIDGE & DATA INGESTION POINT TESTS
// -------------------------------------------------------------
console.log("4. Testing Photo Analytics Bridge (filename parsing, data ingestion, scoreboard rendering)...");

const Bridge = require("../modules/integration/photo-analytics-bridge.js");

// Filename parsing
const p1 = Bridge.parsePhotoFilename("1234 John Doe.jpg");
assert.equal(p1.admissionNumber, "1234");
assert.equal(p1.studentName, "John Doe");

const p2 = Bridge.parsePhotoFilename("1001_Asha_Sharma.png");
assert.equal(p2.admissionNumber, "1001");
assert.equal(p2.studentName, "Asha_Sharma");

const p3 = Bridge.parsePhotoFilename("ADM42-David Miller.jpeg");
assert.equal(p3.admissionNumber, "ADM42");
assert.equal(p3.studentName, "David Miller");

const p4 = Bridge.parsePhotoFilename("5678.jpg");
assert.equal(p4.admissionNumber, "5678");

// Admission normalization
assert.equal(Bridge.normalizeAdmission(" 1234 "), "1234");
assert.equal(Bridge.normalizeAdmission("01234"), "1234");
assert.equal(Bridge.normalizeAdmission("adm-42"), "adm42");

// Ingestion of mock data into Bridge store
// Prepare XLSX in Node using our local xlsx-reader
const XLSX = require("../vendor/xlsx-reader.js");
global.XLSX = XLSX;
global.ResultAnalyticsCore = ResultCore;
global.ScoreboardGenerator = Scoreboard;
global.ResultAnalyticsPage3 = Page3;

(async () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(analyticsRows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buffer = await XLSX.write(wb);

  const ingResult = await Bridge.ingestMarksWorkbook(buffer, {
    examName: "Annual Exam",
    academicYear: "2026–27",
    maximumMarks: 80,
    passMark: 28
  });

  assert.equal(ingResult.studentCount, 4);

  // Lookup student by parsed admission number
  const john = Bridge.lookupStudent("1234");
  assert.ok(john, "John Doe must be found by ADMNO 1234");
  assert.equal(john.student.name, "John Doe");
  assert.equal(john.student.result, "PASS");

  const asha = Bridge.lookupStudent("01001"); // Leading zero test
  assert.ok(asha, "Asha must be found by normalized ADMNO");
  assert.equal(asha.student.name, "Asha");

  // Render scoreboard HTML
  const johnScoreboard = Bridge.renderScoreboardHTML("1234", "John Doe");
  assert.ok(johnScoreboard.includes("PASS"));
  assert.ok(johnScoreboard.includes("145"));
  assert.ok(johnScoreboard.includes("Physics"));
  assert.ok(johnScoreboard.includes("Chemistry"));

  // Check unlinked case
  const unlinked = Bridge.renderScoreboardHTML("9999", "Unknown Student");
  assert.ok(unlinked.includes("No match for ADMNO"));

  // Register processed photo
  Bridge.registerProcessedPhoto("1234", {
    filename: "JOHN_DOE.jpg",
    studentName: "JOHN DOE",
    sizeKB: "38.5",
    objectUrl: "blob:mock-url"
  });

  const photoRecord = Bridge.getStudentPhoto("1234");
  assert.ok(photoRecord);
  assert.equal(photoRecord.sizeKB, "38.5");
  assert.equal(Bridge.getStudentPhotoUrl("1234"), "blob:mock-url");

  console.log("✓ Photo-Analytics Bridge, ADMNO parsing, and data ingestion point verified successfully.\n");
  console.log("=== ALL SUITE INTEGRATION TESTS PASSED ===");
})();
