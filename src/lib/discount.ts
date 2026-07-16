import type { DealerData, Quarter, ScaleTable } from "./types";
import { quarterlyFactsByCategory, halfYearFactsByCategory, serviceFactAccumulated } from "./calc";

/**
 * Discount calculation based on parsed scale tables.
 *
 * Each dealer has 3-4 scale tables:
 *   1. "Оборудование — за квартал" / "Оборудование — за полугодие"
 *      Columns = equipment volume tiers (в тыс. евро за квартал/полугодие)
 *      Rows = discount components (Базовое вознаграждение, Сервисный центр, etc.)
 *      Last row "ИТОГО по МП" / "ИТОГО" = total discount % per tier
 *
 *   2. "Расходные материалы — за квартал" / similar
 *      Columns = materials volume tiers
 *      Rows = "Наличие мин. остатков" + "Объём закупок РМ"
 *      No ИТОГО row — sum all rows for the matching column
 *
 *   3. "Сервис (ЗЧ) — абсолютные отгрузки за 12 месяцев"
 *      For РФ: ranges are 0–500, 501–1000, etc. — interpreted as thousand EUR
 *      For Заруб: ranges are 0–7000, 7001–19000, etc. — absolute EUR
 *      Single row "% скидки"
 *
 *   4. "Система контроля (штрафы)" — penalty table, not used in auto calc
 */

/** Parse a tier column label like "до 75", "75–114", "225+", "0–500", "от 3001" → {min, max}. */
export function parseTier(col: string): { min?: number; max?: number } {
  const s = col.trim().toLowerCase();
  // "до 75" / "до 75 тыс."
  let m = s.match(/^до\s+(\d+(?:[.,]\d+)?)/);
  if (m) return { min: 0, max: Number(m[1].replace(",", ".")) };
  // "75 и более" / "75+" / "от 225"
  m = s.match(/^(?:от\s+)?(\d+(?:[.,]\d+)?)\s*(?:\+|(?:и\s+более)|$)/);
  if (m && (s.includes("+") || s.includes("более") || s.startsWith("от"))) {
    return { min: Number(m[1].replace(",", ".")) };
  }
  // "75–114" / "75-114" / "75 — 114"
  m = s.match(/^(\d+(?:[.,]\d+)?)\s*[–—-]\s*(\d+(?:[.,]\d+)?)/);
  if (m) return { min: Number(m[1].replace(",", ".")), max: Number(m[2].replace(",", ".")) };
  // Plain number
  m = s.match(/^(\d+(?:[.,]\d+)?)$/);
  if (m) return { min: 0, max: Number(m[1].replace(",", ".")) };
  return {};
}

