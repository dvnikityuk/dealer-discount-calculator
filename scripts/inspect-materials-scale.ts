/**
 * Inspect "Расходные материалы" scale structure for all dealers.
 */
import { readState } from "../src/lib/data-store";

async function main() {
  const state = await readState();
  console.log(`Total dealers: ${state.dealers.length}\n`);

  for (const d of state.dealers.slice(0, 5)) {
    const matTable = d.scales?.find((s) => s.title.toLowerCase().includes("расходн"));
    console.log(`=== ${d.name} (${d.type}) ===`);
    if (!matTable) {
      console.log("  no 'Расходные' scale\n");
      continue;
    }
    console.log(`  title: ${matTable.title}`);
    console.log(`  columns: [${matTable.columns.map((c) => `"${c}"`).join(", ")}]`);
    console.log(`  rows (${matTable.rows.length}):`);
    for (const r of matTable.rows) {
      console.log(`    - "${r.component}"  values=[${r.values.map((v) => `"${v}"`).join(", ")}]`);
    }
    console.log();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
