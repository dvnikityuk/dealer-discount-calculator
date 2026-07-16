import * as XLSX from "xlsx";
const buf = require("fs").readFileSync("data/uploads/plans.xlsx");
const wb = XLSX.read(buf, { type: "buffer" });
for (const sheet of ["CLIPSOMAC", "Tida Tech", "Ari Makina"]) {
  console.log("\n=== Sheet:", sheet, "===");
  const ws = wb.Sheets[sheet];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null });
  for (let i = 9; i < 20; i++) {
    const r = rows[i] || [];
    const cells = r.map(c => c === null ? "" : String(c)).slice(0, 9);
    console.log(`Row ${i}:`, JSON.stringify(cells));
  }
}
