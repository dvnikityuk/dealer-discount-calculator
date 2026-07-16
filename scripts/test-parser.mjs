import { parsePlansXlsx } from "../src/lib/parse-plans.ts";

const dealers = await parsePlansXlsx("./upload/Условия работы ТПС  2026 с корректировками_отправка.xlsx");
console.log("Total dealers parsed:", dealers.length);
console.log();
console.log("All Богатов entries:");
for (const d of dealers) {
  if (d.displayName.toLowerCase().includes("богатов") || d.sheetName.toLowerCase().includes("богатов")) {
    console.log("  sheetName=" + JSON.stringify(d.sheetName) + " displayName=" + JSON.stringify(d.displayName));
    console.log("  type=" + d.type + " plan: svc=" + d.plan.service + " eq=" + d.plan.equipment + " mat=" + d.plan.materials);
    console.log("  scales count: " + (d.scales?.length ?? 0));
  }
}
console.log();
console.log("All dealers:");
for (const d of dealers) {
  console.log("  sheet=" + d.sheetName.padEnd(25) + " name=" + d.displayName);
}
