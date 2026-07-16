import type { DealerData, Quarter } from "./types";

/** Financial year month labels (Apr..Mar). */
export const MONTH_LABELS = [
  "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек", "Янв", "Фев", "Мар",
] as const;

/** Sums the 12 monthly fact values into an annual total. Returns `null` if all months are null. */
export function sumYear(values: (number | null)[]): number | null {
  const filtered = values.filter((v): v is number => v !== null);
  if (filtered.length === 0) return null;
  return filtered.reduce((a, b) => a + b, 0);
}

/** Sums the months belonging to a specific quarter. Q1=Apr..Jun (idx 0..2), Q2=Jul..Sep, etc. */
export function sumQuarter(values: (number | null)[], q: Quarter): number | null {
  const start = (q - 1) * 3;
  const slice = values.slice(start, start + 3);
  return sumYear(slice);
}

/** "нет данных" if all values are null */
export function hasFacts(values: (number | null)[]): boolean {
  return values.some((v) => v !== null);
}

/** Quarterly plan based on annual plan / 4 (for РФ) or annual / 2 (for Заруб — half-year) */
export function quarterlyPlan(dealer: DealerData, q: Quarter): number {
  const annual = dealer.plan.equipment + dealer.plan.materials + dealer.plan.service;
  if (dealer.type === "Заруб") {
    // Зарубежные dealers report half-year totals (/пг) — Q1+Q2 = H1, Q3+Q4 = H2
    // For display purposes, we show /пг total per quarter as half-year
    // BUSINESS RULE (2026-07-09): Заруб discounts only shown on Q2 and Q4 (half-year boundaries).
    // On Q1 and Q3, plan/fact/discount are all "—" (half-year not yet complete).
    return Math.round(annual / 2);
  }
  return Math.round(annual / 4);
}

/**
 * Half-year accumulated facts by category — used for Заруб dealers.
 *
 * BUSINESS RULE (2026-07-09): "Заруб. дилеры получают скидку по итогам полугодия".
 *   - H1 = Q1 + Q2 (months 0..5: Апр..Сен)
 *   - H2 = Q3 + Q4 (months 6..11: Окт..Мар)
 *
 * Returns the ACCUMULATED facts within the current half-year up to (and including)
 * the given quarter — for intermediate monitoring on Q1/Q3 and final values on Q2/Q4:
 *   - q === 1 → Q1 only (months 0..2) — partial H1 (intermediate preview)
 *   - q === 2 → Q1+Q2 (months 0..5) — complete H1 (final)
 *   - q === 3 → Q3 only (months 6..8) — partial H2 (intermediate preview)
 *   - q === 4 → Q3+Q4 (months 6..11) — complete H2 (final)
 *
 * For РФ dealers, this function is NOT used — they use `quarterlyFactsByCategory` per quarter.
 */
export function halfYearFactsByCategory(
  dealer: DealerData,
  q: Quarter,
): { service: number | null; equipment: number | null; materials: number | null } {
  // Accumulate facts within the current half-year up to (and including) quarter q.
  const months = q === 1 ? [0, 1, 2]
    : q === 2 ? [0, 1, 2, 3, 4, 5]
    : q === 3 ? [6, 7, 8]
    : [6, 7, 8, 9, 10, 11];
  const pick = (arr: (number | null)[]) => {
    const slice = months.map((i) => arr[i]);
    if (!hasFacts(slice)) return null;
    return slice.reduce<number>((a, b) => a + (b ?? 0), 0);
  };
  return {
    service: pick(dealer.facts.service.months),
    equipment: pick(dealer.facts.equipment.months),
    materials: pick(dealer.facts.materials.months),
  };
}

/**
 * Resolve the "effective facts" for a dealer at a given quarter.
 *
 * - РФ dealers: returns `quarterlyFactsByCategory(dealer, q)` — per-quarter facts.
 * - Заруб dealers: returns accumulated half-year facts up to q
 *     (Q1 alone on Q1, Q1+Q2 on Q2, Q3 alone on Q3, Q3+Q4 on Q4).
 *
 * Use this in any UI/calc code that needs the "facts applicable at this quarter for this dealer".
 */
export function effectiveFactsByCategory(
  dealer: DealerData,
  q: Quarter,
): { service: number | null; equipment: number | null; materials: number | null } {
  if (dealer.type === "Заруб") {
    return halfYearFactsByCategory(dealer, q);
  }
  return quarterlyFactsByCategory(dealer, q);
}

/**
 * Resolve the "effective plan" for a dealer at a given quarter.
 *
 * - РФ dealers: returns annual/4 (per-quarter plan).
 * - Заруб dealers: returns annual/2 (half-year plan) — always, since the half-year
 *   is the comparison unit (intermediate monitoring on Q1/Q3, final on Q2/Q4).
 */
export function effectivePlanTotal(dealer: DealerData, q: Quarter): number | null {
  if (dealer.type === "Заруб") {
    const annual = dealer.plan.equipment + dealer.plan.materials + dealer.plan.service;
    return Math.round(annual / 2);
  }
  return Math.round((dealer.plan.equipment + dealer.plan.materials + dealer.plan.service) / 4);
}

/** Quarterly fact split by category, returns [service, equipment, materials] */
export function quarterlyFactsByCategory(
  dealer: DealerData,
  q: Quarter,
): { service: number | null; equipment: number | null; materials: number | null } {
  const months = q === 1 ? [0, 1, 2] : q === 2 ? [3, 4, 5] : q === 3 ? [6, 7, 8] : [9, 10, 11];
  const pick = (arr: (number | null)[]) => {
    const slice = months.map((i) => arr[i]);
    if (!hasFacts(slice)) return null;
    return slice.reduce<number>((a, b) => a + (b ?? 0), 0);
  };
  return {
    service: pick(dealer.facts.service.months),
    equipment: pick(dealer.facts.equipment.months),
    materials: pick(dealer.facts.materials.months),
  };
}

/** Service plan — same as plan.service (annual). Service % is custom per dealer or default 14% */
export function servicePlan(dealer: DealerData): number {
  return dealer.plan.service;
}

/** Accumulated service fact (YTD) — sum of all months with data */
export function serviceFactAccumulated(dealer: DealerData): number | null {
  return sumYear(dealer.facts.service.months);
}

/** Format: 1234567 -> "1 234 567". Decimals preserved with comma (ru-RU convention). */
export function fmt(n: number | null | undefined, suffix = ""): string {
  if (n === null || n === undefined) return "—";
  // Use non-breaking space as thousands separator, comma as decimal separator (ru-RU convention)
  // Round to integer if the value is "effectively integer" (no real fractional part needed for currency display)
  const rounded = Math.round(n);
  // If the original value differs from rounded by less than 1, show integer (cleaner display for EUR plans)
  if (Math.abs(n - rounded) < 0.01) {
    return rounded.toLocaleString("ru-RU").replace(/\u00A0/g, " ") + suffix;
  }
  // Otherwise show 2 decimal places
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u00A0/g, " ") + suffix;
}

/** Format percent: 14 -> "14.0%" */
export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(digits)}%`;
}

/** Execution: fact / plan as percent, 0..100 */
export function execution(fact: number | null, plan: number): string {
  if (fact === null) return "—";
  if (plan === 0) return "—";
  return `${Math.round((fact / plan) * 100)}%`;
}

// MONTH_LABELS is already exported above as `const … = […]`.
