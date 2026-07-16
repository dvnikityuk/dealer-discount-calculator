import * as XLSX from "xlsx";
const buf = require("fs").readFileSync("data/uploads/plans.xlsx");
const wb = XLSX.read(buf, { type: "buffer" });
const ws = wb.Sheets["KNA"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null });
console.log("Total rows:", rows.length);
for (let i = 0; i < Math.min(rows.length, 35); i++) {
  const r = rows[i] || [];
  const cells = r.map(c => c === null ? "" : String(c)).slice(0, 12);
  console.log(`Row ${i}:`, JSON.stringify(cells));
}
