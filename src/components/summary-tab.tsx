"use client";

import { useState, useMemo } from "react";
import type { DealerData, Quarter } from "@/lib/types";
import {
  fmt, fmtPct, quarterlyPlan, quarterlyFactsByCategory,
  servicePlan, serviceFactAccumulated, hasFacts,
  effectiveFactsByCategory, effectivePlanTotal,
} from "@/lib/calc";
import {
  calcEquipmentDiscountPct, calcMaterialsDiscountPctSplit,
  getServiceDiscountPctNormalized,
} from "@/lib/discount";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Info, Printer,
  ArrowUp, ArrowDown, ChevronsUpDown,
} from "lucide-react";
import { printDealer } from "@/components/dealer-print-view";

type SortDir = "asc" | "desc";

/** Sortable header cell. Clicking toggles asc/desc; shows ▲/▼/⇅ indicator.
 *  Renders <th> directly — never nest inside another <TableHead>. */
function SortableHead({
  label, active, dir, onToggle, className = "", align = "right", rowSpan,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onToggle: () => void;
  className?: string;
  align?: "left" | "right" | "center";
  rowSpan?: number;
}) {
  const alignCls = align === "left" ? "text-left" : align === "center" ? "text-center" : "text-right";
  return (
    <TableHead
      rowSpan={rowSpan}
      className={`align-bottom font-medium ${alignCls} text-[11px] whitespace-nowrap cursor-pointer select-none hover:bg-slate-100 transition-colors px-2 py-2 ${className}`}
      onClick={onToggle}
      title={`Сортировать: ${label}`}
    >
      <span className={`inline-flex items-center gap-0.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <span>{label}</span>
        {active ? (
          dir === "asc" ? <ArrowUp className="size-2.5 text-emerald-600" /> : <ArrowDown className="size-2.5 text-emerald-600" />
        ) : (
          <ChevronsUpDown className="size-2.5 text-slate-300" />
        )}
      </span>
    </TableHead>
  );
}

/** Null-safe comparator: nulls always sort last (regardless of dir). */
function cmp(a: number | null, b: number | null, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === "asc" ? a - b : b - a;
}

function cmpStr(a: string, b: string, dir: SortDir): number {
  const r = a.localeCompare(b, "ru");
  return dir === "asc" ? r : -r;
}

interface Props {
  dealers: DealerData[];
  quarter: Quarter;
  kpis: {
    rfCount: number;
    foreignCount: number;
    planTotal: number;
    factTotal: number;
    dealersWithFacts: number;
    avgExec: number;
  };
  quarterMonthRange: string;
  halfYearMonthRange: string;
}

/** Sort keys for table 1 (Выполнение условий) — MAT discount split into volume + min-stock */
type ExecSortKey =
  | "name" | "type" | "plan" | "fact" | "exec"
  | "eqPlan" | "eqFact" | "eqPct"
  | "matPlan" | "matFact" | "matVolPct" | "matMinPct";

/** Sort keys for table 2 (Сервис) */
type SvcSortKey = "name" | "type" | "svcPlan" | "svcFact" | "svcExec" | "svcPct";

export function SummaryTab({
  dealers, quarter, kpis, quarterMonthRange, halfYearMonthRange,
}: Props) {
  const periodSuffix = (d: DealerData) => (d.type === "Заруб" ? "пг" : "кв");

  const handleDealerPrint = (d: DealerData) =>
    printDealer({ dealer: d, quarter, quarterMonthRange });

  // Sort state for table 1
  const [execSortKey, setExecSortKey] = useState<ExecSortKey>("name");
  const [execSortDir, setExecSortDir] = useState<SortDir>("asc");
  const toggleExecSort = (k: ExecSortKey) => {
    if (execSortKey === k) setExecSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setExecSortKey(k); setExecSortDir(k === "name" || k === "type" ? "asc" : "desc"); }
  };

  // Sort state for table 2
  const [svcSortKey, setSvcSortKey] = useState<SvcSortKey>("name");
  const [svcSortDir, setSvcSortDir] = useState<SortDir>("asc");
  const toggleSvcSort = (k: SvcSortKey) => {
    if (svcSortKey === k) setSvcSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSvcSortKey(k); setSvcSortDir(k === "name" || k === "type" ? "asc" : "desc"); }
  };

  // Precompute per-dealer rows for table 1, then sort.
  const execRows = useMemo(() => {
    const rows = dealers.map((d) => {
      // Effective facts/plan — for Заруб dealers, returns accumulated half-year facts
      // (Q1 alone on Q1, Q1+Q2 on Q2, Q3 alone on Q3, Q3+Q4 on Q4) and half-year plan (annual/2).
      // Intermediate values are shown on Q1/Q3 for monitoring; final values on Q2/Q4.
      const plan = effectivePlanTotal(d, quarter) ?? 0;
      const facts = effectiveFactsByCategory(d, quarter);
      const hasFact = hasFacts([
        ...d.facts.service.months, ...d.facts.equipment.months, ...d.facts.materials.months,
      ]);
      const factTotal = hasFact && (facts.service !== null || facts.equipment !== null || facts.materials !== null)
        ? (facts.service ?? 0) + (facts.equipment ?? 0) + (facts.materials ?? 0)
        : null;
      const execPct = factTotal === null || plan === 0 ? null : Math.round((factTotal / plan) * 100);
      // EQ/MAT plan per period: Заруб = annual/2 (half-year plan); РФ = annual/4 (quarter plan)
      const eqPlan = d.type === "Заруб" ? d.plan.equipment / 2 : d.plan.equipment / 4;
      const matPlan = d.type === "Заруб" ? d.plan.materials / 2 : d.plan.materials / 4;
      const eqPct = calcEquipmentDiscountPct(d, quarter);
      const matSplit = calcMaterialsDiscountPctSplit(d, quarter);
      return { d, plan, facts, hasFact, factTotal, execPct, eqPlan, matPlan, eqPct, matVolPct: matSplit.volume, matMinPct: matSplit.minStock };
    });
    const dir = execSortDir;
    rows.sort((a, b) => {
      switch (execSortKey) {
        case "name":   return cmpStr(a.d.name, b.d.name, dir);
        case "type":   return cmpStr(a.d.type, b.d.type, dir);
        case "plan":   return cmp(a.plan, b.plan, dir);
        case "fact":   return cmp(a.factTotal, b.factTotal, dir);
        case "exec":   return cmp(a.execPct, b.execPct, dir);
        case "eqPlan": return cmp(a.eqPlan, b.eqPlan, dir);
        case "eqFact": return cmp(a.facts.equipment, b.facts.equipment, dir);
        case "eqPct":  return cmp(a.eqPct, b.eqPct, dir);
        case "matPlan":   return cmp(a.matPlan, b.matPlan, dir);
        case "matFact":   return cmp(a.facts.materials, b.facts.materials, dir);
        case "matVolPct": return cmp(a.matVolPct, b.matVolPct, dir);
        case "matMinPct": return cmp(a.matMinPct, b.matMinPct, dir);
      }
    });
    return rows;
  }, [dealers, quarter, execSortKey, execSortDir]);

  // Precompute per-dealer rows for table 2, then sort.
  const svcRows = useMemo(() => {
    const rows = dealers.map((d) => {
      const sp = servicePlan(d);
      const sf = serviceFactAccumulated(d);
      const exec = sf === null ? null : sp === 0 ? null : Math.round((sf / sp) * 100);
      const pct = getServiceDiscountPctNormalized(d, quarter);
      return { d, sp, sf, exec, pct };
    });
    const dir = svcSortDir;
    rows.sort((a, b) => {
      switch (svcSortKey) {
        case "name":    return cmpStr(a.d.name, b.d.name, dir);
        case "type":    return cmpStr(a.d.type, b.d.type, dir);
        case "svcPlan": return cmp(a.sp, b.sp, dir);
        case "svcFact": return cmp(a.sf, b.sf, dir);
        case "svcExec": return cmp(a.exec, b.exec, dir);
        case "svcPct":  return cmp(a.pct, b.pct, dir);
      }
    });
    return rows;
  }, [dealers, quarter, svcSortKey, svcSortDir]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        {/* ─── Table 1: Сводная — без прокрутки, все колонки видимы ─────── */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CardTitle className="font-semibold text-base">Сводная таблица выполнения условий</CardTitle>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="text-gray-400 hover:text-gray-600">
                    <Info className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Скидки рассчитываются динамически по шкале дилера. РФ — за квартал, Заруб — накопительно за полугодие (Q1+Q2=H1, Q3+Q4=H2). Промежуточные значения на Q1/Q3 отображаются для мониторинга. Если нет продаж — скидка не назначается. Минимум — 14%.
                </TooltipContent>
              </Tooltip>
            </div>
            <CardDescription>
              РФ: за {quarter} кв. ({quarterMonthRange}) • Заруб: за {quarter <= 2 ? "1" : "2"} п/г ({halfYearMonthRange})
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="w-full overflow-x-auto thin-scroll">
              <style>{`
                .thin-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
                .thin-scroll::-webkit-scrollbar-track { background: #f1f5f9; }
                .thin-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
                .thin-scroll * { scrollbar-width: thin; scrollbar-color: #cbd5e1 #f1f5f9; }
                @media print { .no-print { display: none !important; } }
              `}</style>
              <Table className="text-[11px] w-full table-fixed">
                {/* Explicit column proportions — prevents browser from stretching
                    short-content columns (Тип, Вып., Скид. %) and creating big gaps. */}
                {/* Column widths: 16 Дилер | 4 Тип | 8 План | 8 Факт | 5 Вып. | 8 EQ План | 8 EQ Факт | 7 EQ Скид.% | 8 MAT План | 8 MAT Факт | 7 MAT Скид.% (объём) | 7 MAT Скид.% (мин.ост.) | 4 Печать */}
                <colgroup><col style={{ width: "16%" }} /><col style={{ width: "4%" }} /><col style={{ width: "8%" }} /><col style={{ width: "8%" }} /><col style={{ width: "5%" }} /><col style={{ width: "8%" }} /><col style={{ width: "8%" }} /><col style={{ width: "7%" }} /><col style={{ width: "8%" }} /><col style={{ width: "8%" }} /><col style={{ width: "7%" }} /><col style={{ width: "7%" }} /><col style={{ width: "4%" }} /></colgroup>
                {/* Group header row */}
                <TableHeader className="bg-card">
                  <TableRow className="border-b">
                    <SortableHead
                      label="Дилер" align="left" rowSpan={2}
                      active={execSortKey === "name"} dir={execSortDir}
                      onToggle={() => toggleExecSort("name")}
                    />
                    <SortableHead
                      label="Тип" align="center" rowSpan={2}
                      active={execSortKey === "type"} dir={execSortDir}
                      onToggle={() => toggleExecSort("type")}
                    />
                    <SortableHead
                      label="План" rowSpan={2}
                      active={execSortKey === "plan"} dir={execSortDir}
                      onToggle={() => toggleExecSort("plan")}
                    />
                    <SortableHead
                      label="Факт" rowSpan={2}
                      active={execSortKey === "fact"} dir={execSortDir}
                      onToggle={() => toggleExecSort("fact")}
                    />
                    <SortableHead
                      label="Вып." align="center" rowSpan={2}
                      active={execSortKey === "exec"} dir={execSortDir}
                      onToggle={() => toggleExecSort("exec")}
                    />
                    {/* Equipment group */}
                    <TableHead colSpan={3} className="text-center text-[11px] font-semibold whitespace-nowrap px-2 py-1.5 bg-emerald-50 text-emerald-700 border-l border-r border-emerald-200">
                      Оборудование
                    </TableHead>
                    {/* Materials group — 4 cols: План, Факт, Скид.% (объём), Скид.% (мин.ост.) */}
                    <TableHead colSpan={4} className="text-center text-[11px] font-semibold whitespace-nowrap px-2 py-1.5 bg-emerald-50 text-emerald-700 border-l border-r border-emerald-200">
                      Расходные материалы
                    </TableHead>
                    <TableHead rowSpan={2} className="align-bottom text-center text-[11px] font-medium whitespace-nowrap no-print px-2 py-2">
                      Печать
                    </TableHead>
                  </TableRow>
                  <TableRow className="border-b">
                    <SortableHead label="План" className="bg-emerald-50/60 border-l border-emerald-200"
                      active={execSortKey === "eqPlan"} dir={execSortDir}
                      onToggle={() => toggleExecSort("eqPlan")} />
                    <SortableHead label="Факт" className="bg-emerald-50/60"
                      active={execSortKey === "eqFact"} dir={execSortDir}
                      onToggle={() => toggleExecSort("eqFact")} />
                    <SortableHead label="Скид. %" className="bg-emerald-50/60 border-r border-emerald-200"
                      active={execSortKey === "eqPct"} dir={execSortDir}
                      onToggle={() => toggleExecSort("eqPct")} />
                    <SortableHead label="План" className="bg-emerald-50/60 border-l border-emerald-200"
                      active={execSortKey === "matPlan"} dir={execSortDir}
                      onToggle={() => toggleExecSort("matPlan")} />
                    <SortableHead label="Факт" className="bg-emerald-50/60"
                      active={execSortKey === "matFact"} dir={execSortDir}
                      onToggle={() => toggleExecSort("matFact")} />
                    <SortableHead label="Скид. % (объём)" className="bg-emerald-50/60"
                      active={execSortKey === "matVolPct"} dir={execSortDir}
                      onToggle={() => toggleExecSort("matVolPct")} />
                    <SortableHead label="Скид. % (мин. ост.)" className="bg-emerald-50/60 border-r border-emerald-200"
                      active={execSortKey === "matMinPct"} dir={execSortDir}
                      onToggle={() => toggleExecSort("matMinPct")} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {execRows.map((row) => {
                    const { d, plan, facts, factTotal, execPct, eqPlan, matPlan, eqPct, matVolPct, matMinPct } = row;
                    const noData = factTotal === null;
                    return (
                      <TableRow
                        key={d.id}
                        className={`border-b transition-colors hover:bg-emerald-50/40 ${noData ? "opacity-60" : ""}`}
                      >
                        <TableCell className="font-medium text-[11px] whitespace-nowrap px-2 py-1.5 truncate" title={d.name}>{d.name}</TableCell>
                        <TableCell className="text-center whitespace-nowrap px-2 py-1.5">
                          {d.type === "РФ" ? (
                            <Badge variant="default" className="text-[9px] px-1 py-0">РФ</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0">Заруб</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[11px] whitespace-nowrap px-2 py-1.5">{plan === null ? "—" : `${fmt(plan)} / ${periodSuffix(d)}`}</TableCell>
                        <TableCell className="text-right tabular-nums text-[11px] whitespace-nowrap px-2 py-1.5">
                          {factTotal === null ? "нет" : `${fmt(factTotal)} / ${periodSuffix(d)}`}
                        </TableCell>
                        <TableCell className="text-center tabular-nums text-[11px] font-medium whitespace-nowrap px-2 py-1.5">
                          {execPct === null ? "—" : `${execPct}%`}
                        </TableCell>
                        {/* Equipment group */}
                        <TableCell className="text-right tabular-nums text-[11px] text-gray-600 whitespace-nowrap bg-emerald-50/30 border-l border-emerald-200 px-2 py-1.5">{eqPlan === null ? "—" : fmt(Math.round(eqPlan), "€")}</TableCell>
                        <TableCell className="text-right tabular-nums text-[11px] whitespace-nowrap bg-emerald-50/30 px-2 py-1.5">{fmt(facts.equipment, "€")}</TableCell>
                        <TableCell className="text-right tabular-nums text-[11px] font-semibold text-emerald-700 whitespace-nowrap bg-emerald-50/40 border-r border-emerald-200 px-2 py-1.5">
                          {eqPct === null ? "—" : fmtPct(eqPct)}
                        </TableCell>
                        {/* Materials group — 4 cols */}
                        <TableCell className="text-right tabular-nums text-[11px] text-gray-600 whitespace-nowrap bg-emerald-50/30 border-l border-emerald-200 px-2 py-1.5">{matPlan === null ? "—" : fmt(Math.round(matPlan), "€")}</TableCell>
                        <TableCell className="text-right tabular-nums text-[11px] whitespace-nowrap bg-emerald-50/30 px-2 py-1.5">{fmt(facts.materials, "€")}</TableCell>
                        <TableCell className="text-right tabular-nums text-[11px] font-semibold text-emerald-700 whitespace-nowrap bg-emerald-50/40 px-2 py-1.5">
                          {matVolPct === null ? "—" : fmtPct(matVolPct)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[11px] font-semibold text-emerald-700 whitespace-nowrap bg-emerald-50/40 border-r border-emerald-200 px-2 py-1.5">
                          {matMinPct === null ? "—" : fmtPct(matMinPct)}
                        </TableCell>
                        <TableCell className="text-center whitespace-nowrap no-print px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => handleDealerPrint(d)}
                            className="inline-flex items-center justify-center w-6 h-6 rounded-md text-gray-500 hover:bg-emerald-100 hover:text-emerald-700 transition-colors"
                            title={`Печать карточки: ${d.name}`}
                          >
                            <Printer className="size-3" />
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* ─── Table 2: Service ───────────────────────────────────────────── */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CardTitle className="font-semibold text-base">Скидка по Сервису — накопительно</CardTitle>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="text-violet-500 hover:text-violet-600">
                    <Info className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Скидка по сервису рассчитывается по шкале «Сервис (ЗЧ) — абсолютные отгрузки за 12 месяцев» от накопленного факта.
                </TooltipContent>
              </Tooltip>
            </div>
            <CardDescription>Накопительным итогом за расчётный период</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="w-full overflow-x-auto thin-scroll">
              <Table className="text-[11px] w-full table-fixed">
                {/* Explicit column proportions — prevents stretching gaps. */}
                {/* Column widths: 30 Дилер | 7 Тип | 16 План Сервис | 16 Факт Сервис | 12 Выполн. | 19 Сервис % */}
                <colgroup><col style={{ width: "30%" }} /><col style={{ width: "7%" }} /><col style={{ width: "16%" }} /><col style={{ width: "16%" }} /><col style={{ width: "12%" }} /><col style={{ width: "19%" }} /></colgroup>
                <TableHeader className="bg-card">
                  <TableRow className="border-b">
                    <SortableHead
                      label="Дилер" align="left"
                      active={svcSortKey === "name"} dir={svcSortDir}
                      onToggle={() => toggleSvcSort("name")}
                    />
                    <SortableHead
                      label="Тип" align="center"
                      active={svcSortKey === "type"} dir={svcSortDir}
                      onToggle={() => toggleSvcSort("type")}
                    />
                    <SortableHead label="План Сервис (год)"
                      active={svcSortKey === "svcPlan"} dir={svcSortDir}
                      onToggle={() => toggleSvcSort("svcPlan")} />
                    <SortableHead label="Факт Сервис (накопл.)"
                      active={svcSortKey === "svcFact"} dir={svcSortDir}
                      onToggle={() => toggleSvcSort("svcFact")} />
                    <SortableHead label="Выполн. Сервис" align="center"
                      active={svcSortKey === "svcExec"} dir={svcSortDir}
                      onToggle={() => toggleSvcSort("svcExec")} />
                    <SortableHead label="Сервис %" className="bg-violet-50"
                      active={svcSortKey === "svcPct"} dir={svcSortDir}
                      onToggle={() => toggleSvcSort("svcPct")} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {svcRows.map((row) => {
                    const { d, sp, sf, exec, pct } = row;
                    const noData = sf === null;
                    return (
                      <TableRow
                        key={d.id}
                        className={`border-b transition-colors hover:bg-violet-50/40 ${noData ? "opacity-60" : ""}`}
                      >
                        <TableCell className="font-medium text-[11px] whitespace-nowrap px-2 py-1.5 truncate" title={d.name}>{d.name}</TableCell>
                        <TableCell className="text-center whitespace-nowrap px-2 py-1.5">
                          {d.type === "РФ" ? (
                            <Badge variant="default" className="text-[9px] px-1 py-0">РФ</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0">Заруб</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[11px] whitespace-nowrap px-2 py-1.5">{fmt(sp)}</TableCell>
                        <TableCell className="text-right tabular-nums text-[11px] whitespace-nowrap px-2 py-1.5">
                          {sf === null ? "нет" : fmt(sf)}
                        </TableCell>
                        <TableCell className="text-center tabular-nums text-[11px] font-medium whitespace-nowrap px-2 py-1.5">
                          {exec === null ? "—" : `${exec}%`}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[11px] font-bold text-violet-800 bg-violet-50 whitespace-nowrap px-2 py-1.5">
                          {pct === null ? "—" : fmtPct(pct)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
