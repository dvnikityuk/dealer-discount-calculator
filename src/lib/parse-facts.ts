import { promises as fs } from "fs";
import type { DealerData, DealerType } from "./types";

/** CSV row: Тип ТМЦ, Дилеры (вып.условий), MonthStart, Выручка */
interface RawFactRow {
  category: string;
  dealer: string;
  monthStart: string; // "2026-04-01 00:00:00"
  revenue: number;
}

/** Financial year starts in April. Map month number → FY month index 0..11 (Apr=0..Mar=11).
 *  Input `month` is the human-readable month from the CSV (1=Jan, 4=Apr, 12=Dec).
 */
function monthToIndex(month: number): number {
  // CSV "2026-04-01" → month=4 (April) → FY month 0 (start of financial year)
  // CSV "2026-07-01" → month=7 (July)  → FY month 3
  // CSV "2027-03-01" → month=3 (March) → FY month 11 (end of financial year)
  return (month - 4 + 12) % 12;
}

/** Strip BOM and parse CSV manually (handles quoted fields with commas). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Parse CSV file → map: dealerName → { service: [12], equipment: [12], materials: [12] } */
export async function parseFactsCsv(path: string): Promise<
  Map<string, { service: (number | null)[]; equipment: (number | null)[]; materials: (number | null)[] }>
> {
  const raw = await fs.readFile(path, "utf-8");
  const text = raw.replace(/^\uFEFF/, ""); // strip BOM
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  const result = new Map<string, {
    service: (number | null)[];
    equipment: (number | null)[];
    materials: (number | null)[];
  }>();

  if (lines.length < 2) return result;

  // Skip header (line[0])
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 4) continue;
    const [category, dealer, monthStart, revenueStr] = cols;
    const revenue = Number(revenueStr);
    if (!Number.isFinite(revenue)) continue;

    // Map category → key
    let key: "service" | "equipment" | "materials";
    if (category.toLowerCase().includes("сервис")) key = "service";
    else if (category.toLowerCase().includes("оборуд")) key = "equipment";
    else if (category.toLowerCase().includes("расход")) key = "materials";
    else continue;

    // Parse monthStart → FY month index
    // Format: "2026-04-01 00:00:00" or ISO
    const monthMatch = monthStart.match(/^(\d{4})-(\d{2})-/);
    if (!monthMatch) continue;
    const month = Number(monthMatch[2]);
    const monthIdx = monthToIndex(month);

    let entry = result.get(dealer);
    if (!entry) {
      entry = {
        service: Array(12).fill(null),
        equipment: Array(12).fill(null),
        materials: Array(12).fill(null),
      };
      result.set(dealer, entry);
    }
    entry[key][monthIdx] = (entry[key][monthIdx] ?? 0) + revenue;
  }

  return result;
}
