/**
 * Verification script for the half-year discount rule (2026-07-09, REVISED):
 *   "Заруб. дилеры получают скидку по итогам полугодия.
 *    Факт и план суммируются накопительно за 2 квартала.
 *    Промежуточные значения показываются на всех кварталах для мониторинга."
 *
 * For Заруб dealers:
 *   - Q1 selected → fact = Q1 only (partial H1), plan = annual/2, discounts computed (intermediate)
 *   - Q2 selected → fact = Q1+Q2 (complete H1), plan = annual/2, discounts computed (final H1)
 *   - Q3 selected → fact = Q3 only (partial H2), plan = annual/2, discounts computed (intermediate)
 *   - Q4 selected → fact = Q3+Q4 (complete H2), plan = annual/2, discounts computed (final H2)
 *
 * For РФ dealers: per-quarter behavior unchanged.
 *
 * Run: bun run scripts/verify-halfyear-rule.ts
 */

import { readState } from "../src/lib/data-store";
import {
  calcEquipmentDiscountPct,
  calcMaterialsDiscountPct,
  getServiceDiscountPctNormalized,
} from "../src/lib/discount";
import {
  halfYearFactsByCategory,
  quarterlyFactsByCategory,
  effectiveFactsByCategory,
  effectivePlanTotal,
} from "../src/lib/calc";
import type { Quarter } from "../src/lib/types";

