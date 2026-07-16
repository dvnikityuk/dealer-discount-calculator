import { readState } from "../src/lib/data-store";
import { calcEquipmentDiscountPct, calcMaterialsDiscountPct, findScaleTable, parseTier } from "../src/lib/discount";
import { quarterlyFactsByCategory, sumYear } from "../src/lib/calc";

async function main() {
  const state = await readState();
  
  // For each РФ dealer, try various volume calculations to match reference 17/15/15/19
  console.log("=== РФ dealers: trying various volume formulas ===\n");
  
  for (const d of state.dealers.filter(x => x.type === "РФ").slice(0, 4)) {
    console.log(`\n--- ${d.name} ---`);
    const facts = quarterlyFactsByCategory(d, 1);
    const annualSvc = sumYear(d.facts.service.months);
    const annualEq = sumYear(d.facts.equipment.months);
    const annualMat = sumYear(d.facts.materials.months);
    
    console.log(`Q1 facts: svc=${facts.service}, eq=${facts.equipment}, mat=${facts.materials}`);
    console.log(`Annual facts: svc=${annualSvc}, eq=${annualEq}, mat=${annualMat}`);
    
    const table = findScaleTable(d.scales, "Оборудование");
    if (table) {
      console.log(`Equipment scale columns: ${JSON.stringify(table.columns)}`);
      console.log(`Equipment scale ИТОГО: ${JSON.stringify(table.rows.find(r => r.component.includes("ИТОГО"))?.values)}`);
      
      // Try different volume formulas
      const formulas = [
        { name: "Q1 equipment", vol: facts.equipment ?? 0 },
        { name: "Q1 equipment / 1000", vol: (facts.equipment ?? 0) / 1000 },
        { name: "Q1 materials", vol: facts.materials ?? 0 },
        { name: "Q1 materials / 1000", vol: (facts.materials ?? 0) / 1000 },
        { name: "Q1 service", vol: facts.service ?? 0 },
        { name: "Q1 service / 1000", vol: (facts.service ?? 0) / 1000 },
        { name: "Q1 total (svc+eq+mat)", vol: (facts.service ?? 0) + (facts.equipment ?? 0) + (facts.materials ?? 0) },
        { name: "Q1 total / 1000", vol: ((facts.service ?? 0) + (facts.equipment ?? 0) + (facts.materials ?? 0)) / 1000 },
        { name: "Q1 total / 2500", vol: ((facts.service ?? 0) + (facts.equipment ?? 0) + (facts.materials ?? 0)) / 2500 },
        { name: "Q1 total / 2.5 / 1000", vol: ((facts.service ?? 0) + (facts.equipment ?? 0) + (facts.materials ?? 0)) / 2.5 / 1000 },
        { name: "Q1 (eq+mat)", vol: (facts.equipment ?? 0) + (facts.materials ?? 0) },
        { name: "Q1 (eq+mat) / 1000", vol: ((facts.equipment ?? 0) + (facts.materials ?? 0)) / 1000 },
        { name: "Annual service", vol: annualSvc ?? 0 },
        { name: "Annual service / 1000", vol: (annualSvc ?? 0) / 1000 },
        { name: "Annual total / 1000", vol: ((annualSvc ?? 0) + (annualEq ?? 0) + (annualMat ?? 0)) / 1000 },
      ];
      
      for (const f of formulas) {
        // Find matching column index
        let colIdx = -1;
        for (let i = 0; i < table.columns.length; i++) {
          const t = parseTier(table.columns[i]);
          const min = t.min ?? -Infinity;
          const max = t.max ?? Infinity;
          if (f.vol >= min && f.vol <= max) { colIdx = i; break; }
        }
        if (colIdx >= 0) {
          const totalRow = table.rows.find(r => r.component.includes("ИТОГО"));
          if (totalRow) {
            const val = totalRow.values[colIdx];
            console.log(`  ${f.name} = ${f.vol.toFixed(2)} → col ${colIdx} (${table.columns[colIdx]}) → ${val}`);
          }
        }
      }
    }
  }
}

main().catch(console.error);
