// Ad-hoc test for the hardened attendance parser (run: node backend/test_attendance.js)
// Not part of the app — exercises getAttendance()'s value-based datetime
// detection + diagnostic error against mock iiko responses.
const svc = require("./dashboardService");
let failed = 0;
function ok(name, cond, detail) { if (!cond) failed++; console.log((cond ? "PASS" : "FAIL") + " - " + name + (detail ? " :: " + detail : "")); }

(async () => {
  // 1. Unusual field names ("shiftBegin"/"shiftFinish") that match no name
  //    pattern — must be detected by their datetime VALUES.
  const client1 = {
    getAttendance: async () => [
      { id: "a1", worker: "emp-1", shiftBegin: "2026-07-10T09:00:00", shiftFinish: "2026-07-10T18:00:00", note: "ok" },
      { id: "a2", worker: "emp-1", shiftBegin: "2026-07-11T10:00:00", shiftFinish: "2026-07-11T19:30:00", note: "ok" },
    ],
    getEmployees: async () => [{ id: "emp-1", firstName: "Иван", lastName: "Петров" }],
  };
  const r1 = await svc.getAttendance(client1, "2026-07-01", "2026-07-12", null);
  ok("value-based detection: available", r1.available === true, JSON.stringify(r1).slice(0, 120));
  ok("value-based detection: 2 records", r1.records.length === 2);
  ok("value-based detection: hours computed", r1.records.some((x) => x.hours === 9) && r1.records.some((x) => x.hours === 9.5), JSON.stringify(r1.records.map((x) => x.hours)));
  ok("value-based detection: name resolved", r1.records[0].employeeName === "Петров Иван", r1.records[0].employeeName);
  ok("value-based detection: date extracted", r1.records[0].date && /^2026-07-1[01]$/.test(r1.records[0].date), r1.records[0].date);

  // 2. Standard dateFrom/dateTo names — must match by name.
  const client2 = {
    getAttendance: async () => ({ employeeAttendances: [{ employeeId: "e9", dateFrom: "2026-07-05T08:00:00", dateTo: "2026-07-05T16:00:00" }] }),
    getEmployees: async () => [{ id: "e9", name: "Смена Кассир" }],
  };
  const r2 = await svc.getAttendance(client2, "2026-07-01", "2026-07-12", null);
  ok("wrapper key employeeAttendances unwrapped", r2.available === true && r2.records.length === 1, JSON.stringify(r2).slice(0, 120));
  ok("standard names: 8h shift", r2.records[0].hours === 8, String(r2.records[0].hours));

  // 3. No datetime fields anywhere — must return diagnostic error listing keys.
  const client3 = {
    getAttendance: async () => [{ id: "x", employeeCode: "123", status: "active" }],
    getEmployees: async () => [],
  };
  const r3 = await svc.getAttendance(client3, "2026-07-01", "2026-07-12", null);
  ok("no-datetime: available=false", r3.available === false);
  ok("no-datetime: error lists real fields", /employeeCode/.test(r3.error || "") && /status/.test(r3.error || ""), r3.error);

  // 4. Empty result — available with no records (not an error).
  const client4 = { getAttendance: async () => [], getEmployees: async () => [] };
  const r4 = await svc.getAttendance(client4, "2026-07-01", "2026-07-12", null);
  ok("empty: available with 0 records", r4.available === true && r4.records.length === 0);

  // 5. Employee filter works.
  const r5 = await svc.getAttendance(client1, "2026-07-01", "2026-07-12", "emp-1");
  ok("filter by employeeId keeps matches", r5.records.length === 2);
  const r5b = await svc.getAttendance(client1, "2026-07-01", "2026-07-12", "nope");
  ok("filter by employeeId drops non-matches", r5b.records.length === 0);

  console.log("\n" + (failed === 0 ? "ALL PASS" : failed + " FAILED"));
  process.exit(failed === 0 ? 0 : 1);
})();
