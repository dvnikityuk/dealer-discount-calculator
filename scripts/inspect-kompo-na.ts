import { parsePlansXlsx } from "../src/lib/parse-plans.ts";

const dealers = await parsePlansXlsx("data/uploads/plans.xlsx");
const d = dealers.find(x => x.displayName.toLowerCase().includes("north america"));
if (!d) { console.log("Not found"); process.exit(1); }
console.log("Name:", d.displayName);
console.log("Type:", d.type);
console.log("Plan:", JSON.stringify(d.plan));
console.log("Scales count:", d.scales.length);
for (const s of d.scales) {
  console.log("\n===", s.title, "===");
  console.log("Columns:", JSON.stringify(s.columns));
  for (const r of s.rows) {
    console.log("  ", r.component, "→", JSON.stringify(r.values));
  }
}
