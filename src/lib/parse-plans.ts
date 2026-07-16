import * as XLSX from "xlsx";
import { promises as fs } from "fs";
import type { DealerType, ScaleTable, ScaleRow } from "./types";

/**
 * Dealers excluded from the application (matched case-insensitively as substrings
 * against sheet name OR display name).
 *
 * 2026-07-09: Added "tida tech" (Thailand), "ari makina" (Turkey), "clipsomac" (Algeria).
 * These three dealers have NO sales at all (all months null for all 3 categories).
 * Per the new business rule "Если нет продаж '-', то и скидка не назначается" —
 * and per the user's explicit request — they are removed from the plan entirely.
 *
 * The previous XLSX had a duplicate combined sheet "Богатовъ технолоджис+ТД Богатов"
 * which was excluded via the substring "технолоджис". The CURRENT XLSX no longer
 * has that duplicate — the user cleaned it up — so we must NOT use "технолоджис"
 * as a filter, because it would also match "КОМПО Технолоджис" (sheet "КТ").
 */
export const EXCLUDED_DEALERS: string[] = [
  "tida tech",   // Tida Tech, Таиланд — no sales, removed by user request
  "ari makina",  // Ari Makina, Турция — no sales, removed by user request
  "clipsomac",   // CLIPSOMAC, Алжир — no sales, removed by user request
];

export interface ParsedXlsxDealer {
  sheetName: string;
  displayName: string;
  type: DealerType;
  plan: {
    service: number;
    equipment: number;
    materials: number;
  };
  scales: ScaleTable[];
  csvName: string;
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/**
 * Normalize a percent value from the XLSX.
 *
 * The XLSX stores service-scale (ЗЧ) percentages as DECIMALS:
 *   - РФ service scale: 0.15, 0.19, 0.21, 0.23, 0.25, 0.27, 0.30
 *     (meaning 15%, 19%, 21%, 23%, 25%, 27%, 30%)
 *   - Заруб service scale: 0.10, 0.11, 0.13 ... 0.22
 *     (meaning 10%, 11%, 13% ... 22%)
 *
 * Equipment & materials scales already use clean integers (6, 14, 19, etc.).
 *
 * Heuristic: if value < 1, treat as decimal and multiply by 100.
 * Returns the value as a clean number (19, 21, 10, 11, etc.).
 */
function normalizePct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  // Multiply by 100 if decimal (XLSX stores 0.19 meaning 19%).
  // Round to 2 decimals to avoid floating-point noise (0.14 * 100 = 14.000000000000002).
  const v = n < 1 ? n * 100 : n;
  return Math.round(v * 100) / 100;
}

/** Detect dealer type: РФ sheets have "Сервисный центр" row. Заруб sheets have "Наличие сервисного центра". */
function detectType(rows: unknown[][], labelCol: number): DealerType {
  for (const r of rows.slice(0, 25)) {
    const cell = str(r[labelCol]);
    if (cell.includes("Сервисный центр") && !cell.includes("Наличие")) return "РФ";
  }
  return "Заруб";
}

/** Detect the label column (leftmost non-empty, non-numeric cell in row 2 = R3 in Excel). */
function findLabelCol(rows: unknown[][]): number {
  const row = rows[2] || [];
  for (let i = 0; i < row.length; i++) {
    const v = row[i];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "number") continue;
    const s = str(v);
    // Skip pure numeric strings
    if (/^\d+(\.\d+)?$/.test(s)) continue;
    return i;
  }
  return 0;
}

/** Find column index of "План 2026" header in the header row. */
function findPlanCol(rows: unknown[][], labelCol: number): number {
  // Header is in row index 1 (R2 in Excel)
  const header = rows[1] || [];
  for (let i = labelCol + 1; i < header.length; i++) {
    const h = str(header[i]);
    if (h.includes("План 2026") || h.includes("План 2025") || (h === "План")) return i;
  }
  // Fallback: in row 2, find first numeric cell after the label
  const row2 = rows[2] || [];
  for (let i = labelCol + 1; i < row2.length; i++) {
    if (typeof row2[i] === "number") return i;
  }
  return labelCol + 2;
}

/**
 * Extract scales tables from a dealer sheet.
 * After XLSX.utils.sheet_to_json, the layout is:
 *   col 0 = (collapsed empty A/B)
 *   col 1 = component label (was col C in source)
 *   col 2 = secondary label / "Скидка %" / "Ретро-скидка %" (was col D)
 *   col 3..8 = scale tier values (was cols E..J in source)
 */
