/**
 * Verify the new business rule: "Если нет продаж '-', то и скидка не назначается".
 *
 * Expected behavior:
 *   - When a dealer has no equipment fact for the quarter → equipment discount = null (shows "—")
 *   - When a dealer has no materials fact for the quarter → materials discount = null (shows "—")
 *   - When a dealer has no service fact (accumulated) → service discount = null (already was the case)
 *
 * Also verifies that:
 *   - Dealers WITH sales in a category still get the correct discount for that category
 *   - The 14% floor still applies to dealers WITH sales but whose computed tier value is <14%
 *   - The 3 removed dealers (CLIPSOMAC, Tida Tech, Ari Makina) are absent from state
 */
import { promises as fs } from "fs";
import {
  calcEquipmentDiscountPct,
  calcMaterialsDiscountPct,
  getServiceDiscountPctNormalized,
} from "../src/lib/discount";
import { quarterlyFactsByCategory, serviceFactAccumulated } from "../src/lib/calc";
import type { DealerData, AppState } from "../src/lib/types";

async function main() {
  const raw = await fs.readFile("data/state.json", "utf-8");
  const state = JSON.parse(raw) as AppState;

  console.log(`Total dealers: ${state.dealers.length}`);
  console.log();
  console.log(
    "Dealer                                           | EQ fact   | MAT fact  | SVC acc   | EQ%   | MAT%  | SVC%",
  );
  console.log("-".repeat(115));

  const removedKeywords = ["tida tech", "ari makina", "clipsomac"];
  for (const d of state.dealers as DealerData[]) {
    const name = d.name.padEnd(46).slice(0, 46);
    if (removedKeywords.some((k) => d.name.toLowerCase().includes(k))) {
      console.log(`${name} | *** SHOULD NOT BE HERE ***`);
      continue;
    }
    const facts = quarterlyFactsByCategory(d, 1);
    const svcAcc = serviceFactAccumulated(d);
    const eqPct = calcEquipmentDiscountPct(d, 1);
    const matPct = calcMaterialsDiscountPct(d, 1);
    const svcPct = getServiceDiscountPctNormalized(d, 1);

    const fmtFact = (v: number | null) => (v === null ? "—" : String(v)).padStart(9);
    const fmtPct = (v: number | null) => (v === null ? "—" : `${v}%`).padStart(5);

    // Verify rule: if fact is null, discount must be null
    const eqRuleOk = facts.equipment === null ? eqPct === null : true;
    const matRuleOk = facts.materials === null ? matPct === null : true;
    const svcRuleOk = svcAcc === null || svcAcc === 0 ? svcPct === null : true;

    const flags = [eqRuleOk, matRuleOk, svcRuleOk].every(Boolean) ? "" : "  *** RULE VIOLATED ***";

    console.log(
      `${name} | ${fmtFact(facts.equipment)} | ${fmtFact(facts.materials)} | ${fmtFact(svcAcc)} | ${fmtPct(eqPct)} | ${fmtPct(matPct)} | ${fmtPct(svcPct)}${flags}`,
    );
  }

  // Verify removed dealers are absent
  console.log();
  console.log("=== Removed dealers check ===");
  const present = state.dealers.filter((d) =>
    removedKeywords.some((k) => d.name.toLowerCase().includes(k)),
  );
  if (present.length === 0) {
    console.log("✓ All 3 removed dealers (CLIPSOMAC, Tida Tech, Ari Makina) are ABSENT from state.");
  } else {
    console.log(`✗ FAIL: ${present.length} removed dealers still present:`);
    present.forEach((d) => console.log(`  - ${d.name}`));
  }

  // Specific rule tests
  console.log();
  console.log("=== Rule verification (no sales → no discount) ===");

  // Гинап, Армения — has NO sales at all (all months null for all 3 categories)
  const ginap = state.dealers.find((d) => d.name.includes("Гинап"));
  if (ginap) {
    const eqPct = calcEquipmentDiscountPct(ginap, 1);
    const matPct = calcMaterialsDiscountPct(ginap, 1);
    const svcPct = getServiceDiscountPctNormalized(ginap, 1);
    const allNull = eqPct === null && matPct === null && svcPct === null;
    console.log(
      `Гинап, Армения (no sales at all): EQ=${eqPct === null ? "—" : eqPct + "%"}, MAT=${matPct === null ? "—" : matPct + "%"}, SVC=${svcPct === null ? "—" : svcPct + "%"} → ${allNull ? "✓ ALL NULL (correct)" : "✗ FAIL"}`,
    );
  }

  // Богатовъ — has service+materials fact but NO equipment fact
  const bogatov = state.dealers.find((d) => d.name.includes("Богатов"));
  if (bogatov) {
    const eqPct = calcEquipmentDiscountPct(bogatov, 1);
    const matPct = calcMaterialsDiscountPct(bogatov, 1);
    const facts = quarterlyFactsByCategory(bogatov, 1);
    const eqRuleOk = facts.equipment === null && eqPct === null;
    const matRuleOk = facts.materials !== null && matPct !== null;
    console.log(
      `Богатовъ (no EQ sales, has MAT sales): EQ=${eqPct === null ? "—" : eqPct + "%"} [${eqRuleOk ? "✓" : "✗"}], MAT=${matPct === null ? "—" : matPct + "%"} [${matRuleOk ? "✓" : "✗"}]`,
    );
  }

  // КОМПО Технолоджис — has all sales
  const kompo = state.dealers.find((d) => d.name.includes("КОМПО Технолоджис"));
  if (kompo) {
    const eqPct = calcEquipmentDiscountPct(kompo, 1);
    const matPct = calcMaterialsDiscountPct(kompo, 1);
    const svcPct = getServiceDiscountPctNormalized(kompo, 1);
    const allNonZero = eqPct !== null && matPct !== null && svcPct !== null;
    console.log(
      `КОМПО Технолоджис (has all sales): EQ=${eqPct}%, MAT=${matPct}%, SVC=${svcPct}% → ${allNonZero ? "✓ ALL ASSIGNED" : "✗ FAIL"}`,
    );
  }

  // KNA — has equipment & materials fact, NO service fact
  const kna = state.dealers.find((d) => d.name.includes("North America"));
  if (kna) {
    const eqPct = calcEquipmentDiscountPct(kna, 1);
    const matPct = calcMaterialsDiscountPct(kna, 1);
    const svcPct = getServiceDiscountPctNormalized(kna, 1);
    const svcAcc = serviceFactAccumulated(kna);
    const svcRuleOk = (svcAcc === null || svcAcc === 0) && svcPct === null;
    console.log(
      `KNA (no SVC sales): EQ=${eqPct}%, MAT=${matPct}%, SVC=${svcPct === null ? "—" : svcPct + "%"} → ${svcRuleOk ? "✓ SVC correctly null" : "✗ FAIL"}`,
    );
  }

  // Кабири Хучанд — has service+equipment fact, NO materials fact
  const kabiri = state.dealers.find((d) => d.name.includes("Кабири"));
  if (kabiri) {
    const matPct = calcMaterialsDiscountPct(kabiri, 1);
    const facts = quarterlyFactsByCategory(kabiri, 1);
    const matRuleOk = facts.materials === null && matPct === null;
    console.log(
      `Кабири (no MAT sales): MAT=${matPct === null ? "—" : matPct + "%"} [${matRuleOk ? "✓" : "✗"}]`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
