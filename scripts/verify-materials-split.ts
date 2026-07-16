/**
 * Verify the new materials discount split logic.
 * РФ dealers should have both volume and minStock components.
 * Заруб dealers should have only volume (minStock = null).
 */
import { readState } from "../src/lib/data-store";
import { calcMaterialsDiscountPct, calcMaterialsDiscountPctSplit } from "../src/lib/discount";

async function main() {
  const state = await readState();
  console.log(`Dealers: ${state.dealers.length}\n`);

  // Test on Q2 (H1 final) — both РФ and Заруб should have discounts.
  const quarter = 2 as const;
  console.log(`=== Q${quarter} ===`);
  console.log("Dealer".padEnd(45), "Type".padEnd(7), "Total".padStart(7), "Volume".padStart(7), "MinStock".padStart(9));

  for (const d of state.dealers) {
    const total = calcMaterialsDiscountPct(d, quarter);
    const split = calcMaterialsDiscountPctSplit(d, quarter);
    console.log(
      d.name.slice(0, 45).padEnd(45),
      d.type.padEnd(7),
      (total === null ? "—" : total + "%").padStart(7),
      (split.volume === null ? "—" : split.volume + "%").padStart(7),
      (split.minStock === null ? "—" : split.minStock + "%").padStart(9),
    );
  }

  // Sanity checks
  console.log("\n=== Sanity checks ===");
  const rfDealer = state.dealers.find((d) => d.type === "РФ");
  const zarubDealer = state.dealers.find((d) => d.type === "Заруб");
  if (rfDealer) {
    const split = calcMaterialsDiscountPctSplit(rfDealer, quarter);
    console.log(`РФ "${rfDealer.name}": volume=${split.volume}%, minStock=${split.minStock}%`);
    console.log(`  → Expected: minStock = 1% (always 1% in scale), volume = 0–5% based on tier`);
  }
  if (zarubDealer) {
    const split = calcMaterialsDiscountPctSplit(zarubDealer, quarter);
    console.log(`Заруб "${zarubDealer.name}": volume=${split.volume}%, minStock=${split.minStock}%`);
    console.log(`  → Expected: minStock = null (no "мин. остатки" row in scale), volume = 0–5% based on tier`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