function extractScales(rows: unknown[][], type: DealerType, labelCol: number): ScaleTable[] {
  const tables: ScaleTable[] = [];
  let i = 9; // scales start around R11 in Excel = row index 9

  const collectCols = (rowIdx: number, count = 6): string[] => {
    const r = rows[rowIdx] || [];
    const cols: string[] = [];
    for (let c = labelCol + 2; c < labelCol + 2 + count && c < r.length; c++) {
      const v = str(r[c]);
      if (v) cols.push(v);
    }
    return cols;
  };

  while (i < rows.length) {
    const row = rows[i] || [];
    const c1 = str(row[labelCol]);
    const c2 = str(row[labelCol + 1]);

    // Detect "ОБЪЕМ закупок оборудования (тысяч евро) за 3 месяца (квартал)" header (РФ)
    // OR "ОБОРУДОВАНИЕ " header (Заруб) OR "ОБЪЕМ закупок РМ" header
    // OR "РАСХОДНЫЕ МАТЕРИАЛЫ ... ОБЪЕМ закупок ..." header (Заруб РМ section)
    // NOTE: We deliberately do NOT match "ОБЪЕМ закупок в тыс. EUR за 6 месяцев" intermediate header
    // (it appears in Заруб sheets between "ОБОРУДОВАНИЕ" and the actual scale rows). Handling it
    // here caused the parser to mistake scale-row VALUES (6, 6, 6...) for column headers.
    if (
      c1.includes("ОБЪЕМ закупок оборудования") ||
      c1.includes("ОБЪЕМ закупок РМ") ||
      (c1 === "ОБОРУДОВАНИЕ") ||
      (c1.includes("РАСХОДНЫЕ МАТЕРИАЛЫ") && c1.includes("ОБЪЕМ"))
    ) {
      const isRm = c1.includes("РМ") || c1.includes("Расходные") || c1.includes("РАСХОДНЫЕ");
      // Find the row that actually has the column labels.
      // For РФ: cols are in the same row as "ОБЪЕМ закупок оборудования".
      // For Заруб: "ОБОРУДОВАНИЕ" → "ОБЪЕМ закупок в тыс. EUR за 6 месяцев" (intermediate, no cols) → next row has cols.
      // We skip rows that don't look like range labels (must contain digits AND dashes/"до"/"более").
      let cols: string[] = [];
      let headerIdx = i;
      for (let delta = 0; delta <= 3; delta++) {
        const candidate = collectCols(i + delta);
        if (candidate.length < 4) continue;
        // Accept only if cols look like range labels (contain digits and dash/до/более)
        const looksLikeRange = candidate.every((s) =>
          /\d/.test(s) && (s.includes("–") || s.includes("-") || s.toLowerCase().includes("до") || s.toLowerCase().includes("более"))
        );
        if (looksLikeRange) {
          cols = candidate;
          headerIdx = i + delta;
          break;
        }
      }
      if (cols.length === 0) { i++; continue; }

      // Normalize column labels: "до 75", "75-114", "75–115", "225 и более" → "до 75", "75–114", "225+"
      const norm = (s: string): string => {
        const m = s.match(/^(\d+)\s*[–-]\s*(\d+)$/);
        if (m) return `${m[1]}–${m[2]}`;
        const m2 = s.match(/^(\d+)\s*(?:и более|и более\?)?$/i);
        if (m2 && s.toLowerCase().includes("более")) return `${m2[1]}+`;
        return s;
      };
      const columns = cols.map(norm);

      // Determine period: РФ uses "квартал" (3 месяца), Заруб uses "полугодие" (6 месяцев)
      // unless this is the РМ section in Заруб (which is still квартал per ABS sheet R19)
      const isHalfYear = type === "Заруб" && !isRm;
      const period = isHalfYear ? "за полугодие" : "за квартал";
      const title = `${isRm ? "Расходные материалы" : "Оборудование"} — ${period}`;

      const scaleRows: ScaleRow[] = [];
      let j = headerIdx + 1;
      // Read scale rows: label in labelCol, values in cols (labelCol+2)..(labelCol+7)
      let safetyCounter = 0;
      while (j < rows.length && safetyCounter < 10) {
        safetyCounter++;
        const r = rows[j] || [];
        const label = str(r[labelCol]);
        if (!label) { j++; continue; }

        // SKIP intermediate headers like "ОБЪЕМ закупок в тыс. EUR за 6 месяцев" (Заруб R13)
        // — they're noise between the section header and the actual scale rows.
        // IMPORTANT: only skip if this is the FULL label (not part of a longer "РАСХОДНЫЕ МАТЕРИАЛЫ..."
        // header which signals a new section and must trigger the STOP branch below).
        if (label.startsWith("ОБЪЕМ закупок в тыс. EUR")) { j++; continue; }

        // Stop on next section header
        if (
          label.includes("ОБЪЕМ закупок оборудования") ||
          label.includes("ОБЪЕМ закупок РМ") ||
          label === "ОБОРУДОВАНИЕ" ||
          (label.includes("РАСХОДНЫЕ МАТЕРИАЛЫ") && label.includes("ОБЪЕМ")) ||
          label.includes("ЗАПЧАСТИ Отгрузки") ||
          label.includes("СИСТЕМА РАСЧЕТА СКИДКИ ПО ЗАПЧАСТЯМ") ||
          label.includes("Система контроля квартального") ||
          label.includes("Система контроля как") ||
          label.includes("диапазон отношения") ||
          label.includes("отгрузки в диапазоне")
        ) break;

        const values: string[] = [];
        for (let c = labelCol + 2; c < labelCol + 2 + 6 && c < r.length; c++) {
          const v = r[c];
          if (v === null || v === undefined || v === "") { values.push(""); continue; }
          const n = num(v);
          values.push(`${n}%`);
        }
        if (values.every((v) => v === "")) break;

        const isTotal = label.toLowerCase().includes("итого");
        scaleRows.push({ component: label, values, isTotal });
        j++;
      }

      if (scaleRows.length > 0) {
        tables.push({ title, columns, rows: scaleRows, period });
      }
      i = j;
      continue;
    }

    // Detect service parts (ЗЧ) scale section (РФ layout)
    if (c1.includes("СИСТЕМА РАСЧЕТА СКИДКИ ПО ЗАПЧАСТЯМ") || (c1 === "" && c2.includes("Отношение объема закупок ЗЧ"))) {
      const title = "Сервис (ЗЧ) — абсолютные отгрузки за 12 месяцев";
      const cols: string[] = [];
      const pcts: string[] = [];
      let j = i + 2; // skip header row + "без статуса партнера"
      let safetyCounter = 0;
      while (j < rows.length && safetyCounter < 15) {
        safetyCounter++;
        const r = rows[j] || [];
        const label = str(r[labelCol]);
        if (!label) { j++; continue; }
        if (label.includes("Система контроля") || label.includes("уменьшение бонуса") || label.includes("Выполнение плановых")) break;
        if (label.includes("диапазон отношения")) {
          const from = num(r[labelCol + 1]);
          const to = num(r[labelCol + 2]);
          const pct = normalizePct(num(r[labelCol + 3]));
          const rangeLabel = to === 0 ? `от ${from}` : `${from}–${to}`;
          cols.push(rangeLabel);
          pcts.push(`${pct}%`);
        }
        j++;
      }
      if (pcts.length > 0) {
        tables.push({
          title,
          columns: cols,
          rows: [{ component: "% скидки", values: pcts, isTotal: false }],
        });
      }
      i = j;
      continue;
    }

    // Detect service parts scale section (Заруб layout: "ЗАПЧАСТИ Отгрузки за 12 месяцев ФГ")
    if (c1.includes("ЗАПЧАСТИ Отгрузки за 12 месяцев")) {
      const title = "Сервис (ЗЧ) — абсолютные отгрузки за 12 месяцев";
      const cols: string[] = [];
      const pcts: string[] = [];
      let j = i + 1;
      let safetyCounter = 0;
      while (j < rows.length && safetyCounter < 15) {
        safetyCounter++;
        const r = rows[j] || [];
        const label = str(r[labelCol]);
        if (!label) { j++; continue; }
        if (label.includes("Система контроля") || label.includes("уменьшение")) break;
        if (label.includes("отгрузки в диапазоне")) {
          const from = num(r[labelCol + 1]);
          const to = num(r[labelCol + 2]);
          const pct = normalizePct(num(r[labelCol + 3]));
          const rangeLabel = to === 0 ? `от ${from}` : `${from}–${to}`;
          cols.push(rangeLabel);
          pcts.push(`${pct}%`);
        }
        j++;
      }
      if (pcts.length > 0) {
        tables.push({
          title,
          columns: cols,
          rows: [{ component: "% скидки", values: pcts, isTotal: false }],
        });
      }
      i = j;
      continue;
    }

    // Detect "Система контроля" penalty table
    if (c1.includes("Система контроля квартального") || c1.includes("Система контроля как")) {
      const title = "Система контроля (штрафы)";
      const columns = ["Скидка будущих периодов квартала, %"];
      const scaleRows: ScaleRow[] = [];
      let j = i + 1;
      let safetyCounter = 0;
      while (j < rows.length && safetyCounter < 10) {
        safetyCounter++;
        const r = rows[j] || [];
        const label = str(r[labelCol]);
        if (!label) break;
        const val = r[labelCol + 2];
        if (val === null || val === undefined || val === "") break;
        const pct = num(val);
        scaleRows.push({ component: label, values: [`${pct}%`] });
        j++;
      }
      if (scaleRows.length > 0) {
        tables.push({ title, columns, rows: scaleRows });
      }
      i = j;
      continue;
    }

    i++;
  }

  return tables;
}

