import * as XLSX from "xlsx";
const buf = require("fs").readFileSync("data/uploads/plans.xlsx");
const wb = XLSX.read(buf, { type: "buffer" });
console.log("All sheets:");
for (const n of wb.SheetNames) console.log("  -", n);
