import { readState } from "../src/lib/data-store.ts";
import { calcEquipmentDiscountPct, calcMaterialsDiscountPct, getServiceDiscountPctNormalized } from "../src/lib/discount.ts";
import { quarterlyFactsByCategory, serviceFactAccumulated } from "../src/lib/calc.ts";

const state = await readState();
const q = state.quarter;
console.log("Quarter:", q);
console.log();
console.log("AUDIT: per-dealer discount calculation");
console.log("=" .repeat(120));
console.log("DEALER".padEnd(40) + "TYPE".padEnd(6) + "EQ_FACT_Q".padEnd(12) + "MAT_FACT_Q".padEnd(12) + "SVC_FACT_Q".padEnd(12) + "EQ%".padEnd(8) + "MAT%".padEnd(8) + "SVC%".padEnd(8));
console.log("-".repeat(120));

for (const d of state.dealers) {
  const f = quarterlyFactsByCategory(d, q);
  const eqPct = calcEquipmentDiscountPct(d, q);
  const matPct = calcMaterialsDiscountPct(d, q);
  const svcPct = getServiceDiscountPctNormalized(d, q);
  console.log(
    d.name.substring(0, 38).padEnd(40) +
    d.type.padEnd(6) +
    String(f.equipment ?? "null").padEnd(12) +
    String(f.materials ?? "null").padEnd(12) +
    String(f.service ?? "null").padEnd(12) +
    String(eqPct ?? "—").padEnd(8) +
    String(matPct ?? "—").padEnd(8) +
    String(svcPct ?? "—").padEnd(8)
  );
}
