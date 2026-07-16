"use client";

import type { DealerData, Quarter } from "@/lib/types";
import {
  MONTH_LABELS, fmt, fmtPct, sumYear,
  quarterlyFactsByCategory, halfYearFactsByCategory,
} from "@/lib/calc";
import {
  calcEquipmentDiscountPct, calcMaterialsDiscountPctSplit,
  getServiceDiscountPctNormalized,
} from "@/lib/discount";

interface Props {
  dealer: DealerData;
  quarter: Quarter;
  quarterMonthRange: string;
}

/**
 * Opens a new browser window with a print-ready HTML page for a single dealer.
 * Header → KPI line → Categories table → Scale tables (HTML) → Monthly breakdown.
 * window.print() is called automatically after the window loads.
 */
export function printDealer(p: Props) {
  const { dealer: d, quarter, quarterMonthRange } = p;

  // Annual plan + annual fact
  const planEq = d.plan.equipment;
  const planMat = d.plan.materials;
  const planSvc = d.plan.service;
  const planTotal = planEq + planMat + planSvc;

  const factEq = sumYear(d.facts.equipment.months) ?? 0;
  const factMat = sumYear(d.facts.materials.months) ?? 0;
  const factSvc = sumYear(d.facts.service.months) ?? 0;
  const factTotal = factEq + factMat + factSvc;

  // Effective facts for the current quarter.
  // РФ: per-quarter facts. Заруб: accumulated half-year facts (Q1 alone, Q1+Q2, Q3 alone, Q3+Q4).
  const isZarub = d.type === "Заруб";
  const qf = isZarub
    ? halfYearFactsByCategory(d, quarter)
    : quarterlyFactsByCategory(d, quarter);
  const qFactEq = qf.equipment ?? 0;
  const qFactMat = qf.materials ?? 0;
  const qFactSvc = qf.service ?? 0;

  // Period subtitle (no year)
  const periodLabel = isZarub
    ? `за ${quarter <= 2 ? 1 : 2} п/г (${quarterMonthRange}) — накопительно до ${quarter} кв.`
    : `за ${quarter} кв. (${quarterMonthRange})`;

  // Discount % per category (current quarter)
  const eqPct = calcEquipmentDiscountPct(d, quarter);
  const matSplit = calcMaterialsDiscountPctSplit(d, quarter);
  const matVolPct = matSplit.volume;
  const matMinPct = matSplit.minStock;
  const svcPct = getServiceDiscountPctNormalized(d, quarter);

  // Format helpers
  const f = (n: number | null | undefined, suffix = " €") => {
    if (n === null || n === undefined) return "—";
    const rounded = Math.round(n);
    if (Math.abs(n - rounded) < 0.01) {
      return rounded.toLocaleString("ru-RU").replace(/\u00A0/g, " ") + suffix;
    }
    return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u00A0/g, " ") + suffix;
  };
  const fp = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? "—" : `${n.toFixed(digits)}%`);

  const today = new Date();
  const todayStr = today.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });

  // Build monthly breakdown rows
  const monthHeader = [...MONTH_LABELS];
  const buildMonthlyRow = (label: string, months: (number | null)[]) => {
    const total = sumYear(months) ?? 0;
    const cells = months.map((v) => (v === null ? '<td class="empty">—</td>' : `<td>${f(v, "")}</td>`)).join("");
    return `<tr><td class="cat">${label}</td>${cells}<td class="total">${f(total, "")}</td></tr>`;
  };

  // Build a scale as an HTML TABLE (not text)
  type ScaleLike = {
    title: string;
    columns: string[];
    rows: { component: string; values: (string | number)[]; isTotal?: boolean }[];
    period?: string;
  };
  const renderScaleTable = (s?: ScaleLike) => {
    if (!s) return '<p class="muted">Шкала не найдена</p>';
    const colHeaders = s.columns.map((c) => `<th>${c}</th>`).join("");
    const rows = s.rows.map((r) => {
      const cls = r.isTotal || r.component.toLowerCase().includes("итого") ? ' class="total-row"' : "";
      const cells = r.values.map((v) => `<td>${v}</td>`).join("");
      return `<tr${cls}><td class="cat">${r.component}</td>${cells}</tr>`;
    }).join("");
    return `
      <table class="scale-table">
        <thead>
          <tr>
            <th class="cat">Компонент</th>
            ${colHeaders}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${s.period ? `<div class="scale-period">Период: ${s.period}</div>` : ""}
    `;
  };

  const eqScale = d.scales?.find((s) => s.title.toLowerCase().includes("оборуд"));
  const matScale = d.scales?.find((s) => s.title.toLowerCase().includes("расход"));
  const svcScale = d.scales?.find((s) => s.title.toLowerCase().includes("сервис"));

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${d.name} — Печать</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Inter', -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif; color: #0f172a; margin: 24px; font-size: 12px; }
  h1 { font-size: 16px; margin: 0 0 4px; color: #047857; }
  h2 { font-size: 13px; margin: 18px 0 6px; color: #334155; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #047857; padding-bottom: 8px; margin-bottom: 12px; }
  .header .meta { font-size: 11px; color: #64748b; text-align: right; }
  .header .meta .comp { font-weight: 600; color: #0f172a; }
  .dealer-line { background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; font-size: 12px; }
  .dealer-line .name { font-weight: 700; font-size: 13px; color: #065f46; }
  .dealer-line .kpi { margin-left: 12px; color: #475569; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: right; font-size: 11px; }
  th { background: #f1f5f9; font-weight: 600; color: #334155; }
  td.cat, th.cat { text-align: left; font-weight: 600; background: #f8fafc; min-width: 110px; }
  td.empty { color: #94a3b8; }
  td.total, th.total { background: #fef3c7; font-weight: 700; }
  .discount { background: #ecfdf5; color: #047857; font-weight: 700; }
  .scale-table { margin-bottom: 4px; }
  .scale-table .total-row td { background: #ecfdf5; font-weight: 700; color: #047857; }
  .scale-block { margin-bottom: 14px; }
  .scale-block h3 { font-size: 12px; margin: 8px 0 4px; color: #047857; font-weight: 600; }
  .scale-period { font-size: 10px; color: #64748b; margin-bottom: 8px; }
  .monthly th { font-size: 10px; }
  .monthly td { font-size: 10px; }
  .monthly th.cat, .monthly td.cat { min-width: 90px; }
  .muted { color: #94a3b8; font-style: italic; font-size: 11px; }
  @media print {
    body { margin: 8mm; }
    .no-print { display: none !important; }
  }
  .print-btn { background: #047857; color: white; border: none; padding: 6px 14px; border-radius: 4px; font-size: 12px; cursor: pointer; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Расчёт скидок — ${isZarub ? `${quarter <= 2 ? 1 : 2} полугодие (до ${quarter} кв.)` : `${quarter} кв.`}</h1>
      <div style="font-size: 11px; color: #64748b;">${periodLabel}</div>
    </div>
    <div class="meta">
      <div class="comp">КОМПО</div>
      <div>${todayStr}</div>
    </div>
  </div>

  <div class="dealer-line">
    <span class="name">${d.name}</span>
    <span class="kpi">План: ${f(planTotal)}</span>
    <span class="kpi">Выручка: ${f(factTotal)}</span>
    <span class="kpi">Тип: ${d.type}</span>
  </div>

  <h2>Категории — план / факт / выполнение / скидка</h2>
  <table>
    <thead>
      <tr>
        <th class="cat">Категория</th>
        <th>План год</th>
        <th>Факт год</th>
        <th>Выполн. ${quarter} кв.</th>
        <th>Скидка % (объём)</th>
        <th>Скидка % (мин. ост.)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="cat">Оборудование</td>
        <td>${f(planEq)}</td>
        <td>${f(factEq)}</td>
        <td>${f(qFactEq)}</td>
        <td class="discount">${fp(eqPct)}</td>
        <td class="discount">—</td>
      </tr>
      <tr>
        <td class="cat">Расход. мат.</td>
        <td>${f(planMat)}</td>
        <td>${f(factMat)}</td>
        <td>${f(qFactMat)}</td>
        <td class="discount">${fp(matVolPct)}</td>
        <td class="discount">${fp(matMinPct)}</td>
      </tr>
      <tr>
        <td class="cat">Итого</td>
        <td>${f(planEq + planMat)}</td>
        <td>${f(factEq + factMat)}</td>
        <td>${f(qFactEq + qFactMat)}</td>
        <td class="discount">${fp(eqPct !== null && matVolPct !== null ? (eqPct + matVolPct) : null)}</td>
        <td class="discount">${fp(matMinPct)}</td>
      </tr>
      <tr>
        <td class="cat">Сервис</td>
        <td>${f(planSvc)}</td>
        <td>${factSvc > 0 ? f(factSvc) : "—"}</td>
        <td>${f(qFactSvc)}</td>
        <td class="discount">${fp(svcPct)}</td>
        <td class="discount">—</td>
      </tr>
    </tbody>
  </table>

  <h2>Шкалы скидок</h2>

  <div class="scale-block">
    <h3>${eqScale?.title ?? "Оборудование"}</h3>
    ${renderScaleTable(eqScale)}
  </div>

  <div class="scale-block">
    <h3>${matScale?.title ?? "Расходные материалы"}</h3>
    ${renderScaleTable(matScale)}
  </div>

  <div class="scale-block">
    <h3>${svcScale?.title ?? "Сервис"}</h3>
    ${renderScaleTable(svcScale)}
  </div>

  <h2>Помесячные отгрузки (Апр → Мар)</h2>
  <table class="monthly">
    <thead>
      <tr>
        <th class="cat">Категория</th>
        ${monthHeader.map((m) => `<th>${m}</th>`).join("")}
        <th class="total">Итог</th>
      </tr>
    </thead>
    <tbody>
      ${buildMonthlyRow("Оборудование", d.facts.equipment.months)}
      ${buildMonthlyRow("Расход. мат.", d.facts.materials.months)}
      ${buildMonthlyRow("Сервис", d.facts.service.months)}
    </tbody>
  </table>

  <div style="margin-top: 16px; font-size: 10px; color: #94a3b8; text-align: center;">
    Документ сформирован приложением «Расчёт скидок дилеров» • КОМПО • ${todayStr}
  </div>

  <div class="no-print" style="text-align: center; margin-top: 16px;">
    <button class="print-btn" onclick="window.print()">Печать</button>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 300);
    };
  </script>
</body>
</html>`;

  // Open a new window and write the HTML
  const w = window.open("", "_blank", "width=1024,height=720");
  if (!w) {
    alert("Разрешите всплывающие окна, чтобы открыть окно печати.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/** Helper exported as a React-friendly hook factory. */
export function useDealerPrint() {
  return printDealer;
}
