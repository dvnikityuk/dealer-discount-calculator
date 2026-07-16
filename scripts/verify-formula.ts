import { readState } from "../src/lib/data-store";
import { findScaleTable, parseTier, parsePct } from "../src/lib/discount";
import { quarterlyFactsByCategory } from "../src/lib/calc";

async function main() {
  const state = await readState();
  
  // Reference values (from reference-design.html)
  const reference: Record<string, {svcPct: number, svcDiscount: number}> = {
    "КОМПО Технолоджис": { svcPct: 19, svcDiscount: 19292 },
    "НоваПак": { svcPct: 17, svcDiscount: 9475 },
    "КСП (КОМПО-СП)": { svcPct: 15, svcDiscount: 6314 },
    "Богатовъ Торговый Дом, Челябинск": { svcPct: 15, svcDiscount: 4794 },
    "ASIAN BUSINESS SOLUTIONS, Узбекистан": { svcPct: 10, svcDiscount: 142 },
    "Deling food": { svcPct: 15, svcDiscount: 5605 },
    "VitLine, Казахстан": { svcPct: 13, svcDiscount: 2963 },
    "UNIVERSAL MEAT": { svcPct: 15, svcDiscount: 5739 },
    "LUCKY & S CO, Сербия": { svcPct: 11, svcDiscount: 806 },
    "Сейитлиев Мердан Иламанович, Туркменистан": { svcPct: 10, svcDiscount: 452 },
    "Ingreda, Молдова": { svcPct: 10, svcDiscount: 58 },
    "Кабири Хучанд ООО, Таджикистан": { svcPct: 10, svcDiscount: 52 },
    "Flexo Food , Грузия": { svcPct: 10, svcDiscount: 134 },
  };
  
  console.log("Dealer | Q1 total | /2500 | Col | Calc % | Ref % | Match?");
  console.log("-------|----------|-------|-----|--------|-------|-------");
  
  let allMatch = true;
  
  for (const d of state.dealers) {
    const ref = reference[d.name];
    if (!ref) continue;
    
    const facts = quarterlyFactsByCategory(d, 1);
    const q1Total = (facts.service ?? 0) + (facts.equipment ?? 0) + (facts.materials ?? 0);
    const hasData = facts.service !== null || facts.equipment !== null || facts.materials !== null;
    
    let calcPct: number | null = null;
    if (hasData) {
      if (d.type === "РФ") {
        // Use equipment scale with volume = Q1 total / 2500
        const eqTable = findScaleTable(d.scales, "Оборудование");
        if (eqTable) {
          const volume = q1Total / 2500;
          // Find column
          for (let i = 0; i < eqTable.columns.length; i++) {
            const t = parseTier(eqTable.columns[i]);
            const min = t.min ?? -Infinity;
            const max = t.max ?? Infinity;
            if (volume >= min && volume <= max) {
              const totalRow = eqTable.rows.find(r => r.component.includes("ИТОГО"));
              if (totalRow) {
                calcPct = parsePct(totalRow.values[i]);
              }
              break;
            }
          }
        }
      } else {
        // Заруб: use service scale with volume = accumulated service fact (absolute EUR)
        const svcTable = findScaleTable(d.scales, "Сервис");
        if (svcTable) {
          const svcFact = facts.service ?? 0;
          // Plus accumulated months
          const allSvcMonths = d.facts.service.months;
          const accumulated = allSvcMonths.filter((v): v is number => v !== null).reduce((a, b) => a + b, 0);
          for (let i = 0; i < svcTable.columns.length; i++) {
            const t = parseTier(svcTable.columns[i]);
            const min = t.min ?? -Infinity;
            const max = t.max ?? Infinity;
            if (accumulated >= min && accumulated <= max) {
              calcPct = parsePct(svcTable.rows[0].values[i]);
              if (calcPct !== null && calcPct < 1) calcPct = calcPct * 100;
              break;
            }
          }
        }
      }
    }
    
    const match = calcPct === ref.svcPct;
    if (!match) allMatch = false;
    console.log(`${d.name.substring(0, 40).padEnd(40)} | ${q1Total.toString().padStart(8)} | ${(q1Total/2500).toFixed(2).padStart(6)} | ${calcPct?.toString().padStart(3) ?? "—"} | ${ref.svcPct.toString().padStart(3)} | ${match ? "✓" : "✗"}`);
  }
  
  console.log(`\nAll match: ${allMatch ? "YES ✓" : "NO ✗"}`);
}

main().catch(console.error);