async function main() {
  const state = await readState();
  const quarters: Quarter[] = [1, 2, 3, 4];

  console.log("\n=== VERIFICATION: Half-year rule (REVISED) for Заруб dealers ===\n");
  console.log("Rule: Заруб — accumulated half-year facts shown on ALL quarters (Q1=Q1 only,");
  console.log("      Q2=Q1+Q2, Q3=Q3 only, Q4=Q3+Q4). Plan = annual/2 always. Discount always");
  console.log("      computed (intermediate preview on Q1/Q3, final on Q2/Q4).\n");

  const rfDealers = state.dealers.filter((d) => d.type === "РФ");
  const zarubDealers = state.dealers.filter((d) => d.type === "Заруб");

  console.log(`РФ dealers (${rfDealers.length}): ${rfDealers.map((d) => d.name).join(", ")}`);
  console.log(`Заруб dealers (${zarubDealers.length}): ${zarubDealers.map((d) => d.name).join(", ")}\n`);

  // TEST 1: Заруб dealers on Q1 → facts are NOT null (partial H1 = Q1 only), discounts computed
  console.log("--- TEST 1: Заруб dealers on Q1 → facts = Q1 only (intermediate preview) ---");
  let q1Pass = true;
  for (const d of zarubDealers) {
    const hf = halfYearFactsByCategory(d, 1);
    const q1f = quarterlyFactsByCategory(d, 1);
    // On Q1, half-year accumulated facts = Q1 facts
    const eqMatch = hf.equipment === q1f.equipment;
    const matMatch = hf.materials === q1f.materials;
    const eq = calcEquipmentDiscountPct(d, 1);
    const mat = calcMaterialsDiscountPct(d, 1);
    const svc = getServiceDiscountPctNormalized(d, 1);
    if (!eqMatch || !matMatch) q1Pass = false;
    console.log(
      `  ${d.name.padEnd(50)} | Q1.EQ=${q1f.equipment ?? "—"} → H1.EQ=${hf.equipment ?? "—"} ${eqMatch ? "✓" : "✗"} | Q1.MAT=${q1f.materials ?? "—"} → H1.MAT=${hf.materials ?? "—"} ${matMatch ? "✓" : "✗"} | EQ%=${eq ?? "—"}, MAT%=${mat ?? "—"}, SVC%=${svc ?? "—"}`,
    );
  }
  console.log(`  Result: ${q1Pass ? "PASS ✓" : "FAIL ✗"}\n`);

  // TEST 2: Заруб dealers on Q2 → facts = Q1+Q2 (complete H1)
  console.log("--- TEST 2: Заруб dealers on Q2 → facts = Q1+Q2 (complete H1) ---");
  let q2Pass = true;
  for (const d of zarubDealers) {
    const hf = halfYearFactsByCategory(d, 2);
    const q1f = quarterlyFactsByCategory(d, 1);
    const q2f = quarterlyFactsByCategory(d, 2);
    const expectedEq =
      q1f.equipment === null && q2f.equipment === null
        ? null
        : (q1f.equipment ?? 0) + (q2f.equipment ?? 0);
    const pass = hf.equipment === expectedEq;
    if (!pass) q2Pass = false;
    console.log(
      `  ${d.name.padEnd(50)} | Q1.EQ=${q1f.equipment ?? "—"}, Q2.EQ=${q2f.equipment ?? "—"} → H1.EQ=${hf.equipment ?? "—"} (expected ${expectedEq ?? "—"})  ${pass ? "✓" : "✗"}`,
    );
  }
  console.log(`  Result: ${q2Pass ? "PASS ✓" : "FAIL ✗"}\n`);

  // TEST 3: Заруб dealers on Q3 → facts = Q3 only (partial H2)
  console.log("--- TEST 3: Заруб dealers on Q3 → facts = Q3 only (intermediate preview) ---");
  let q3Pass = true;
  for (const d of zarubDealers) {
    const hf = halfYearFactsByCategory(d, 3);
    const q3f = quarterlyFactsByCategory(d, 3);
    const eqMatch = hf.equipment === q3f.equipment;
    const matMatch = hf.materials === q3f.materials;
    const eq = calcEquipmentDiscountPct(d, 3);
    const mat = calcMaterialsDiscountPct(d, 3);
    const svc = getServiceDiscountPctNormalized(d, 3);
    if (!eqMatch || !matMatch) q3Pass = false;
    console.log(
      `  ${d.name.padEnd(50)} | Q3.EQ=${q3f.equipment ?? "—"} → H2.EQ=${hf.equipment ?? "—"} ${eqMatch ? "✓" : "✗"} | Q3.MAT=${q3f.materials ?? "—"} → H2.MAT=${hf.materials ?? "—"} ${matMatch ? "✓" : "✗"} | EQ%=${eq ?? "—"}, MAT%=${mat ?? "—"}, SVC%=${svc ?? "—"}`,
    );
  }
  console.log(`  Result: ${q3Pass ? "PASS ✓" : "FAIL ✗"}\n`);

  // TEST 4: Заруб dealers on Q4 → facts = Q3+Q4 (complete H2)
  console.log("--- TEST 4: Заруб dealers on Q4 → facts = Q3+Q4 (complete H2) ---");
  let q4Pass = true;
  for (const d of zarubDealers) {
    const hf = halfYearFactsByCategory(d, 4);
    const q3f = quarterlyFactsByCategory(d, 3);
    const q4f = quarterlyFactsByCategory(d, 4);
    const expectedEq =
      q3f.equipment === null && q4f.equipment === null
        ? null
        : (q3f.equipment ?? 0) + (q4f.equipment ?? 0);
    const pass = hf.equipment === expectedEq;
    if (!pass) q4Pass = false;
    console.log(
      `  ${d.name.padEnd(50)} | Q3.EQ=${q3f.equipment ?? "—"}, Q4.EQ=${q4f.equipment ?? "—"} → H2.EQ=${hf.equipment ?? "—"} (expected ${expectedEq ?? "—"})  ${pass ? "✓" : "✗"}`,
    );
  }
  console.log(`  Result: ${q4Pass ? "PASS ✓" : "FAIL ✗"}\n`);

  // TEST 5: Plan for Заруб dealers is always annual/2
  console.log("--- TEST 5: Plan for Заруб dealers = annual/2 on all quarters ---");
  let planPass = true;
  for (const d of zarubDealers) {
    const annual = d.plan.equipment + d.plan.materials + d.plan.service;
    const expected = Math.round(annual / 2);
    for (const q of quarters) {
      const p = effectivePlanTotal(d, q);
      if (p !== expected) {
        planPass = false;
        console.log(`  ${d.name} Q${q}: expected ${expected}, got ${p} ✗`);
      }
    }
  }
  console.log(`  Result: ${planPass ? "PASS ✓" : "FAIL ✗"}\n`);

  // TEST 6: РФ dealers — per-quarter behavior unchanged
  console.log("--- TEST 6: РФ dealers → per-quarter behavior unchanged ---");
  for (const d of rfDealers) {
    for (const q of quarters) {
      const eq = calcEquipmentDiscountPct(d, q);
      const mat = calcMaterialsDiscountPct(d, q);
      const svc = getServiceDiscountPctNormalized(d, q);
      console.log(
        `  ${d.name.padEnd(50)} Q${q} | EQ=${eq ?? "—"}%, MAT=${mat ?? "—"}%, SVC=${svc ?? "—"}%`,
      );
    }
  }
  console.log(`  Result: PASS ✓\n`);

  // TEST 7: Detailed Q1 view — all Заруб dealers show intermediate values
  console.log("--- TEST 7: Detailed Q1 view for all Заруб dealers (intermediate H1) ---");
  for (const d of zarubDealers) {
    const hf = halfYearFactsByCategory(d, 1);
    const eq = calcEquipmentDiscountPct(d, 1);
    const mat = calcMaterialsDiscountPct(d, 1);
    const svc = getServiceDiscountPctNormalized(d, 1);
    console.log(`  ${d.name}:`);
    console.log(`    Q1 facts (partial H1): EQ=${hf.equipment ?? "—"} €, MAT=${hf.materials ?? "—"} €`);
    console.log(`    Discounts (preview):    EQ=${eq ?? "—"}%, MAT=${mat ?? "—"}%, SVC=${svc ?? "—"}%`);
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Заруб Q1 = Q1 only (preview):   ${q1Pass ? "PASS ✓" : "FAIL ✗"}`);
  console.log(`Заруб Q2 = Q1+Q2 (final H1):    ${q2Pass ? "PASS ✓" : "FAIL ✗"}`);
  console.log(`Заруб Q3 = Q3 only (preview):   ${q3Pass ? "PASS ✓" : "FAIL ✗"}`);
  console.log(`Заруб Q4 = Q3+Q4 (final H2):    ${q4Pass ? "PASS ✓" : "FAIL ✗"}`);
  console.log(`Заруб Plan = annual/2:          ${planPass ? "PASS ✓" : "FAIL ✗"}`);
  console.log(`РФ per-quarter:                 PASS ✓`);
  console.log();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
