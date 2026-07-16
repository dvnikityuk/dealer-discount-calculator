// Quick check: dump the structure of each scale table.
import { promises as fs } from "fs";
import * as XLSX from "xlsx";

const XLSX_PATH = "/home/z/my-project/data/uploads/plans.xlsx";
const buf = await fs.readFile(XLSX_PATH);
const wb = XLSX.read(buf, { type: "buffer", cellDates: false });

// Pick the first РФ sheet and the first Заруб sheet (ABS)
const rfSheet = wb.SheetNames.find(n => !["Лист1","Лист2","Лист3","ABS","KNA","Deling","VitLine","Universal","LUCKY","Сейитлиев","Ingreda","Кабири","Flexo"].includes(n));
const foreignSheet = "ABS";

for (const sheetName of [rfSheet, foreignSheet].filter(Boolean)) {
  console.log("\n========== SHEET:", sheetName, "==========");
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null });
  rows.forEach((r, i) => {
    const nonEmpty = r.filter(v => v !== null && v !== undefined && v !== "").length;
    if (nonEmpty > 0) {
      const r2 = r.map(v => v === null || v === undefined ? "·" : String(v).slice(0, 28));
      console.log(`R${i+1} (${nonEmpty}):`, JSON.stringify(r2.slice(0, 14)));
    }
  });
}
