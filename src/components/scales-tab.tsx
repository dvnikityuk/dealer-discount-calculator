"use client";

import { useState, useMemo } from "react";
import type { DealerData, Quarter, ScaleTable } from "@/lib/types";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Check } from "lucide-react";
import {
  parseTier, findScaleTable, calcEquipmentDiscountPct, calcMaterialsDiscountPct, calcMaterialsDiscountPctSplit,
  getServiceDiscountPctNormalized,
} from "@/lib/discount";
import { quarterlyFactsByCategory, halfYearFactsByCategory, serviceFactAccumulated } from "@/lib/calc";

interface Props {
  scales: ScaleTable[];
  dealers: DealerData[];
  quarter: Quarter;
}

type ScaleKind = "equipment" | "materials" | "service" | "control";

/** Classify a scale table by its title. */
function classifyScale(table: ScaleTable): ScaleKind {
  const t = table.title.toLowerCase();
  if (t.includes("оборудование")) return "equipment";
  if (t.includes("расходн")) return "materials";
  if (t.includes("сервис") || t.includes("запчаст")) return "service";
  return "control";
}

/** Per-kind accent colors. */
const KIND_STYLE: Record<ScaleKind, {
  activeChip: string;
  activeCell: string;
  totalActive: string;
  badge: string;
  dot: string;
  valueText: string;
}> = {
  equipment: {
    activeChip: "bg-emerald-700 text-white border-emerald-700",
    activeCell: "bg-emerald-50 text-emerald-700 font-bold",
    totalActive: "bg-emerald-100 text-emerald-800 font-bold",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
    valueText: "text-emerald-700",
  },
  materials: {
    activeChip: "bg-amber-700 text-white border-amber-700",
    activeCell: "bg-amber-50 text-amber-700 font-bold",
    totalActive: "bg-amber-100 text-amber-800 font-bold",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
    valueText: "text-amber-700",
  },
  service: {
    activeChip: "bg-violet-700 text-white border-violet-700",
    activeCell: "bg-violet-50 text-violet-700 font-bold",
    totalActive: "bg-violet-100 text-violet-800 font-bold",
    badge: "bg-violet-50 text-violet-700 border-violet-200",
    dot: "bg-violet-500",
    valueText: "text-violet-700",
  },
  control: {
    activeChip: "bg-slate-800 text-white border-slate-800",
    activeCell: "bg-slate-100 text-slate-800 font-bold",
    totalActive: "bg-slate-200 text-slate-900 font-bold",
    badge: "bg-slate-100 text-slate-700 border-slate-200",
    dot: "bg-slate-500",
    valueText: "text-slate-700",
  },
};

/** Shorten verbose component names from the XLSX.
 *  Strips leading numbering like "1 ", "2.1.1. ", "3 " and trims to ~32 chars. */
function shortenLabel(s: string): string {
  let out = s.trim();
  // Strip leading numbering: "1 ", "2.1.1. ", "3.1. "
  out = out.replace(/^(\d+(\.\d+)*[\.\)]\s*)/, "");
  // Strip leading "•", "-"
  out = out.replace(/^[\s•\-–—]+/, "");
  // Common long-form replacements
  out = out
    .replace(/Базовое вознаграждение за достижение[\s\S]*$/i, "Базовое вознаграждение")
    .replace(/Сервисный центр сертифицирован[\s\S]*$/i, "Сервисный центр")
    .replace(/Сервисный центр\s*-\s*гарантийный[\s\S]*$/i, "Сервисный центр гарантийный")
    .replace(/Наличие минимальных складских[\s\S]*$/i, "Наличие мин. остатков")
    .replace(/Наличие минимальных остатков[\s\S]*$/i, "Наличие мин. остатков")
    .replace(/Объем закупок МП[\s\S]*$/i, "Объём закупок МП")
    .replace(/Объем закупок РМ[\s\S]*$/i, "Объём закупок РМ")
    .replace(/Объем закупок оборудования[\s\S]*$/i, "Объём закупок оборудования")
    .replace(/ИТОГО по МП/i, "ИТОГО")
    .replace(/уменьшение бонуса за невыполнение[\s\S]*$/i, "Невыполнение плана")
    .replace(/уменьшение бонуса за отказ[\s\S]*$/i, "Отказ от рекламыации")
    .replace(/за несвоевременное предоставление[\s\S]*$/i, "Несвоевременная отчётность")
    .replace(/Выполнение плановых показателей[\s\S]*$/i, "Выполнение плана");
  return out;
}

