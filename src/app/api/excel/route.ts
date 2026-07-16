import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { readState } from "@/lib/data-store";
import {
  fmt,
  fmtPct,
  quarterlyFactsByCategory,
  quarterlyPlan,
  serviceFactAccumulated,
  servicePlan,
  halfYearFactsByCategory,
  effectiveFactsByCategory,
  effectivePlanTotal,
} from "@/lib/calc";
import {
  calcEquipmentDiscountPct,
  calcMaterialsDiscountPctSplit,
  calcServiceDiscountAmount,
  getServiceDiscountPctNormalized,
} from "@/lib/discount";
import type { Quarter } from "@/lib/types";

export async function GET(req: NextRequest) {
  const state = await readState();
  const quarter = (Number(req.nextUrl.searchParams.get("q") ?? state.quarter) || 1) as Quarter;
  const q = quarter;

  // Determine period label
  const monthRanges = ["Апр–Июн", "Июл–Сен", "Окт–Дек", "Янв–Мар"];
  const quarterRange = monthRanges[q - 1] ?? "";
  const halfYearRange = q <= 2 ? "Апр–Сен" : "Окт–Мар";

  const wb = XLSX.utils.book_new();

  // --- Sheet 1: Сводная ---
  // Title row: Сводная таблица выполнения условий — Q{q} ({quarterRange} / {halfYearRange})
  const summaryRows: (string | number)[][] = [];
  summaryRows.push([
    `Сводная таблица выполнения условий — ${q} кв. (${quarterRange} РФ / ${halfYearRange} Заруб)`,
  ]);
  summaryRows.push([]); // empty spacer row

  // Group header row (matches UI: Оборудование + Расходные материалы spans)
  summaryRows.push([
    "Дилер", "Тип", "План", "Факт", "Вып.",
    "Оборудование", "", "",
    "Расходные материалы", "", "", "",
    "Печать",
  ]);
  summaryRows.push([
    "", "", "", "", "",
    "План", "Факт", "Скид. %",
    "План", "Факт", "Скид. % (объём)", "Скид. % (мин. ост.)",
    "",
  ]);

  for (const d of state.dealers) {
    // Effective facts/plan — for Заруб dealers, returns accumulated half-year facts
    // (Q1 alone on Q1, Q1+Q2 on Q2, Q3 alone on Q3, Q3+Q4 on Q4) and half-year plan (annual/2).
    // Intermediate values are shown on Q1/Q3 for monitoring; final values on Q2/Q4.
    const plan = effectivePlanTotal(d, q) ?? 0;
    const planIsNull = effectivePlanTotal(d, q) === null;
    const facts = effectiveFactsByCategory(d, q);
    const factTotal =
      facts.service !== null || facts.equipment !== null || facts.materials !== null
        ? (facts.service ?? 0) + (facts.equipment ?? 0) + (facts.materials ?? 0)
        : null;
    // EQ/MAT plan per period: Заруб = annual/2 (half-year plan); РФ = annual/4 (quarter plan)
    const eqPlan = d.type === "Заруб" ? d.plan.equipment / 2 : d.plan.equipment / 4;
    const matPlan = d.type === "Заруб" ? d.plan.materials / 2 : d.plan.materials / 4;
    const eqPct = calcEquipmentDiscountPct(d, q);
    const matSplit = calcMaterialsDiscountPctSplit(d, q);
    const matVolPct = matSplit.volume;
    const matMinPct = matSplit.minStock;
    summaryRows.push([
      d.name,
      d.type,
      planIsNull ? "—" : `${fmt(plan)}/${d.type === "Заруб" ? "пг" : "кв"}`,
      factTotal === null ? "нет данных" : `${fmt(factTotal)}/${d.type === "Заруб" ? "пг" : "кв"}`,
      factTotal === null || planIsNull ? "—" : `${Math.round((factTotal / plan) * 100)}%`,
      // Equipment group: план / факт / скидка
      eqPlan === null ? "—" : fmt(Math.round(eqPlan), " €"),
      fmt(facts.equipment, " €"),
      eqPct === null ? "—" : fmtPct(eqPct),
      // Materials group: план / факт / скидка (объём) / скидка (мин. ост.)
      matPlan === null ? "—" : fmt(Math.round(matPlan), " €"),
      fmt(facts.materials, " €"),
      matVolPct === null ? "—" : fmtPct(matVolPct),
      matMinPct === null ? "—" : fmtPct(matMinPct),
      "",
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Сводная");

  // --- Sheet 2: Сервис ---
  const serviceRows: (string | number)[][] = [];
  serviceRows.push([`Скидка по Сервису — накопительно (${q} кв.)`]);
  serviceRows.push([]);
  serviceRows.push([
    "Дилер", "Тип", "План Сервис (год)", "Факт Сервис (накопл.)",
    "Выполн. Сервис", "Сервис %", "Сервис скидка €",
  ]);
  for (const d of state.dealers) {
    const sp = servicePlan(d);
    const sf = serviceFactAccumulated(d);
    const exec = sf === null ? "—" : sp === 0 ? "—" : `${Math.round((sf / sp) * 100)}%`;
    const pct = getServiceDiscountPctNormalized(d);
    const discount = calcServiceDiscountAmount(d);
    serviceRows.push([
      d.name, d.type, fmt(sp),
      sf === null ? "нет данных" : fmt(sf),
      exec,
      pct === null ? "—" : fmtPct(pct),
      discount === null ? "—" : fmt(discount, " €"),
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(serviceRows), "Сервис");

  // --- Sheet 3: Данные ---
  const dataRows: (string | number)[][] = [];
  dataRows.push([
    "Дилер", "Тип",
    "План Сервис (год)", "План Оборуд. (год)", "План Расход. мат. (год)",
    "Итого план", "В мес.",
  ]);
  for (const d of state.dealers) {
    const total = d.plan.service + d.plan.equipment + d.plan.materials;
    dataRows.push([
      d.name, d.type,
      fmt(d.plan.service), fmt(d.plan.equipment), fmt(d.plan.materials),
      fmt(total), fmt(Math.round(total / 12)),
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dataRows), "Данные");

  // --- Sheet 4: Шкалы ---
  const scaleRows: (string | number)[][] = [];
  for (const table of state.scales) {
    scaleRows.push([table.title]);
    scaleRows.push(["Компонент", ...table.columns]);
    for (const row of table.rows) scaleRows.push([row.component, ...row.values]);
    scaleRows.push([]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(scaleRows), "Шкалы");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer;
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="discounts-q${quarter}.xlsx"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
