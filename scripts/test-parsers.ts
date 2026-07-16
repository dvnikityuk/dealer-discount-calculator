// Quick test script — run with: bun run /home/z/my-project/scripts/test-parsers.ts
import { parseFactsCsv } from "../src/lib/parse-facts";
import { parsePlansXlsx } from "../src/lib/parse-plans";

async function main() {
  console.log("=== Parsing CSV (facts) ===");
  const facts = await parseFactsCsv("/home/z/my-project/data/uploads/facts.csv");
  console.log(`Dealers in CSV: ${facts.size}`);
  for (const [name, data] of facts) {
    const svc = data.service.filter((v) => v !== null).reduce((a, b) => a! + b!, 0);
    const eq = data.equipment.filter((v) => v !== null).reduce((a, b) => a! + b!, 0);
    const mat = data.materials.filter((v) => v !== null).reduce((a, b) => a! + b!, 0);
    console.log(`  ${name}: svc=${svc}, eq=${eq}, mat=${mat}`);
  }

  console.log("\n=== Parsing XLSX (plans) ===");
  const dealers = await parsePlansXlsx("/home/z/my-project/data/uploads/plans.xlsx");
  console.log(`Dealers in XLSX: ${dealers.length}`);
  for (const d of dealers) {
    console.log(`  [${d.sheetName}] ${d.displayName} (${d.type})`);
    console.log(`     plan: svc=${d.plan.service}, eq=${d.plan.equipment}, mat=${d.plan.materials}`);
    console.log(`     scales: ${d.scales.length} tables`);
    for (const s of d.scales) {
      console.log(`       - ${s.title} (${s.rows.length} rows, cols: ${s.columns.join(", ")})`);
    }
  }

  console.log("\n=== Joining facts × plans ===");
  for (const d of dealers) {
    // Try matching by exact name, or by sheet name
    let factEntry = facts.get(d.csvName);
    if (!factEntry) {
      // Try matching by CSV name with country suffix (e.g., "VitLine, Казахстан")
      const keys = Array.from(facts.keys());
      const match = keys.find((k) => k.toLowerCase().includes(d.sheetName.toLowerCase().split(",")[0].split(" ")[0]));
      if (match) factEntry = facts.get(match);
    }
    if (factEntry) {
      const svcTotal = factEntry.service.filter((v) => v !== null).reduce((a, b) => a! + b!, 0);
      console.log(`  ✓ ${d.displayName}: facts matched (svc=${svcTotal})`);
    } else {
      console.log(`  ✗ ${d.displayName}: NO facts in CSV`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
