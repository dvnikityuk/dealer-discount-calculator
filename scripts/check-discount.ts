import { readState } from "../src/lib/data-store";
import { calcServiceDiscountPct, calcEquipmentDiscountPct, calcMaterialsDiscountPct, findScaleTable } from "../src/lib/discount";
import { serviceFactAccumulated, quarterlyFactsByCategory } from "../src/lib/calc";

async function main() {
  const state = await readState();
  console.log("Dealers:", state.dealers.length);
  
  for (const d of state.dealers.slice(0, 6)) {
    console.log(`\n=== ${d.name} (${d.type}) ===`);
    console.log(`Scales count: ${d.scales?.length ?? 0}`);
    if (d.scales) {
      for (const s of d.scales) {
        console.log(`  Scale: ${s.title}`);
        console.log(`    Columns: ${JSON.stringify(s.columns)}`);
        console.log(`    Rows: ${s.rows.length}`);
        for (const r of s.rows) {
          console.log(`      ${r.component}: ${JSON.stringify(r.values)}`);
        }
      }
    }
    
    const sf = serviceFactAccumulated(d);
    console.log(`Service fact (12mo sum): ${sf}`);
    const pct = calcServiceDiscountPct(d);
    console.log(`Service pct (raw): ${pct}`);
    
    const eqPct = calcEquipmentDiscountPct(d, 1);
    const matPct = calcMaterialsDiscountPct(d, 1);
    console.log(`Equipment % (Q1): ${eqPct}`);
    console.log(`Materials % (Q1): ${matPct}`);
    
    const facts = quarterlyFactsByCategory(d, 1);
    console.log(`Q1 facts: svc=${facts.service}, eq=${facts.equipment}, mat=${facts.materials}`);
  }
}

main().catch(console.error);
