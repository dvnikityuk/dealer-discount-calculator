import { parsePlansXlsx } from "../src/lib/parse-plans.ts";

const dealers = await parsePlansXlsx("data/uploads/plans.xlsx");
console.log("AUDIT: minimum equipment discount per dealer (first tier ИТОГО)");
console.log("=".repeat(80));
for (const d of dealers) {
  const eq = d.scales.find(s => s.title.includes("Оборудование"));
  if (!eq) continue;
  const totalRow = eq.rows.find(r => r.component.toLowerCase().includes("итого"));
  if (!totalRow) continue;
  // Get first column value
  const firstVal = totalRow.values[0];
  console.log(d.displayName.substring(0,40).padEnd(42), "→ first tier ИТОГО:", firstVal);
}