/** Parse XLSX file → list of dealers with plans + scales. */
export async function parsePlansXlsx(path: string): Promise<ParsedXlsxDealer[]> {
  // Read file as Buffer first, then use XLSX.read — more portable than XLSX.readFile
  // (XLSX.readFile uses fs under the hood but throws generic "Cannot access file"
  // errors when bundled by Next.js Turbopack in some environments).
  const buf = await fs.readFile(path);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const result: ParsedXlsxDealer[] = [];

  const summarySheets = new Set(["Лист1", "Лист2", "Лист3"]);

  for (const sheetName of wb.SheetNames) {
    if (summarySheets.has(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null });
    if (rows.length < 8) continue;

    // After sheet_to_json with header:1, leading empty cols are collapsed.
    // Layout: col 0 = collapsed empty, col 1 = label/name, col 2 = secondary label, col 3.. = data
    // Header row is rows[1] (R2). Dealer name is rows[2][1] (R3 col B). Plan values are in rows[3..5].
    // But the actual layout has:
    //   rows[1] = header: [null, ' ', 'Выручка 2024', 'Выручка 2025', 'План 2026', ...]
    //   rows[2] = dealer total: [null, 'КОМПО Технолоджис', 4164812, 4121760, 4142911.99, ...]
    //   rows[3] = Сервис: [null, 'Сервис', 346883, 448343, 480437.99, null, 0.01, 0.3]
    //   rows[4] = Оборудование: ...
    //   rows[5] = Расходные материалы: ...

    const labelCol = findLabelCol(rows);
    const planCol = findPlanCol(rows, labelCol);
    const displayName = str(rows[2]?.[labelCol]);
    if (!displayName) continue;

    const planTotal = num(rows[2]?.[planCol]);
    const svcPlan = num(rows[3]?.[planCol]);
    const eqPlan = num(rows[4]?.[planCol]);
    const matPlan = num(rows[5]?.[planCol]);

    // Fallback: if category plans sum to 0 but planTotal > 0, put everything in equipment
    let finalSvc = svcPlan;
    let finalEq = eqPlan;
    let finalMat = matPlan;
    if (finalSvc + finalEq + finalMat === 0 && planTotal > 0) {
      // Try to find category rows by label
      for (let r = 3; r < 6; r++) {
        const label = str(rows[r]?.[labelCol]).toLowerCase();
        if (label.includes("сервис")) finalSvc = num(rows[r]?.[planCol]);
        else if (label.includes("оборуд")) finalEq = num(rows[r]?.[planCol]);
        else if (label.includes("расход")) finalMat = num(rows[r]?.[planCol]);
      }
      // Edge case: CLIPSOMAC has plan total in Оборудование row only
      if (finalSvc + finalEq + finalMat === 0) finalEq = planTotal;
    }

    const type = detectType(rows, labelCol);
    const scales = extractScales(rows, type, labelCol);

    // Skip excluded dealers (matched case-insensitively against sheet name OR display name)
    const nameLower = displayName.toLowerCase();
    const sheetLower = sheetName.toLowerCase();
    const isExcluded = EXCLUDED_DEALERS.some(
      (e) => nameLower.includes(e) || sheetLower.includes(e),
    );
    if (isExcluded) continue;

    result.push({
      sheetName,
      displayName,
      type,
      plan: { service: finalSvc, equipment: finalEq, materials: finalMat },
      scales,
      csvName: displayName,
    });
  }

  return result;
}