/** Decide if a table should be rendered transposed (tiers as rows).
 *  True for the service scale, which has 1 row but many columns (up to 12). */
function shouldTranspose(table: ScaleTable): boolean {
  return table.rows.length <= 2 && table.columns.length >= 5;
}

export function ScalesTab({ scales, dealers, quarter }: Props) {
  const [selectedDealerId, setSelectedDealerId] = useState(dealers[0]?.id ?? "");
  const selectedDealer = dealers.find((d) => d.id === selectedDealerId) ?? dealers[0];

  // Use the SELECTED DEALER's own scales (each dealer has its own version of the 4 scales).
  // Fall back to the global `scales` prop only if the dealer has no scales at all.
  const dealerScales = selectedDealer?.scales ?? scales;

  // Determine active tier column per scale.
  // For Заруб dealers, the active tier is computed from the accumulated half-year fact
  // (Q1 alone on Q1, Q1+Q2 on Q2, Q3 alone on Q3, Q3+Q4 on Q4) — always shown for monitoring.
  const activeTierByScale = useMemo(() => {
    const result = new Map<string, number>();
    if (!selectedDealer) return result;
    for (const table of dealerScales) {
      const lcTitle = table.title.toLowerCase();
      let volume: number | null = null;
      if (lcTitle.includes("оборудование")) {
        const f = selectedDealer.type === "Заруб"
          ? halfYearFactsByCategory(selectedDealer, quarter)
          : quarterlyFactsByCategory(selectedDealer, quarter);
        const eq = f?.equipment ?? null;
        volume = eq !== null ? eq / 1000 : 0;
      } else if (lcTitle.includes("расходные")) {
        const f = selectedDealer.type === "Заруб"
          ? halfYearFactsByCategory(selectedDealer, quarter)
          : quarterlyFactsByCategory(selectedDealer, quarter);
        const mat = f?.materials ?? null;
        volume = mat !== null ? mat / 1000 : 0;
      } else if (lcTitle.includes("сервис") || lcTitle.includes("запчаст")) {
        // Service is always 12-month accumulated (regardless of dealer type).
        const f = serviceFactAccumulated(selectedDealer);
        volume = f ?? 0;
      }
      if (volume === null) continue;
      for (let i = 0; i < table.columns.length; i++) {
        const t = parseTier(table.columns[i]);
        const min = t.min ?? -Infinity;
        const max = t.max ?? Infinity;
        if (volume >= min && volume <= max) {
          result.set(table.title, i);
          break;
        }
      }
    }
    return result;
  }, [dealerScales, selectedDealer, quarter]);

  // Summary cards data
  const summary = useMemo(() => {
    if (!selectedDealer) return null;
    // For Заруб dealers, use accumulated half-year facts (Q1 alone, Q1+Q2, Q3 alone, Q3+Q4).
    const eqFact = selectedDealer.type === "Заруб"
      ? halfYearFactsByCategory(selectedDealer, quarter).equipment
      : quarterlyFactsByCategory(selectedDealer, quarter).equipment;
    const matFact = selectedDealer.type === "Заруб"
      ? halfYearFactsByCategory(selectedDealer, quarter).materials
      : quarterlyFactsByCategory(selectedDealer, quarter).materials;
    const svcFact = serviceFactAccumulated(selectedDealer);

    const eqTable = findScaleTable(selectedDealer.scales, "Оборудование");
    const matTable = findScaleTable(selectedDealer.scales, "Расходные");
    const svcTable = findScaleTable(selectedDealer.scales, "Сервис");

    return {
      equipment: {
        pct: calcEquipmentDiscountPct(selectedDealer, quarter),
        tier: eqTable && activeTierByScale.has(eqTable.title)
          ? eqTable.columns[activeTierByScale.get(eqTable.title)!]
          : null,
        fact: eqFact,
      },
      materials: {
        pct: calcMaterialsDiscountPct(selectedDealer, quarter),
        pctSplit: calcMaterialsDiscountPctSplit(selectedDealer, quarter),
        tier: matTable && activeTierByScale.has(matTable.title)
          ? matTable.columns[activeTierByScale.get(matTable.title)!]
          : null,
        fact: matFact,
      },
      service: {
        pct: getServiceDiscountPctNormalized(selectedDealer, quarter),
        tier: svcTable && activeTierByScale.has(svcTable.title)
          ? svcTable.columns[activeTierByScale.get(svcTable.title)!]
          : null,
        fact: svcFact,
      },
    };
  }, [selectedDealer, quarter, activeTierByScale]);

  const isZarub = selectedDealer?.type === "Заруб";
  const periodShort = isZarub ? "пг" : "кв";

  // Group scales into 2 rows of 2 cards each.
  // Row 1: equipment + materials
  // Row 2: service + control
  const equipmentTable = dealerScales.find(s => classifyScale(s) === "equipment");
  const materialsTable = dealerScales.find(s => classifyScale(s) === "materials");
  const serviceTable = dealerScales.find(s => classifyScale(s) === "service");
  const controlTable = dealerScales.find(s => classifyScale(s) === "control");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Шкалы скидок</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Активный тир подсвечивается автоматически по факту отгрузок выбранного дилера
          </p>
        </div>
        <Select value={selectedDealerId} onValueChange={setSelectedDealerId}>
          <SelectTrigger className="w-[280px] h-9 bg-slate-900 text-white border-slate-900 hover:bg-slate-800">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {dealers.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name} · {d.type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Top stat cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <StatCard
            label="Оборудование"
            value={summary.equipment.pct}
            tier={summary.equipment.tier}
            factLabel={`Факт ${formatFact(summary.equipment.fact)} €/${periodShort}`}
            accent="emerald"
          />
          <StatCard
            label="РМ: объём закупки"
            value={summary.materials.pctSplit.volume}
            tier={summary.materials.tier}
            factLabel={`Факт ${formatFact(summary.materials.fact)} €/${periodShort}`}
            accent="amber"
          />
          <StatCard
            label="РМ: мин. остатки"
            value={summary.materials.pctSplit.minStock}
            tier={summary.materials.tier}
            factLabel={summary.materials.pctSplit.minStock === null ? "нет в шкале" : "требование выполнено"}
            accent="amber"
          />
          <StatCard
            label="Сервис (12 мес.)"
            value={summary.service.pct}
            tier={summary.service.tier}
            factLabel={`Накопл. ${formatFact(summary.service.fact)} €`}
            accent="violet"
          />
        </div>
      )}

      {/* Row 1: Equipment + Materials */}
      <div className="grid gap-4 lg:grid-cols-2">
        {equipmentTable && (
          <ScaleCardWide
            table={equipmentTable}
            kind="equipment"
            activeCol={activeTierByScale.get(equipmentTable.title)}
          />
        )}
        {materialsTable && (
          <ScaleCardWide
            table={materialsTable}
            kind="materials"
            activeCol={activeTierByScale.get(materialsTable.title)}
          />
        )}
      </div>

      {/* Row 2: Service (transposed) + Control */}
      <div className="grid gap-4 lg:grid-cols-2">
        {serviceTable && (
          <ScaleCardTransposed
            table={serviceTable}
            kind="service"
            activeCol={activeTierByScale.get(serviceTable.title)}
          />
        )}
        {controlTable && (
          <ScaleCardControl
            table={controlTable}
            kind="control"
            activeCol={activeTierByScale.get(controlTable.title)}
          />
        )}
      </div>
    </div>
  );
}

