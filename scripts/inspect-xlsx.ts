import * as XLSX from "xlsx";
import { promises as fs } from "fs";

const XLSX_PATH = "/home/z/my-project/upload/Условия работы ТПС  2026 с корректировками_отправка.xlsx";

async function main() {
  const buf = await fs.readFile(XLSX_PATH);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });

  console.log("Sheets:", wb.SheetNames);

  // Pick a РФ dealer sheet and a Заруб sheet
  const rfSheet = wb.SheetNames.find((n) => n && !["Лист1", "Лист2", "Лист3"].includes(n) && n !== "ABS");
  const foreignSheet = "ABS";

  for (const sheetName of [rfSheet, foreignSheet].filter(Boolean) as string[]) {
    console.log("\n========== SHEET:", sheetName, "==========");
    const ws = wb.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null });
    console.log("Total rows:", rows.length);
    rows.forEach((r, i) => {
      const nonEmpty = r.filter((v) => v !== null && v !== undefined && v !== "").length;
      if (nonEmpty > 0) {
        // Truncate long cell values
        const r2 = r.map((v) => {
          if (v === null || v === undefined) return "·";
          const s = String(v);
          return s.length > 30 ? s.substring(0, 28) + "…" : s;
        });
        console.log(`R${i + 1} (${nonEmpty}):`, JSON.stringify(r2.slice(0, 12)));
      }
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
