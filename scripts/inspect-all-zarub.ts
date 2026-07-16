import { parsePlansXlsx } from "../src/lib/parse-plans.ts";

const dealers = await parsePlansXlsx("data/uploads/plans.xlsx");
const zarub = dealers.filter(d => d.type === "Заруб");
for (const d of zarub) {
  console.log("\n=========================================");
  console.log("DEALER:", d.displayName);
  console.log("TYPE:", d.type);
  const eq = d.scales.find(s => s.title.includes("Оборудование"));
  if (eq) {
    console.log("Equipment scale:", eq.title);
    console.log("  Columns:", JSON.stringify(eq.columns));
    for (const r of eq.rows) {
      console.log("   ", r.component, "→", JSON.stringify(r.values));
    }
  }
}