/* ============================================================
 *  Scale card for wide tables (equipment, materials)
 *  - tier-ruler on top
 *  - compact table-fixed layout, no horizontal scroll
 * ============================================================ */
function ScaleCardWide({
  table, kind, activeCol,
}: {
  table: ScaleTable;
  kind: ScaleKind;
  activeCol: number | undefined;
}) {
  const style = KIND_STYLE[kind];
  const cols = table.columns.length;
  // Layout: 1st col (Компонент) gets fixed width, rest distributed evenly
  // Use table-fixed + explicit colgroup to prevent overflow

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-semibold text-slate-900 truncate">
          {table.title}
        </div>
        {table.period && (
          <div className="text-[10px] text-slate-400 shrink-0">{table.period}</div>
        )}
      </div>

      {/* Tier ruler — compact chips */}
      <div className="flex gap-0.5 px-2 py-1.5 bg-slate-50 border-b border-slate-100">
        {table.columns.map((c, i) => {
          const isActive = activeCol === i;
          return (
            <div
              key={c + i}
              className={`flex-1 min-w-0 px-1 py-1 rounded text-center text-[9px] font-medium border truncate ${
                isActive
                  ? style.activeChip
                  : "bg-white text-slate-500 border-slate-200"
              }`}
              title={c}
            >
              <span className="inline-flex items-center gap-0.5">
                <span className="truncate">{c}</span>
                {isActive && <Check className="w-2 h-2 shrink-0" />}
              </span>
            </div>
          );
        })}
      </div>

      {/* Compact table — table-fixed prevents overflow */}
      <table className="w-full border-collapse table-fixed">
        <colgroup><col style={{ width: "42%" }} />{table.columns.map((_, i) => (<col key={i} style={{ width: `${58 / cols}%` }} />))}</colgroup>
        <thead>
          <tr>
            <th className="text-left text-[10px] font-semibold text-slate-500 px-2.5 py-1.5 bg-slate-50 border-b border-slate-100">
              Компонент
            </th>
            {table.columns.map((c, i) => (
              <th
                key={c + i}
                className={`text-right text-[10px] font-semibold px-1.5 py-1.5 bg-slate-50 border-b border-slate-100 truncate ${
                  activeCol === i ? "text-slate-900" : "text-slate-400"
                }`}
                title={c}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => {
            const isTotal = row.isTotal || row.component.toLowerCase().includes("итого");
            const label = shortenLabel(row.component);
            return (
              <tr key={row.component} className={isTotal ? "bg-slate-50/60" : ""}>
                <td
                  className={`text-left text-[11px] px-2.5 py-1 border-b border-slate-50 truncate ${
                    isTotal ? "font-bold text-slate-900" : "font-medium text-slate-600"
                  }`}
                  title={row.component}
                >
                  {label}
                </td>
                {row.values.map((v, i) => {
                  const isActive = activeCol === i;
                  let cls = "text-right text-[11px] px-1.5 py-1 border-b border-slate-50 tabular-nums";
                  if (isActive && isTotal) cls += ` ${style.totalActive}`;
                  else if (isActive) cls += ` ${style.activeCell}`;
                  else if (isTotal) cls += " font-bold text-slate-900";
                  else cls += " text-slate-600";
                  return <td key={i} className={cls}>{v}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ============================================================
 *  Transposed scale card (for service — many columns, 1 row)
 *  Each tier becomes a row: | Диапазон | % скидки |
 * ============================================================ */
function ScaleCardTransposed({
  table, kind, activeCol,
}: {
  table: ScaleTable;
  kind: ScaleKind;
  activeCol: number | undefined;
}) {
  const style = KIND_STYLE[kind];
  // Find the single value row (typically "% скидки")
  const valueRow = table.rows[0];
  const valueRowLabel = valueRow ? shortenLabel(valueRow.component) : "% скидки";

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-semibold text-slate-900 truncate">
          {table.title}
        </div>
        {table.period && (
          <div className="text-[10px] text-slate-400 shrink-0">{table.period}</div>
        )}
      </div>

      {/* Two-column transposed table — fits any width without scroll */}
      <div className="grid grid-cols-2 max-h-[320px] overflow-y-auto">
        <table className="w-full border-collapse table-fixed">
          <colgroup><col style={{ width: "60%" }} /><col style={{ width: "40%" }} /></colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="text-left text-[10px] font-semibold text-slate-500 px-3 py-1.5 bg-slate-50 border-b border-slate-100">
                Диапазон
              </th>
              <th className="text-right text-[10px] font-semibold text-slate-500 px-3 py-1.5 bg-slate-50 border-b border-slate-100">
                {valueRowLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {table.columns.map((c, i) => {
              const isActive = activeCol === i;
              const v = valueRow?.values[i] ?? "—";
              return (
                <tr key={c + i} className={isActive ? style.activeCell : ""}>
                  <td
                    className={`text-left text-[11px] px-3 py-1 border-b border-slate-50 ${
                      isActive ? "font-bold" : "text-slate-600 font-medium"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {isActive && (
                        <span className={`inline-block w-1 h-3 rounded-sm ${style.dot}`} />
                      )}
                      {c}
                    </span>
                  </td>
                  <td
                    className={`text-right text-[11px] px-3 py-1 border-b border-slate-50 tabular-nums ${
                      isActive ? "font-bold" : "text-slate-600"
                    }`}
                  >
                    {v}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================
 *  Control scale card (penalties — narrow, no tier-ruler)
 * ============================================================ */
function ScaleCardControl({
  table, kind, activeCol,
}: {
  table: ScaleTable;
  kind: ScaleKind;
  activeCol: number | undefined;
}) {
  const style = KIND_STYLE[kind];
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-semibold text-slate-900 truncate">
          {table.title}
        </div>
        {table.period && (
          <div className="text-[10px] text-slate-400 shrink-0">{table.period}</div>
        )}
      </div>

      <table className="w-full border-collapse table-fixed">
        <colgroup><col style={{ width: "70%" }} /><col style={{ width: "30%" }} /></colgroup>
        <thead>
          <tr>
            <th className="text-left text-[10px] font-semibold text-slate-500 px-3 py-1.5 bg-slate-50 border-b border-slate-100">
              Критерий
            </th>
            <th className="text-right text-[10px] font-semibold text-slate-500 px-3 py-1.5 bg-slate-50 border-b border-slate-100">
              Скидка
            </th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, idx) => {
            const label = shortenLabel(row.component);
            // For control table, "value" is usually the only column
            const v = row.values[0];
            const isActive = activeCol === idx;
            return (
              <tr key={row.component + idx}>
                <td
                  className={`text-left text-[11px] px-3 py-1.5 border-b border-slate-50 ${
                    isActive ? style.activeCell + " font-bold" : "text-slate-600 font-medium"
                  }`}
                >
                  {label}
                </td>
                <td
                  className={`text-right text-[11px] px-3 py-1.5 border-b border-slate-50 tabular-nums ${
                    isActive ? style.activeCell + " font-bold" : "text-slate-700"
                  }`}
                >
                  {v}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ============================================================
 *  Stat card (top row)
 * ============================================================ */
function StatCard({
  label, value, tier, factLabel, accent,
}: {
  label: string;
  value: number | null;
  tier: string | null;
  factLabel: string;
  accent: "emerald" | "amber" | "violet";
}) {
  const accentMap = {
    emerald: { value: "text-emerald-700", dot: "bg-emerald-500" },
    amber: { value: "text-amber-700", dot: "bg-amber-500" },
    violet: { value: "text-violet-700", dot: "bg-violet-500" },
  }[accent];

  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${accentMap.dot}`} />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
          {label}
        </span>
      </div>
      <div className={`text-[22px] font-bold mt-0.5 leading-tight ${accentMap.value}`}>
        {value === null ? "—" : `${value.toFixed(1)}%`}
      </div>
      <div className="text-[10px] text-slate-400 mt-0.5 truncate" title={factLabel}>
        {tier ? `Тир «${tier}» · ${factLabel}` : factLabel}
      </div>
    </div>
  );
}

function formatFact(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1000) {
    return n.toLocaleString("ru-RU").replace(/\u00A0/g, " ");
  }
  return String(Math.round(n));
}