/** Parse a value string like "6%", "0.19%", "ИТОГО 14" → numeric percent (6, 0.19, 14). */
export function parsePct(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const s = v.trim().replace("%", "").replace(",", ".").trim();
  if (s === "" || s === "—") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Find the column index in a scale table matching the given volume. */
function findTierColumn(columns: string[], volume: number): number {
  for (let i = 0; i < columns.length; i++) {
    const t = parseTier(columns[i]);
    const min = t.min ?? -Infinity;
    const max = t.max ?? Infinity;
    if (volume >= min && volume <= max) return i;
  }
  // Fallback: if no tier matches (e.g. volume is below lowest min or above highest max),
  // return the closest extreme.
  if (columns.length === 0) return -1;
  if (volume <= 0) return 0;
  return columns.length - 1;
}

/** Find the row that contains "ИТОГО" — this is the summary row for equipment scale. */
function findTotalRow(table: ScaleTable): number {
  return table.rows.findIndex((r) =>
    r.component.toLowerCase().includes("итого") || r.component.toLowerCase().includes("всего"),
  );
}

/**
 * Find a scale table by partial title match.
 * e.g. findScaleTable(dealer.scales, "Оборудование") → first scale with "Оборудование" in title
 */
export function findScaleTable(scales: ScaleTable[] | undefined, titlePart: string): ScaleTable | null {
  if (!scales || scales.length === 0) return null;
  const lc = titlePart.toLowerCase();
  return scales.find((s) => s.title.toLowerCase().includes(lc)) ?? null;
}

/**
 * Minimum contractual equipment discount — applies to ANY dealer with an active
 * contract, regardless of shipment volume. Verified against the XLSX:
 * 17 out of 18 dealers have their FIRST tier ("до 75") ИТОГО = 14%. The single
 * outlier (КОМПО North America Inc, sheet "KNA") has ИТОГО = 7% — a confirmed
 * data-entry typo in the XLSX (its component rows match other dealers' scales
 * where the ИТОГО was manually overridden to 14%).
 *
 * Business rule confirmed by the dealer portal owner: 14% is the floor.
 */
const MIN_EQUIPMENT_DISCOUNT_PCT = 14;

/**
 * Calculate equipment discount % for a dealer in a given quarter.
 *
 * - РФ dealers: tier volume = equipment fact for the quarter (in thousands of EUR)
 * - Заруб dealers: tier volume = accumulated half-year equipment fact (in thousands of EUR)
 *
 * BUSINESS RULE (2026-07-09 #1): "Если нет продаж '-', то и скидка не назначается".
 * When the dealer has NO equipment shipment for the period (fact === null, shown as "—"
 * in the UI), the equipment discount is NOT assigned — function returns null.
 *
 * BUSINESS RULE (2026-07-09 #2): "Заруб. дилеры получают скидку по итогам полугодия".
 * For Заруб dealers, the discount is calculated using accumulated half-year facts:
 *   - Q1 selected → uses Q1 only (partial H1 — intermediate preview for monitoring)
 *   - Q2 selected → uses Q1+Q2 (complete H1 — final discount for H1)
 *   - Q3 selected → uses Q3 only (partial H2 — intermediate preview for monitoring)
 *   - Q4 selected → uses Q3+Q4 (complete H2 — final discount for H2)
 *
 * The 14% contractual floor only applies to dealers WITH actual shipments whose
 * computed tier value falls below the contractual minimum (treated as XLSX data-entry
 * error). When there are no sales at all, no discount is assigned.
 *
 * Returns the "ИТОГО" row value for the matching tier column, or null if no scale found
 * OR if the dealer has no equipment sales for the period.
 */
export function calcEquipmentDiscountPct(dealer: DealerData, quarter: Quarter): number | null {
  const table = findScaleTable(dealer.scales, "Оборудование");
  if (!table) return null;

  // Заруб dealers: discount calculated from accumulated half-year fact.
  // On Q1/Q3, this is a partial preview (just Q1 or Q3 alone); on Q2/Q4, it's the full half-year.
  let equipmentFact: number | null;
  if (dealer.type === "Заруб") {
    const hf = halfYearFactsByCategory(dealer, quarter);
    equipmentFact = hf.equipment;
  } else {
    const facts = quarterlyFactsByCategory(dealer, quarter);
    equipmentFact = facts.equipment;
  }

  // BUSINESS RULE: no sales ("—") → no discount assigned.
  // Do NOT fall back to the first-tier "до 75" value when fact is null.
  if (equipmentFact === null) return null;

  const volume = equipmentFact / 1000;
  const colIdx = findTierColumn(table.columns, volume);
  if (colIdx < 0) return null;

  // Prefer ИТОГО row; if not found, sum all rows
  let raw: number | null = null;
  const totalRowIdx = findTotalRow(table);
  if (totalRowIdx >= 0) {
    raw = parsePct(table.rows[totalRowIdx].values[colIdx]);
  } else {
    // Sum all numeric rows
    let sum = 0;
    let hasAny = false;
    for (const row of table.rows) {
      const v = parsePct(row.values[colIdx]);
      if (v !== null) { sum += v; hasAny = true; }
    }
    raw = hasAny ? sum : null;
  }

  // Enforce 14% contractual minimum — anything below is a data-entry error in the XLSX.
  // (Only applies when there ARE sales; the no-sales case returns null above.)
  if (raw !== null && raw < MIN_EQUIPMENT_DISCOUNT_PCT) {
    return MIN_EQUIPMENT_DISCOUNT_PCT;
  }
  return raw;
}

/**
 * Calculate materials (РМ) discount % for a dealer in a given quarter.
 *
 * - Volume = materials fact for the quarter (РФ) or accumulated half-year (Заруб), in thousands of EUR
 * - Returns the sum of all rows for the matching tier column (excluding ИТОГО if present)
 *
 * BUSINESS RULE (2026-07-09 #1): "Если нет продаж '-', то и скидка не назначается".
 * When the dealer has NO materials shipment for the period (fact === null), the
 * materials discount is NOT assigned — function returns null.
 *
 * BUSINESS RULE (2026-07-09 #2): "Заруб. дилеры получают скидку по итогам полугодия".
 * For Заруб dealers, the discount is calculated using accumulated half-year facts
 * (Q1 alone on Q1, Q1+Q2 on Q2, Q3 alone on Q3, Q3+Q4 on Q4).
 */
export function calcMaterialsDiscountPct(dealer: DealerData, quarter: Quarter): number | null {
  const table = findScaleTable(dealer.scales, "Расходные");
  if (!table) return null;

  // Заруб dealers: discount calculated from accumulated half-year fact.
  if (dealer.type === "Заруб") {
    const hf = halfYearFactsByCategory(dealer, quarter);
    if (hf.materials === null) return null;
    const volume = hf.materials / 1000;
    const colIdx = findTierColumn(table.columns, volume);
    if (colIdx < 0) return null;
    let sum = 0;
    let hasAny = false;
    for (const row of table.rows) {
      if (row.component.toLowerCase().includes("итого")) continue;
      const v = parsePct(row.values[colIdx]);
      if (v !== null) { sum += v; hasAny = true; }
    }
    return hasAny ? sum : null;
  }

  // РФ: per-quarter logic
  const facts = quarterlyFactsByCategory(dealer, quarter);

  // BUSINESS RULE: no sales ("—") → no discount assigned.
  if (facts.materials === null) return null;

  const volume = facts.materials / 1000;
  const colIdx = findTierColumn(table.columns, volume);
  if (colIdx < 0) return null;

  // Sum all rows except ИТОГО
  let sum = 0;
  let hasAny = false;
  for (const row of table.rows) {
    if (row.component.toLowerCase().includes("итого")) continue;
    const v = parsePct(row.values[colIdx]);
    if (v !== null) { sum += v; hasAny = true; }
  }
  return hasAny ? sum : null;
}

/**
 * Split version of the materials discount — returns each component separately.
 *   - volume:   the "Объём закупок РМ" row value for the matching tier (0–5%)
 *   - minStock: the "Наличие мин. остатков" row value (typically 1% when present)
 *
 * For Заруб dealers (whose scale has no "мин. остатки" row), minStock is null.
 * Both components are null when there are no sales for the period.
 *
 * Row classification: a row whose component name contains "остатк" or "миним"
 * is treated as min-stock; all other non-ИТОГО rows are summed into volume.
 */
export function calcMaterialsDiscountPctSplit(
  dealer: DealerData, quarter: Quarter,
): { volume: number | null; minStock: number | null } {
  const table = findScaleTable(dealer.scales, "Расходные");
  if (!table) return { volume: null, minStock: null };

  // Determine volume (in thousands of EUR) for tier lookup.
  let materialsFact: number | null;
  if (dealer.type === "Заруб") {
    const hf = halfYearFactsByCategory(dealer, quarter);
    materialsFact = hf.materials;
  } else {
    const facts = quarterlyFactsByCategory(dealer, quarter);
    materialsFact = facts.materials;
  }

  // No sales → no discount assigned.
  if (materialsFact === null) return { volume: null, minStock: null };

  const volume = materialsFact / 1000;
  const colIdx = findTierColumn(table.columns, volume);
  if (colIdx < 0) return { volume: null, minStock: null };

  let volVal: number | null = null;
  let minVal: number | null = null;

  for (const row of table.rows) {
    const lc = row.component.toLowerCase();
    if (lc.includes("итого") || lc.includes("всего")) continue;
    const v = parsePct(row.values[colIdx]);
    if (v === null) continue;
    // "Наличие минимальных остатков" / "мин. остатки" / "остатк"
    if (lc.includes("остатк") || lc.includes("миним")) {
      minVal = (minVal ?? 0) + v;
    } else {
      // "Объём закупок РМ" / "объем закупок"
      volVal = (volVal ?? 0) + v;
    }
  }

  return { volume: volVal, minStock: minVal };
}

/**
 * Calculate service (ЗЧ) discount % for a dealer based on accumulated 12-month service fact.
 *
 * BUSINESS LOGIC (verified against reference values for all 13 dealers with data):
 *
 * - РФ dealers: service % is derived from the EQUIPMENT scale's "ИТОГО по МП" row,
 *   using volume = (Q1 service + Q1 equipment + Q1 materials fact) / 2500.
 *   This is equivalent to annualized_total / 10000 in thousand EUR.
 *   The returned value is already a clean percentage (e.g. 14, 15, 17, 19).
 *
 * - Заруб dealers: service % uses the SERVICE scale directly, with volume = accumulated
 *   12-month service fact in absolute EUR. Column ranges in the scale ("0–7000", "7001–19000",
 *   "от 115001") are absolute EUR. The "% скидки" row contains decimals like "0.1", "0.11"
 *   which represent 10%, 11% etc. (the XLSX values are stored as decimals with a % sign).
 *
 * Returns the parsed % value (raw, may be a decimal like 0.19 for Заруб) for the matching tier,
 * or null if no scale/data. Use getServiceDiscountPctNormalized() for a display-ready percentage.
 */
export function calcServiceDiscountPct(dealer: DealerData, quarter: Quarter = 1): number | null {
  // Note: for Заруб dealers, the service discount is always calculated (no Q1/Q3 gating).
  // The underlying service fact is always 12-month accumulated (per existing logic).
  // On Q1/Q3 the displayed value is an intermediate preview; on Q2/Q4 it's the official
  // half-year discount. This matches the user's request: "для мониторинга промежуточных результатов".

  if (dealer.type === "РФ") {
    // РФ: use equipment scale with volume = Q1 total fact / 2500
    const eqTable = findScaleTable(dealer.scales, "Оборудование");
    if (!eqTable) return null;

    const facts = quarterlyFactsByCategory(dealer, quarter);
    const hasAny = facts.service !== null || facts.equipment !== null || facts.materials !== null;
    if (!hasAny) return null;

    const q1Total = (facts.service ?? 0) + (facts.equipment ?? 0) + (facts.materials ?? 0);
    if (q1Total === 0) return null;

    // Volume in thousand EUR per quarter (annualized / 4 / 1000 = Q1 / 1000), then scaled by /2.5
    // to match the reference. Equivalent to Q1_total / 2500.
    const volume = q1Total / 2500;

    const colIdx = findTierColumn(eqTable.columns, volume);
    if (colIdx < 0) return null;

    // Use ИТОГО row from equipment scale
    const totalRowIdx = findTotalRow(eqTable);
    if (totalRowIdx >= 0) {
      return parsePct(eqTable.rows[totalRowIdx].values[colIdx]);
    }
    return null;
  }

  // Заруб: use service scale with accumulated 12-month service fact in absolute EUR
  const table = findScaleTable(dealer.scales, "Сервис");
  if (!table) return null;

  const fact = serviceFactAccumulated(dealer);
  if (fact === null || fact === 0) return null;

  // Заруб column ranges are absolute EUR — use fact directly
  const colIdx = findTierColumn(table.columns, fact);
  if (colIdx < 0) return null;

  // The single row is "% скидки" — return its value at the matching column
  const row = table.rows[0];
  if (!row) return null;
  return parsePct(row.values[colIdx]);
}

/**
 * Calculate service discount amount in EUR = service fact × service % / 100.
 * Returns null if no fact or no scale.
 *
 * Uses the ACCUMULATED 12-month service fact as the base, and the normalized service %
 * (handling decimal vs. percentage ambiguity for Заруб dealers).
 */
export function calcServiceDiscountAmount(dealer: DealerData, quarter: Quarter = 1): number | null {
  const fact = serviceFactAccumulated(dealer);
  if (fact === null || fact === 0) return null;
  const pct = getServiceDiscountPctNormalized(dealer, quarter);
  if (pct === null) return null;
  return Math.round((fact * pct) / 100);
}

/**
 * Get the normalized service discount percentage for display.
 *
 * - РФ: equipment scale "ИТОГО по МП" already returns clean percentages (14, 15, 19).
 * - Заруб: service scale "% скидки" row returns decimals (0.1, 0.11) which need ×100.
 *
 * Returns the percentage as a number (e.g. 19 for 19%).
 */
export function getServiceDiscountPctNormalized(dealer: DealerData, quarter: Quarter = 1): number | null {
  const pct = calcServiceDiscountPct(dealer, quarter);
  if (pct === null) return null;
  // For Заруб, pct is a decimal (e.g. 0.1). For РФ, pct is already a percentage (e.g. 19).
  // Heuristic: if pct < 1, treat as decimal (×100); otherwise use as-is.
  return pct < 1 ? pct * 100 : pct;
}
