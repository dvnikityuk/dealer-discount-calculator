import { parsePlansXlsx } from "../src/lib/parse-plans.ts";
const dealers = await parsePlansXlsx("data/uploads/plans.xlsx");
console.log("Total dealers:", dealers.length);
for (const d of dealers) {
  if (d.displayName.toLowerCase().includes("богатов")) {
    console.log("\nНайден:", d.displayName);
    console.log("Sheet:", d.sheetName);
    console.log("Тип:", d.type);
    console.log("План:", JSON.stringify(d.plan));
    console.log("Итого:", d.plan.service + d.plan.equipment + d.plan.materials);
  }
}
