"use client";

import { useState, useEffect } from "react";
import type { DealerData } from "@/lib/types";
import { MONTH_LABELS, fmt } from "@/lib/calc";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Printer } from "lucide-react";
import { printDealer } from "@/components/dealer-print-view";

interface Props {
  dealers: DealerData[];
  quarter: 1 | 2 | 3 | 4;
  quarterMonthRange: string;
}

export function DealerTab({ dealers, quarter, quarterMonthRange }: Props) {
  const rfDealers = dealers.filter((d) => d.type === "РФ");
  const foreignDealers = dealers.filter((d) => d.type === "Заруб");
  const [selectedId, setSelectedId] = useState(dealers[0]?.id ?? "");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const w = window as unknown as { __selectedDealer?: string };
      if (w.__selectedDealer && dealers.some((d) => d.id === w.__selectedDealer)) {
        setSelectedId(w.__selectedDealer);
        delete w.__selectedDealer;
      }
    }
  }, [dealers]);

  const dealer = dealers.find((d) => d.id === selectedId) ?? dealers[0];

  if (!dealer) {
    return <div className="text-muted-foreground p-4">Нет дилеров. Добавьте нового на вкладке «Сводная».</div>;
  }

  const handleDealerPrint = () =>
    printDealer({ dealer, quarter, quarterMonthRange });

  // Build row list: 12 months + Q1, Q2, Q3, Q4 + 1п/г + 2п/г + Год
  type RowSpec = {
    label: string;
    type: "month" | "quarter" | "half" | "year";
    /** indices into MONTH_LABELS / month arrays */
    indices?: number[];
    /** separator above this row */
    strong?: boolean;
  };
  const rowSpecs: RowSpec[] = [
    ...MONTH_LABELS.map((m, i) => ({ label: m, type: "month" as const, indices: [i] })),
    { label: "Q1 (апр–июн)", type: "quarter", indices: [0, 1, 2], strong: true },
    { label: "Q2 (июл–сен)", type: "quarter", indices: [3, 4, 5], strong: true },
    { label: "Q3 (окт–дек)", type: "quarter", indices: [6, 7, 8], strong: true },
    { label: "Q4 (янв–мар)", type: "quarter", indices: [9, 10, 11], strong: true },
    { label: "1 п/г", type: "half", indices: [0, 1, 2, 3, 4, 5], strong: true },
    { label: "2 п/г", type: "half", indices: [6, 7, 8, 9, 10, 11], strong: true },
    { label: "Год", type: "year", indices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], strong: true },
  ];

  // Sum a months array over given indices (null → 0, returns null if all null)
  const sumIdx = (months: (number | null)[], idx: number[] | undefined): number | null => {
    if (!idx) return null;
    const slice = idx.map((i) => months[i]);
    if (!slice.some((v) => v !== null)) return null;
    return slice.reduce<number>((a, b) => a + (b ?? 0), 0);
  };

  const cats = [
    { key: "service", label: "Сервис", months: dealer.facts.service.months, color: "violet" },
    { key: "equipment", label: "Оборудование", months: dealer.facts.equipment.months, color: "emerald" },
    { key: "materials", label: "Расходные материалы", months: dealer.facts.materials.months, color: "amber" },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={selectedId} onValueChange={setSelectedId}>
          <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Российские дилеры</SelectLabel>
              {rfDealers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Зарубежные дилеры</SelectLabel>
              {foreignDealers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Badge variant={dealer.type === "РФ" ? "default" : "secondary"}>{dealer.type}</Badge>
        <Button variant="outline" size="sm" onClick={handleDealerPrint} className="ml-auto">
          <Printer className="size-4 mr-1" /> Печать
        </Button>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="font-semibold text-base">{dealer.name} — помесячные отгрузки</CardTitle>
          <CardDescription>
            Финансовый год: апрель → март. Столбцы — категории. Строки — месяцы и квартальные/годовые итоги.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="w-full overflow-x-auto thin-scroll">
            <style>{`
              .thin-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
              .thin-scroll::-webkit-scrollbar-track { background: #f1f5f9; }
              .thin-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
              .thin-scroll * { scrollbar-width: thin; scrollbar-color: #cbd5e1 #f1f5f9; }
            `}</style>
            <Table className="text-xs w-full table-fixed">
              {/* Explicit column proportions — prevents stretching gaps. */}
              {/* Column widths: 22 Период | 19 Сервис | 21 Оборудование | 24 Расходные материалы | 14 Итого */}
              <colgroup><col style={{ width: "22%" }} /><col style={{ width: "19%" }} /><col style={{ width: "21%" }} /><col style={{ width: "24%" }} /><col style={{ width: "14%" }} /></colgroup>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="border-b">
                  <TableHead className="text-left text-xs font-semibold whitespace-nowrap px-3 py-2 bg-card">
                    Период
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold whitespace-nowrap px-3 py-2 bg-violet-50 text-violet-700">
                    Сервис, €
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold whitespace-nowrap px-3 py-2 bg-emerald-50 text-emerald-700">
                    Оборудование, €
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold whitespace-nowrap px-3 py-2 bg-amber-50 text-amber-700">
                    Расходные материалы, €
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold whitespace-nowrap px-3 py-2 bg-slate-100 text-slate-700">
                    Итого, €
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rowSpecs.map((spec) => {
                  const svc = sumIdx(dealer.facts.service.months, spec.indices);
                  const eq = sumIdx(dealer.facts.equipment.months, spec.indices);
                  const mat = sumIdx(dealer.facts.materials.months, spec.indices);
                  const total =
                    svc === null && eq === null && mat === null
                      ? null
                      : (svc ?? 0) + (eq ?? 0) + (mat ?? 0);

                  // Visual style for total rows
                  const isStrong = spec.strong;
                  const rowBg = spec.type === "year"
                    ? "bg-slate-100 font-bold"
                    : spec.type === "half"
                    ? "bg-slate-50 font-semibold"
                    : spec.type === "quarter"
                    ? "bg-slate-50/50 font-medium border-t border-slate-200"
                    : "";

                  return (
                    <TableRow key={spec.label} className={`border-b transition-colors hover:bg-slate-50/70 ${rowBg}`}>
                      <TableCell className={`text-left text-xs whitespace-nowrap px-3 py-1.5 ${isStrong ? "font-semibold" : ""}`}>
                        {spec.label}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums text-xs whitespace-nowrap px-3 py-1.5 bg-violet-50/30 ${isStrong ? "bg-violet-50/60" : ""}`}>
                        {svc === null ? "—" : fmt(svc)}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums text-xs whitespace-nowrap px-3 py-1.5 bg-emerald-50/30 ${isStrong ? "bg-emerald-50/60" : ""}`}>
                        {eq === null ? "—" : fmt(eq)}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums text-xs whitespace-nowrap px-3 py-1.5 bg-amber-50/30 ${isStrong ? "bg-amber-50/60" : ""}`}>
                        {mat === null ? "—" : fmt(mat)}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums text-xs whitespace-nowrap px-3 py-1.5 bg-slate-100/60 ${isStrong ? "bg-slate-200/60" : ""}`}>
                        {total === null ? "—" : fmt(total)}
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
  );
}
