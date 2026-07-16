import * as XLSX from "xlsx";
const buf = require("fs").readFileSync("data/uploads/plans.xlsx");
const wb = XLSX.read(buf, { type: "buffer" });
console.log("All sheets:", wb.SheetNames);
// Find all sheets matching Богатов
for (const sn of wb.SheetNames) {
  if (sn.toLowerCase().includes("богатов")) {
    console.log("\n=== Sheet:", sn, "===");
    const ws = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null });
    for (let i = 0; i < 10; i++) {
      const r = rows[i] || [];
      console.log(`Row ${i}:`, JSON.stringify(r.slice(0, 8).map(c => c === null ? "" : String(c))));
    }
  }
}
